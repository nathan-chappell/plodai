from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import AsyncSessionLocal
from backend.app.models.cost import CostEvent
from backend.app.models.credit import UserCreditBalance
from backend.app.models.credit_grant import CreditGrant


class CreditService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    async def _get_or_create_balance(
        db: AsyncSession,
        user_id: str,
    ) -> UserCreditBalance:
        balance = await db.get(UserCreditBalance, user_id)
        if balance is None:
            balance = UserCreditBalance(user_id=user_id, current_credit_usd=0.0)
            db.add(balance)
            await db.flush()
        return balance

    async def get_or_create_balance(self, user_id: str) -> UserCreditBalance:
        balance = await self._get_or_create_balance(self.db, user_id)
        await self.db.commit()
        await self.db.refresh(balance)
        return balance

    async def list_balance_amounts(self, user_ids: list[str]) -> dict[str, float]:
        if not user_ids:
            return {}

        result = await self.db.execute(
            select(UserCreditBalance).where(UserCreditBalance.user_id.in_(user_ids))
        )
        balances = result.scalars().all()
        return {
            balance.user_id: float(balance.current_credit_usd) for balance in balances
        }

    async def grant_credit(
        self,
        user_id: str,
        credit_amount_usd: float,
        *,
        note: str | None = None,
        admin_user_id: str | None = None,
    ) -> UserCreditBalance:
        balance, _ = await self.grant_credit_record(
            user_id,
            credit_amount_usd,
            note=note,
            admin_user_id=admin_user_id,
            source="admin_manual",
        )
        return balance

    async def grant_credit_record(
        self,
        user_id: str,
        credit_amount_usd: float,
        *,
        note: str | None = None,
        admin_user_id: str | None = None,
        source: str = "admin_manual",
        payment_provider: str | None = None,
        payment_reference: str | None = None,
    ) -> tuple[UserCreditBalance, CreditGrant]:
        amount = round(float(credit_amount_usd), 8)
        if amount <= 0:
            raise ValueError("Credit amount must be positive.")
        return await self._record_credit_adjustment(
            user_id,
            amount,
            note=note,
            admin_user_id=admin_user_id,
            source=source,
            payment_provider=payment_provider,
            payment_reference=payment_reference,
        )

    async def adjust_credit_record(
        self,
        user_id: str,
        credit_amount_usd: float,
        *,
        note: str | None,
        admin_user_id: str | None,
        source: str,
        payment_provider: str | None = None,
        payment_reference: str | None = None,
    ) -> tuple[UserCreditBalance, CreditGrant]:
        amount = round(float(credit_amount_usd), 8)
        if amount == 0:
            raise ValueError("Credit adjustment amount must be nonzero.")
        return await self._record_credit_adjustment(
            user_id,
            amount,
            note=note,
            admin_user_id=admin_user_id,
            source=source,
            payment_provider=payment_provider,
            payment_reference=payment_reference,
        )

    async def _record_credit_adjustment(
        self,
        user_id: str,
        credit_amount_usd: float,
        *,
        note: str | None,
        admin_user_id: str | None,
        source: str,
        payment_provider: str | None,
        payment_reference: str | None,
    ) -> tuple[UserCreditBalance, CreditGrant]:
        balance = await self.get_or_create_balance(user_id)
        grant = CreditGrant(
            user_id=user_id,
            admin_user_id=admin_user_id,
            credit_amount_usd=credit_amount_usd,
            source=source,
            note=note.strip() if note else None,
            payment_provider=payment_provider.strip() if payment_provider else None,
            payment_reference=payment_reference.strip() if payment_reference else None,
        )
        self.db.add(grant)
        balance.current_credit_usd = round(
            float(balance.current_credit_usd) + float(credit_amount_usd),
            8,
        )
        balance.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(balance)
        await self.db.refresh(grant)
        return balance, grant

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
            balance = await CreditService._get_or_create_balance(db, user_id)

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
