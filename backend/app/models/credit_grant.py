from ai_portfolio_admin.orm import DataclassCreditGrantMixin

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class CreditGrant(DataclassCreditGrantMixin, Base):
    __tablename__ = "credit_grants"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}
