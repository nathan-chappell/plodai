import logging
import time
from collections import deque
from collections.abc import Iterable, Mapping, Sequence
from threading import Lock
from typing import Any

from backend.app.core.config import get_settings

try:
    from colorlog import ColoredFormatter
except ImportError:  # pragma: no cover - optional dependency behavior
    ColoredFormatter = None

APP_LOGGER_NAME = "report_foundry"
EVENT_NAME_ATTR = "report_foundry_event_name"
EVENT_FIELDS_ATTR = "report_foundry_event_fields"
EVENT_BODY_ATTR = "report_foundry_event_body"
COMPILE_LOG_DEDUPE_WINDOW_SECONDS = 300.0

_dedupe_lock = Lock()
_dedupe_cache: dict[str, float] = {}
_dedupe_order: deque[tuple[str, float]] = deque()


def resolve_log_level(level_name: str | None) -> int:
    normalized = (level_name or "").strip().upper()
    if not normalized:
        return logging.INFO
    resolved = logging.getLevelName(normalized)
    if isinstance(resolved, int):
        return resolved
    return logging.INFO


def resolve_external_log_level(app_level: int) -> int:
    return max(app_level, logging.INFO)


def resolve_openai_log_level(app_level: int) -> int:
    return app_level


def resolve_chatkit_log_level(app_level: int) -> int:
    return app_level


def resolve_pydantic_log_level(app_level: int) -> int:
    return app_level


def resolve_sqlalchemy_log_level(app_level: int) -> int:
    return max(app_level, logging.WARNING)


def resolve_quiet_library_log_level(app_level: int) -> int:
    return max(app_level, logging.WARNING)


def _is_empty_log_field(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value
    if isinstance(value, Mapping | Sequence | set) and not value:
        return True
    return False


def summarize_for_log(value: Any, *, limit: int = 120) -> str:
    text = str(value)
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def summarize_mapping_keys_for_log(
    value: Mapping[str, object] | None, *, limit: int = 8
) -> str | None:
    if not value:
        return None
    keys = sorted(str(key) for key in value.keys())
    if len(keys) > limit:
        remaining = len(keys) - limit
        keys = [*keys[:limit], f"...+{remaining}"]
    return ",".join(keys)


def summarize_sequence_for_log(
    value: Iterable[object] | None, *, limit: int = 8
) -> str | None:
    if value is None:
        return None
    items = [summarize_for_log(item, limit=48) for item in value]
    if not items:
        return None
    if len(items) > limit:
        remaining = len(items) - limit
        items = [*items[:limit], f"...+{remaining}"]
    return ",".join(items)


def summarize_pairs_for_log(
    value: Mapping[str, object] | Sequence[tuple[str, object]] | None,
    *,
    separator: str = " ",
) -> str | None:
    if value is None:
        return None
    pairs = value.items() if isinstance(value, Mapping) else value
    parts: list[str] = []
    for key, raw_value in pairs:
        if not isinstance(key, str) or not key:
            continue
        normalized_value = _normalize_log_field_value(raw_value)
        if normalized_value is None:
            continue
        parts.append(f"{key}={normalized_value}")
    if not parts:
        return None
    return separator.join(parts)


def _normalize_log_field_value(value: object) -> str | None:
    if _is_empty_log_field(value):
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        return value
    return summarize_for_log(value)


def _normalize_rendered_lines(value: str | Sequence[str] | None) -> tuple[str, ...]:
    if value is None:
        return ()
    raw_lines: list[str] = []
    if isinstance(value, str):
        raw_lines.extend(value.splitlines())
    else:
        for item in value:
            raw_lines.extend(str(item).splitlines())
    normalized_lines = [line.strip() for line in raw_lines if line.strip()]
    return tuple(normalized_lines)


def clear_log_event_dedupe_cache() -> None:
    with _dedupe_lock:
        _dedupe_cache.clear()
        _dedupe_order.clear()


def _should_emit_deduped_event(
    event: str,
    *,
    rendered_lines: tuple[str, ...],
    normalized_fields: Sequence[tuple[str, str]],
    ttl_seconds: float = COMPILE_LOG_DEDUPE_WINDOW_SECONDS,
) -> bool:
    now = time.monotonic()
    content = "\n".join(
        (
            *rendered_lines,
            *(f"{key}={value}" for key, value in normalized_fields),
        )
    )
    cache_key = f"{event}\n{content}"
    with _dedupe_lock:
        expiry_cutoff = now - ttl_seconds
        while _dedupe_order and _dedupe_order[0][1] <= expiry_cutoff:
            stale_key, stale_timestamp = _dedupe_order.popleft()
            cached_timestamp = _dedupe_cache.get(stale_key)
            if cached_timestamp == stale_timestamp:
                _dedupe_cache.pop(stale_key, None)
        previous_timestamp = _dedupe_cache.get(cache_key)
        if previous_timestamp is not None and (now - previous_timestamp) < ttl_seconds:
            return False
        _dedupe_cache[cache_key] = now
        _dedupe_order.append((cache_key, now))
    return True


class _BaseEventFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        record.message = self._build_record_message(record)
        if self.usesTime():
            record.asctime = self.formatTime(record, self.datefmt)
        formatted = self.formatMessage(record)
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            if formatted and formatted[-1] != "\n":
                formatted += "\n"
            formatted += record.exc_text
        if record.stack_info:
            if formatted and formatted[-1] != "\n":
                formatted += "\n"
            formatted += self.formatStack(record.stack_info)
        return formatted

    def _build_record_message(self, record: logging.LogRecord) -> str:
        event_name = getattr(record, EVENT_NAME_ATTR, None)
        if not isinstance(event_name, str) or not event_name:
            return record.getMessage()
        rendered_lines = getattr(record, EVENT_BODY_ATTR, ())
        event_fields = getattr(record, EVENT_FIELDS_ATTR, ())
        if not isinstance(rendered_lines, tuple):
            rendered_lines = ()
        if not isinstance(event_fields, tuple):
            event_fields = ()
        if not rendered_lines and not event_fields:
            return event_name
        detail_lines = [f" > {line}" for line in rendered_lines if isinstance(line, str) and line]
        detail_lines.extend(
            f" > {key}={value}"
            for key, value in event_fields
            if isinstance(key, str) and isinstance(value, str) and value
        )
        if not detail_lines:
            return event_name
        return f"{event_name}\n" + "\n".join(detail_lines)


def _build_plain_formatter() -> logging.Formatter:
    return _BaseEventFormatter(
        "%(asctime)s %(levelname)-8s %(name)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _build_color_formatter() -> logging.Formatter:
    if ColoredFormatter is None:
        return _build_plain_formatter()
    class _ColorEventFormatter(_BaseEventFormatter, ColoredFormatter):
        pass

    return _ColorEventFormatter(
        "%(log_color)s%(asctime)s %(levelname)-8s%(reset)s %(name)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        log_colors={
            "DEBUG": "cyan",
            "INFO": "green",
            "WARNING": "yellow",
            "ERROR": "red",
            "CRITICAL": "bold_red",
        },
    )


def configure_logging(level: int | None = None) -> None:
    settings = get_settings()
    resolved_level = level if level is not None else resolve_log_level(settings.LOG_LEVEL)
    external_level = resolve_external_log_level(resolved_level)
    openai_level = resolve_openai_log_level(resolved_level)
    chatkit_level = resolve_chatkit_log_level(resolved_level)
    pydantic_level = resolve_pydantic_log_level(resolved_level)
    sqlalchemy_level = resolve_sqlalchemy_log_level(resolved_level)
    quiet_library_level = resolve_quiet_library_log_level(resolved_level)
    root_level = external_level
    formatter = _build_color_formatter() if settings.USE_COLORLOG else _build_plain_formatter()

    root_logger = logging.getLogger()
    root_logger.setLevel(root_level)
    if not root_logger.handlers:
        root_handler = logging.StreamHandler()
        root_handler.setFormatter(formatter)
        root_handler.setLevel(logging.NOTSET)
        root_logger.addHandler(root_handler)
    else:
        for handler in root_logger.handlers:
            handler.setLevel(logging.NOTSET)
            if handler.formatter is None:
                handler.setFormatter(formatter)

    logger = logging.getLogger(APP_LOGGER_NAME)
    logger.setLevel(resolved_level)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        handler.setLevel(resolved_level)
        logger.addHandler(handler)
    else:
        for handler in logger.handlers:
            handler.setLevel(resolved_level)
            if handler.formatter is None:
                handler.setFormatter(formatter)
    logger.propagate = False

    for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        logging.getLogger(logger_name).setLevel(external_level)
    for logger_name in [
        "aiosqlite",
        "griffe",
        "httpcore",
        "httpcore.connection",
        "httpcore.http11",
        "httpx",
    ]:
        logging.getLogger(logger_name).setLevel(quiet_library_level)
    for logger_name in ["sqlalchemy", "sqlalchemy.engine", "sqlalchemy.pool"]:
        logging.getLogger(logger_name).setLevel(sqlalchemy_level)
    for logger_name in ["openai", "openai.agents"]:
        logging.getLogger(logger_name).setLevel(openai_level)
    for logger_name in ["chatkit"]:
        logging.getLogger(logger_name).setLevel(chatkit_level)
    for logger_name in ["pydantic", "pydantic_core"]:
        logging.getLogger(logger_name).setLevel(pydantic_level)


def get_logger(name: str) -> logging.Logger:
    suffix = name.strip(".")
    if not suffix:
        return logging.getLogger(APP_LOGGER_NAME)
    return logging.getLogger(f"{APP_LOGGER_NAME}.{suffix}")


def response_logs_url(response_id: str | None) -> str | None:
    if not response_id:
        return None
    return f"https://platform.openai.com/logs/{response_id}"


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    /,
    *,
    exc_info: Any = None,
    rendered: str | Sequence[str] | None = None,
    dedupe: bool = False,
    stacklevel: int = 2,
    **fields: object,
) -> None:
    if not logger.isEnabledFor(level):
        return
    normalized_rendered = _normalize_rendered_lines(rendered)
    normalized_fields: list[tuple[str, str]] = []
    for key, value in fields.items():
        normalized_value = _normalize_log_field_value(value)
        if normalized_value is None:
            continue
        normalized_fields.append((key, normalized_value))
    if dedupe and not _should_emit_deduped_event(
        event,
        rendered_lines=normalized_rendered,
        normalized_fields=normalized_fields,
    ):
        return
    logger.log(
        level,
        event,
        extra={
            EVENT_NAME_ATTR: event,
            EVENT_BODY_ATTR: normalized_rendered,
            EVENT_FIELDS_ATTR: tuple(normalized_fields),
        },
        exc_info=exc_info,
        stacklevel=stacklevel,
    )
