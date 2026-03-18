import logging
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from backend.app.core.config import get_settings

try:
    from colorlog import ColoredFormatter
except ImportError:  # pragma: no cover - optional dependency behavior
    ColoredFormatter = None

APP_LOGGER_NAME = "report_foundry"
EVENT_NAME_ATTR = "report_foundry_event_name"
EVENT_FIELDS_ATTR = "report_foundry_event_fields"


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
        event_fields = getattr(record, EVENT_FIELDS_ATTR, ())
        if not isinstance(event_fields, tuple) or not event_fields:
            return event_name
        detail_lines = [
            f" > {key}={value}"
            for key, value in event_fields
            if isinstance(key, str) and isinstance(value, str) and value
        ]
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


def configure_logging(level: int = logging.INFO) -> None:
    settings = get_settings()
    formatter = _build_color_formatter() if settings.USE_COLORLOG else _build_plain_formatter()

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    if not root_logger.handlers:
        root_handler = logging.StreamHandler()
        root_handler.setFormatter(formatter)
        root_logger.addHandler(root_handler)
    else:
        for handler in root_logger.handlers:
            handler.setLevel(level)
            if handler.formatter is None:
                handler.setFormatter(formatter)

    logger = logging.getLogger(APP_LOGGER_NAME)
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        handler.setLevel(level)
        logger.addHandler(handler)
    else:
        for handler in logger.handlers:
            handler.setLevel(level)
            if handler.formatter is None:
                handler.setFormatter(formatter)
    logger.propagate = False

    for logger_name in [
        "uvicorn",
        "uvicorn.error",
        "uvicorn.access",
        "openai",
        "openai.agents",
    ]:
        logging.getLogger(logger_name).setLevel(level)


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
    stacklevel: int = 2,
    **fields: object,
) -> None:
    if not logger.isEnabledFor(level):
        return
    normalized_fields: list[tuple[str, str]] = []
    for key, value in fields.items():
        normalized_value = _normalize_log_field_value(value)
        if normalized_value is None:
            continue
        normalized_fields.append((key, normalized_value))
    logger.log(
        level,
        event,
        extra={
            EVENT_NAME_ATTR: event,
            EVENT_FIELDS_ATTR: tuple(normalized_fields),
        },
        exc_info=exc_info,
        stacklevel=stacklevel,
    )
