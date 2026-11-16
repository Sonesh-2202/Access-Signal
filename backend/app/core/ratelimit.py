import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
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
