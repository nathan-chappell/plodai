from backend.app.db.session import Base


def import_models() -> tuple[type[Base], ...]:
    """Import ORM models so Base.metadata is populated before create_all()."""
    from backend.app.models.cost import CostEvent
    from backend.app.models.credit import UserCreditBalance
    from backend.app.models.credit_grant import CreditGrant

    return (CostEvent, UserCreditBalance, CreditGrant)
