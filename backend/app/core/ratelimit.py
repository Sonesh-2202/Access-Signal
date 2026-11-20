import logging
import threading
import time
import uuid
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

# Optional Redis dependency.  Install with:  pip install redis>=5.0
try:
    import redis as _redis_lib
except ImportError:
    _redis_lib = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# In-memory sliding-window limiter (original implementation, renamed)
# ---------------------------------------------------------------------------

class _InMemorySlidingWindowLimiter:
    """In-process sliding window limiter. Good enough for a single-node deployment;
    swap for a shared store if the API is ever scaled horizontally."""

    def __init__(self, limit: int, window_seconds: float = 60.0,
                 detail: str = "Too many attempts. Try again shortly."):
        self.limit = limit
        self.window = window_seconds
        self.detail = detail
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                retry = int(self.window - (now - q[0])) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=self.detail,
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# Backward-compatible alias so existing imports keep working.
SlidingWindowLimiter = _InMemorySlidingWindowLimiter


# ---------------------------------------------------------------------------
# Redis-backed sliding-window limiter (distributed / multi-worker safe)
# ---------------------------------------------------------------------------

class RedisLimiter:
    """Distributed sliding-window rate limiter backed by a Redis sorted set.

    Uses the ZADD + ZRANGEBYSCORE + ZREMRANGEBYSCORE pattern:
    * Each hit is stored as a member scored by its wall-clock timestamp.
    * Expired members (outside the window) are pruned on every check.
    * The remaining cardinality decides whether the caller is over the limit.

    If Redis becomes unreachable at runtime the request is **allowed through**
    and a warning is logged, so a Redis outage degrades to "no rate-limiting"
    rather than a hard failure.
    """

    def __init__(self, limit: int, window_seconds: float = 60.0,
                 detail: str = "Too many attempts. Try again shortly.",
                 *, redis_url: str):
        if _redis_lib is None:
            raise RuntimeError(
                "The 'redis' package is required for RedisLimiter. "
                "Install it with:  pip install redis>=5.0"
            )
        self.limit = limit
        self.window = window_seconds
        self.detail = detail
        self._redis: _redis_lib.Redis = _redis_lib.Redis.from_url(
            redis_url, decode_responses=True
        )
        self._key_prefix = "ratelimit:"

    # -- public interface ----------------------------------------------------

    def check(self, key: str) -> None:
        """Record a hit for *key* and raise 429 if the limit is exceeded."""
        redis_key = f"{self._key_prefix}{key}"
        now = time.time()
        window_start = now - self.window

        try:
            pipe = self._redis.pipeline(transaction=True)
            # 1. Remove entries older than the window
            pipe.zremrangebyscore(redis_key, "-inf", window_start)
            # 2. Add the current hit with a unique member
            member = f"{now}:{uuid.uuid4().hex}"
            pipe.zadd(redis_key, {member: now})
            # 3. Count hits inside the window
            pipe.zcard(redis_key)
            # 4. Set TTL so the key auto-expires if the caller disappears
            pipe.expire(redis_key, int(self.window) + 1)
            results = pipe.execute()
        except Exception:
            # Redis is down — degrade gracefully: let the request through.
            logger.warning(
                "Redis unavailable during rate-limit check for key=%s; "
                "allowing request through.",
                key,
                exc_info=True,
            )
            return

        # results: [zremrangebyscore_count, zadd_result, zcard_count, expire_bool]
        current_count: int = results[2]

        if current_count > self.limit:
            # Over limit — figure out when the oldest hit in the window expires.
            try:
                oldest = self._redis.zrangebyscore(
                    redis_key, "-inf", "+inf", start=0, num=1, withscores=True
                )
                if oldest:
                    retry = int(self.window - (now - oldest[0][1])) + 1
                else:
                    retry = int(self.window) + 1
            except Exception:
                retry = int(self.window) + 1

            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=self.detail,
                headers={"Retry-After": str(retry)},
            )

    def reset(self) -> None:
        """Remove **all** rate-limit keys managed by this limiter."""
        try:
            cursor = "0"
            while cursor:
                cursor, keys = self._redis.scan(
                    cursor=cursor, match=f"{self._key_prefix}*", count=200
                )
                if keys:
                    self._redis.delete(*keys)
        except Exception:
            logger.warning(
                "Redis unavailable during rate-limit reset; skipping.",
                exc_info=True,
            )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_limiter(
    limit: int,
    window_seconds: float = 60.0,
    detail: str = "Too many attempts. Try again shortly.",
) -> _InMemorySlidingWindowLimiter | RedisLimiter:
    """Return a :class:`RedisLimiter` when ``REDIS_URL`` is configured,
    otherwise fall back to the in-memory :class:`SlidingWindowLimiter`.

    This keeps the transition transparent for call-sites that just need a
    limiter with ``.check(key)`` / ``.reset()``."""
    from app.core.config import get_settings

    redis_url = get_settings().redis_url
    if redis_url and _redis_lib is not None:
        logger.info("Using Redis-backed rate limiter at %s", redis_url)
        return RedisLimiter(
            limit=limit,
            window_seconds=window_seconds,
            detail=detail,
            redis_url=redis_url,
        )
    if redis_url and _redis_lib is None:
        logger.warning(
            "REDIS_URL is set but the 'redis' package is not installed. "
            "Falling back to the in-memory rate limiter."
        )
    return _InMemorySlidingWindowLimiter(
        limit=limit,
        window_seconds=window_seconds,
        detail=detail,
    )


# ---------------------------------------------------------------------------
# Utility helpers (unchanged)
# ---------------------------------------------------------------------------

def client_ip(request: Request) -> str:
    """The caller's address. Behind N trusted proxies (TRUSTED_PROXY_HOPS) that each append
    to X-Forwarded-For, the Nth entry from the right is the last one a proxy we trust wrote;
    anything further left came from the client and can be forged."""
    from app.core.config import get_settings

    hops = get_settings().trusted_proxy_hops
    if hops > 0:
        chain = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        if len(chain) >= hops:
            return chain[-hops]
    return request.client.host if request.client else "unknown"


def client_key(request: Request, scope: str) -> str:
    return f"{scope}:{client_ip(request)}"
