"""P0-3: the model service's counterpart to apps/backend/src/observability.ts.

Same shape, same defaults -- off unless SENTRY_DSN is set, never fatal to the
process it watches, environment/release/job-id tags, and no free-text PII in
what gets sent. This is the one long-running Python process in the stack
(src/model_service.py); the one-shot scripts (training.py and friends) are
covered by the backend catching whatever they exit with.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, Optional

logger = logging.getLogger("observability")

EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
TOKEN_PATTERN = re.compile(r"\b(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+\S+)\b")
SENSITIVE_KEY_PATTERN = re.compile(r"token|password|secret|authorization|embedding|vector|taste|fingerprint", re.IGNORECASE)


def scrub_text(value: str) -> str:
    return TOKEN_PATTERN.sub("[redacted-token]", EMAIL_PATTERN.sub("[redacted-email]", value))


def scrub_value(value: Any, depth: int = 0) -> Any:
    if depth > 6 or value is None:
        return value
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, list):
        return [scrub_value(item, depth + 1) for item in value]
    if isinstance(value, dict):
        return {
            key: "[redacted]" if SENSITIVE_KEY_PATTERN.search(str(key)) else scrub_value(item, depth + 1)
            for key, item in value.items()
        }
    return value


def _before_send(event: Dict[str, Any], _hint: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    exception = event.get("exception")
    if isinstance(exception, dict):
        for entry in exception.get("values") or []:
            if isinstance(entry.get("value"), str):
                entry["value"] = scrub_text(entry["value"])
    if isinstance(event.get("message"), str):
        event["message"] = scrub_text(event["message"])
    if "extra" in event:
        event["extra"] = scrub_value(event["extra"])
    if "contexts" in event:
        event["contexts"] = scrub_value(event["contexts"])
    return event


_sentry_started = False


def init_observability(env: Optional[Dict[str, str]] = None) -> bool:
    """Starts Sentry if SENTRY_DSN is set. Never raises: a monitoring backend
    that is down, misconfigured, or given a malformed DSN must not stop the
    service it exists to watch."""
    global _sentry_started
    values = env if env is not None else os.environ
    dsn = (values.get("SENTRY_DSN") or "").strip()
    if not dsn:
        _sentry_started = False
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            # RAILWAY_ENVIRONMENT_NAME is set by Railway on every deploy already
            # (production/staging); SENTRY_ENVIRONMENT overrides it anywhere else.
            environment=(values.get("SENTRY_ENVIRONMENT") or values.get("RAILWAY_ENVIRONMENT_NAME") or "development").strip(),
            release=(values.get("SENTRY_RELEASE") or values.get("RAILWAY_GIT_COMMIT_SHA") or None),
            traces_sample_rate=0.0,
            send_default_pii=False,
            before_send=_before_send,
        )
        _sentry_started = True
        logger.info("Sentry enabled for the model service")
        return True
    except Exception as error:  # noqa: BLE001 -- starting the reporter must not crash the reporter's own host
        logger.error("Sentry failed to start: %s", error)
        _sentry_started = False
        return False


def capture_exception(error: BaseException, tags: Optional[Dict[str, str]] = None) -> None:
    """No-op when Sentry never started, so every call site is correct with no
    DSN configured (dev, tests). `tags` is for small bounded identifiers
    (job id, profile id) -- never free text; before_send scrubs known-
    sensitive keys regardless."""
    if not _sentry_started:
        return
    import sentry_sdk

    with sentry_sdk.new_scope() as scope:
        for key, value in (tags or {}).items():
            scope.set_tag(key, value)
        sentry_sdk.capture_exception(error)
