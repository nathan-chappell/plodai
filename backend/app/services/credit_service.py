from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import AsyncSessionLocal
from backend.app.models.cost import CostEvent
from backend.app.models.credit import UserCreditBalance
from backend.app.models.credit_grant import CreditGrant


class CreditService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_balance(self, user_id: str) -> UserCreditBalance:
        balance = await self.db.get(UserCreditBalance, user_id)
        if balance is None:
            balance = UserCreditBalance(user_id=user_id, current_credit_usd=0.0)
            self.db.add(balance)
            await self.db.commit()
            await self.db.refresh(balance)
        return balance

    async def grant_credit(
        self,
        user_id: str,
        credit_amount_usd: float,
        *,
        note: str | None = None,
        admin_user_id: str | None = None,
    ) -> UserCreditBalance:
        balance = await self.get_or_create_balance(user_id)
        self.db.add(
            CreditGrant(
                user_id=user_id,
                admin_user_id=admin_user_id,
                credit_amount_usd=round(float(credit_amount_usd), 8),
                note=note.strip() if note else None,
            )
        )
        balance.current_credit_usd = round(
            float(balance.current_credit_usd) + float(credit_amount_usd),
            8,
        )
        balance.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(balance)
        return balance

    @staticmethod
    async def record_cost_event(
        *,
        user_id: str,
        thread_id: str,
        cost_usd: float,
        response_id: str | None = None,
        note: str | None = None,
    ) -> None:
        rounded_cost = round(float(cost_usd), 8)
        if rounded_cost <= 0:
            return

        async with AsyncSessionLocal() as db:
            balance = await db.get(UserCreditBalance, user_id)
            if balance is None:
                balance = UserCreditBalance(user_id=user_id, current_credit_usd=0.0)
                db.add(balance)

            db.add(
                CostEvent(
                    user_id=user_id,
                    thread_id=thread_id,
                    response_id=response_id,
                    cost_usd=rounded_cost,
                    note=note.strip() if note else None,
                )
            )
            balance.current_credit_usd = round(
                float(balance.current_credit_usd) - rounded_cost,
                8,
            )
            balance.updated_at = datetime.now(UTC)
            await db.commit()
