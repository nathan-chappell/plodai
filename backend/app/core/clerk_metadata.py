import math
from collections.abc import Mapping


CREDIT_FLOOR_METADATA_KEY = "credit_floor_usd"
DEFAULT_CREDIT_FLOOR_USD = -1.0


def as_public_metadata(raw_metadata: object | None) -> Mapping[str, object]:
    if isinstance(raw_metadata, Mapping):
        return raw_metadata
    return {}


def _coerce_credit_floor_usd(raw_value: object) -> float | None:
    if isinstance(raw_value, bool):
        return None

    if isinstance(raw_value, (int, float)):
        value = float(raw_value)
    elif isinstance(raw_value, str):
        normalized = raw_value.strip()
        if not normalized:
            return None
        try:
            value = float(normalized)
        except ValueError:
            return None
    else:
        return None

    if not math.isfinite(value):
        return None
    return round(value, 8)


def has_explicit_credit_floor(public_metadata: Mapping[str, object] | None) -> bool:
    if public_metadata is None:
        return False
    return _coerce_credit_floor_usd(
        public_metadata.get(CREDIT_FLOOR_METADATA_KEY)
    ) is not None


def resolve_credit_floor_usd(public_metadata: Mapping[str, object] | None) -> float:
    if public_metadata is None:
        return DEFAULT_CREDIT_FLOOR_USD

    resolved_value = _coerce_credit_floor_usd(
        public_metadata.get(CREDIT_FLOOR_METADATA_KEY)
    )
    if resolved_value is None:
        return DEFAULT_CREDIT_FLOOR_USD
    return resolved_value
