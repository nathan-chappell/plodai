import json
from pathlib import Path

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.schemas.auth import UserResponse


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthService:
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.serializer = URLSafeTimedSerializer(
            secret_key=self.settings.auth_secret_key,
            salt=self.settings.auth_salt,
        )

    def login(self, email: str, password: str) -> tuple[str, User] | None:
        user = self._get_user_by_email(email)
        if user is None or not user.is_active:
            return None
        if not pwd_context.verify(password, user.password_hash):
            return None
        return self.issue_token(user), user

    def issue_token(self, user: User) -> str:
        return self.serializer.dumps(
            {
                "sub": user.id,
                "email": user.email,
                "role": user.role,
            }
        )

    def authenticate_token(self, token: str) -> User | None:
        try:
            payload = self.serializer.loads(
                token,
                max_age=self.settings.auth_token_max_age_seconds,
            )
        except (BadSignature, SignatureExpired):
            return None

        user_id = payload.get("sub")
        if user_id is None:
            return None

        return self.db.query(User).filter(User.id == user_id, User.is_active.is_(True)).one_or_none()

    def bootstrap(self) -> None:
        self._ensure_seed_file_exists(self.settings.user_seed_path)
        self._sync_seed_users(self.settings.user_seed_path)
        self._bootstrap_admin()
        self.db.commit()

    def to_user_response(self, user: User) -> UserResponse:
        return UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
        )

    def _bootstrap_admin(self) -> None:
        if not self.settings.bootstrap_admin_password:
            return

        admin = self._get_user_by_email(self.settings.bootstrap_admin_email)
        if admin is None:
            admin = User(
                email=self.settings.bootstrap_admin_email.lower(),
                full_name=self.settings.bootstrap_admin_name,
                password_hash=pwd_context.hash(self.settings.bootstrap_admin_password),
                role="admin",
                is_active=True,
            )
            self.db.add(admin)
            return

        admin.full_name = self.settings.bootstrap_admin_name
        admin.role = "admin"
        admin.is_active = True
        if not pwd_context.verify(self.settings.bootstrap_admin_password, admin.password_hash):
            admin.password_hash = pwd_context.hash(self.settings.bootstrap_admin_password)

    def _sync_seed_users(self, seed_path: Path) -> None:
        try:
            payload = json.loads(seed_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = []

        for raw_user in payload:
            email = str(raw_user.get("email", "")).strip().lower()
            password = str(raw_user.get("password", "")).strip()
            if not email or not password:
                continue

            user = self._get_user_by_email(email)
            if user is None:
                user = User(
                    email=email,
                    full_name=str(raw_user.get("full_name", "")).strip(),
                    password_hash=pwd_context.hash(password),
                    role=str(raw_user.get("role", "analyst")).strip() or "analyst",
                    is_active=bool(raw_user.get("is_active", True)),
                )
                self.db.add(user)
                continue

            user.full_name = str(raw_user.get("full_name", user.full_name)).strip()
            user.role = str(raw_user.get("role", user.role)).strip() or user.role
            user.is_active = bool(raw_user.get("is_active", user.is_active))
            if not pwd_context.verify(password, user.password_hash):
                user.password_hash = pwd_context.hash(password)

    def _ensure_seed_file_exists(self, seed_path: Path) -> None:
        seed_path.parent.mkdir(parents=True, exist_ok=True)
        if not seed_path.exists():
            seed_path.write_text("[]\n", encoding="utf-8")

    def _get_user_by_email(self, email: str) -> User | None:
        normalized = email.strip().lower()
        return self.db.query(User).filter(User.email == normalized).one_or_none()
