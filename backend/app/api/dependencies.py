from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import User

bearer = HTTPBearer(auto_error=False)


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
