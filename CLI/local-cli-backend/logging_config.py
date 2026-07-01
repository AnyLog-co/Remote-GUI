"""
Centralized logging configuration for the Remote-GUI backend.

Adds rotating file handlers to the root logger and uvicorn loggers,
and optionally redirects stdout/stderr so that print() calls also
land in the log files.

Configuration via environment variables:
    LOG_DIR          - directory for log files  (default: ./logs)
    LOG_LEVEL        - minimum level            (default: INFO)
    LOG_MAX_BYTES    - max size per file         (default: 10 MB)
    LOG_BACKUP_COUNT - rotated files to keep     (default: 5)
"""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler

_CONFIGURED = False

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class _StreamToLogger:
    """Write‑protocol wrapper that sends each write() to a logger."""

    def __init__(self, logger: logging.Logger, level: int = logging.INFO, stream=None):
        self._logger = logger
        self._level = level
        self._stream = stream
        self._buf = ""

    def write(self, msg: str):
        if msg and msg.strip():
            self._logger.log(self._level, msg.rstrip())

    def flush(self):
        pass

    def isatty(self):
        return False

    def fileno(self):
        if self._stream is None:
            raise OSError("No underlying stream is available")
        return self._stream.fileno()


def setup_logging() -> str:
    """
    Configure file + console logging.  Returns the resolved log directory.
    Safe to call multiple times – only the first call takes effect.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return ""
    _CONFIGURED = True

    log_dir = os.getenv("LOG_DIR", os.path.join(os.path.dirname(__file__), "logs"))
    log_level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
    max_bytes = int(os.getenv("LOG_MAX_BYTES", 10 * 1024 * 1024))
    backup_count = int(os.getenv("LOG_BACKUP_COUNT", "5"))

    os.makedirs(log_dir, exist_ok=True)

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    # --- file handler (all messages) ---
    app_handler = RotatingFileHandler(
        os.path.join(log_dir, "backend.log"),
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    app_handler.setLevel(log_level)
    app_handler.setFormatter(formatter)

    # --- separate error‑only file for quick triage ---
    err_handler = RotatingFileHandler(
        os.path.join(log_dir, "backend-error.log"),
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    err_handler.setLevel(logging.WARNING)
    err_handler.setFormatter(formatter)

    # Attach to root logger so every library's log goes to the files
    root = logging.getLogger()
    root.setLevel(log_level)
    root.addHandler(app_handler)
    root.addHandler(err_handler)

    # Make sure uvicorn's own loggers also propagate to root
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.propagate = True

    # Redirect print() / stdout / stderr into the log files so that
    # existing print() calls throughout the codebase are captured.
    stdout_logger = logging.getLogger("stdout")
    stderr_logger = logging.getLogger("stderr")
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sys.stdout = _StreamToLogger(stdout_logger, logging.INFO, original_stdout)
    sys.stderr = _StreamToLogger(stderr_logger, logging.ERROR, original_stderr)

    logging.getLogger(__name__).info(
        "Logging initialised – dir=%s  level=%s  max_bytes=%s  backups=%s",
        log_dir, logging.getLevelName(log_level), max_bytes, backup_count,
    )

    return log_dir
