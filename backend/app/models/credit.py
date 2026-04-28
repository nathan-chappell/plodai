from ai_portfolio_admin.orm import DataclassUserCreditBalanceMixin

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class UserCreditBalance(DataclassUserCreditBalanceMixin, Base):
    __tablename__ = "user_credit_balances"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}
