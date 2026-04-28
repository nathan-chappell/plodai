from ai_portfolio_admin.orm import DataclassPaymentAttemptMixin

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class PaymentAttempt(DataclassPaymentAttemptMixin, Base):
    __tablename__ = "payment_attempts"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}
