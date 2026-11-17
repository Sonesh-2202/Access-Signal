"""Web Push delivery with self-hosted VAPID keys. Free: the browser's push service carries the
message, and no paid notification vendor is involved.

The payload is generic: a title, a short body and a link to the settings page. It never holds
addresses, names, report text or corridor names. The in-app inbox holds the same text."""

import json
import logging

from pywebpush import WebPushException, webpush

from app.core.config import get_settings
from app.models import PushSubscription

log = logging.getLogger("app.services.alerts.push")


def push_enabled() -> bool:
    s = get_settings()
    return bool(s.vapid_public_key and s.vapid_private_key)


def _private_pem() -> str:
    # Environment variables hold the PEM on one line with \n escapes (see scripts/generate_vapid.py).
    return get_settings().vapid_private_key.replace("\\n", "\n")


def send_push(sub: PushSubscription, payload: dict) -> str:
    """Returns "sent", "gone" (the browser has dropped this subscription), "failed" or "disabled".
    Endpoints and keys are not logged: each one identifies the browser."""
    if not push_enabled():
        return "disabled"
    s = get_settings()
    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload),
            vapid_private_key=_private_pem(),
            vapid_claims={"sub": s.vapid_subject},
            ttl=86400,
        )
        return "sent"
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            return "gone"
        log.warning("Web Push delivery failed with HTTP %s", status)
        return "failed"
