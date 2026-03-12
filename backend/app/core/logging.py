import logging
from typing import Any

from colorlog import ColoredFormatter

APP_LOGGER_NAME = "report_foundry"


def _build_formatter() -> ColoredFormatter:
    return ColoredFormatter(
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
    formatter = _build_formatter()

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


def summarize_for_log(value: Any, *, limit: int = 120) -> str:
    text = str(value)
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."
