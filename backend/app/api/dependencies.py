import re
from collections.abc import Callable

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.ratelimit import SlidingWindowLimiter, client_key
from app.core.security import decode_access_token
from app.models import User
from app.services.ai.classifier import byok_provider
from app.services.ai.providers import CLOUD_PROVIDERS, Provider

bearer = HTTPBearer(auto_error=False)

# Per-IP limits on every endpoint that can call a model, with or without a BYOK key:
# a browser-held key must not turn this server into a free relay. Chat has its own,
# lower limit so a conversation can't use up the classifier's budget (or the reverse).
classify_limiter = SlidingWindowLimiter(get_settings().classify_rate_limit_per_minute)
chat_limiter = SlidingWindowLimiter(
    get_settings().chat_rate_limit_per_minute,
    detail=(f"Chat limit reached: {get_settings().chat_rate_limit_per_minute} questions per minute. "
            "Wait a minute, then ask again. The report form works without the assistant."),
)
_KEY_SHAPE = re.compile(r"^[A-Za-z0-9_\-.:]{16,200}$")


def _byok_from_headers(x_ai_provider: str | None, x_ai_key: str | None) -> Provider | None:
    """Turn an optional X-AI-Provider / X-AI-Key pair into a one-request provider. The key
    lives in this request's memory only: it is not stored, logged or echoed."""
    if not x_ai_key:
        return None
    if not get_settings().byok_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This server does not accept personal AI keys")
    name = (x_ai_provider or "gemini").strip().lower()[:20]
    if name not in CLOUD_PROVIDERS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"X-AI-Provider must be one of: {', '.join(CLOUD_PROVIDERS)}")
    if not _KEY_SHAPE.match(x_ai_key.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That doesn't look like an API key")
    return byok_provider(name, x_ai_key.strip())


def ai_request(
    request: Request,
    # No max_length here on purpose: FastAPI's 422 body echoes the rejected input.
    x_ai_provider: str | None = Header(default=None, alias="X-AI-Provider"),
    x_ai_key: str | None = Header(default=None, alias="X-AI-Key"),
) -> Provider | None:
    classify_limiter.check(client_key(request, "classify"))
    return _byok_from_headers(x_ai_provider, x_ai_key)


def chat_request(
    request: Request,
    x_ai_provider: str | None = Header(default=None, alias="X-AI-Provider"),
    x_ai_key: str | None = Header(default=None, alias="X-AI-Key"),
) -> Provider | None:
    chat_limiter.check(client_key(request, "chat"))
    return _byok_from_headers(x_ai_provider, x_ai_key)


def _user_from_token(db: Session, creds: HTTPAuthorizationCredentials | None) -> User | None:
    if creds is None:
        return None
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.",
                            headers={"WWW-Authenticate": "Bearer"}) from None
    user = db.get(User, payload.get("sub"))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    return user


def optional_user(
    db: Session = Depends(get_db), creds: HTTPAuthorizationCredentials | None = Depends(bearer)
) -> User | None:
    return _user_from_token(db, creds)


def current_user(
    db: Session = Depends(get_db), creds: HTTPAuthorizationCredentials | None = Depends(bearer)
) -> User:
    user = _user_from_token(db, creds)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue",
                            headers={"WWW-Authenticate": "Bearer"})
    return user


def require_roles(*roles: str) -> Callable[[User], User]:
    def checker(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to this area")
        return user

    return checker


manager_only = require_roles("infrastructure_manager", "admin")
