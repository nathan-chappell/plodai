from sqlalchemy.ext.asyncio import AsyncAttrs, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass

from app.core.config import get_settings


class Base(AsyncAttrs, MappedAsDataclass, DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(settings.async_database_url, future=True)
AsyncSessionLocal = async_sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as db:
        yield db
