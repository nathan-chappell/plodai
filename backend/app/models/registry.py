from backend.app.db.session import Base


def import_models() -> tuple[type[Base], ...]:
    """Import ORM models so Base.metadata is populated before create_all()."""
    from backend.app.models.cost import CostEvent
    from backend.app.models.credit import UserCreditBalance
    from backend.app.models.credit_grant import CreditGrant
    from backend.app.models.free_credit_request import FreeCreditRequest
    from backend.app.models.farm import (
        Farm,
        FarmChat,
        FarmChatAttachment,
        FarmChatEntry,
        FarmImage,
        FarmRecord,
    )
    from backend.app.models.payment_attempt import PaymentAttempt

    return (
        CostEvent,
        UserCreditBalance,
        CreditGrant,
        PaymentAttempt,
        FreeCreditRequest,
        Farm,
        FarmRecord,
        FarmImage,
        FarmChat,
        FarmChatEntry,
        FarmChatAttachment,
    )
