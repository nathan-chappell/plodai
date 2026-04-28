from ai_portfolio_admin.orm import DataclassFreeCreditRequestMixin

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class FreeCreditRequest(DataclassFreeCreditRequestMixin, Base):
    __tablename__ = "free_credit_requests"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}
