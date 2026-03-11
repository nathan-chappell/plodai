from fastapi import Header, HTTPException, status

from app.core.config import get_settings



def require_user(x_demo_user: str | None = Header(default=None)) -> str:
    if not x_demo_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Demo-User header.",
        )

    normalized = x_demo_user.strip().lower()
    if normalized not in get_settings().allowed_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not allowed for this demo.",
        )

    return normalized
