from __future__ import annotations

from collections.abc import Mapping

from ai_portfolio_admin.clerk_metadata import (
    ClerkMetadataKeys,
    has_explicit_credit_floor_usd,
    metadata_with_active_state,
    public_metadata,
    resolve_credit_floor_usd as shared_resolve_credit_floor_usd,
)

CREDIT_FLOOR_METADATA_KEY = "credit_floor_usd"
DEFAULT_CREDIT_FLOOR_USD = -1.0
PLODAI_METADATA_KEYS = ClerkMetadataKeys(default_credit_floor_usd=DEFAULT_CREDIT_FLOOR_USD)


def as_public_metadata(raw_metadata: object | None) -> Mapping[str, object]:
    return public_metadata(raw_metadata)


def has_explicit_credit_floor(metadata: Mapping[str, object] | None) -> bool:
    return has_explicit_credit_floor_usd(metadata, PLODAI_METADATA_KEYS)


def resolve_credit_floor_usd(metadata: Mapping[str, object] | None) -> float:
    return shared_resolve_credit_floor_usd(metadata, PLODAI_METADATA_KEYS)


def active_public_metadata(metadata: Mapping[str, object] | None, *, active: bool) -> dict[str, object]:
    return metadata_with_active_state(metadata, active=active, keys=PLODAI_METADATA_KEYS)
