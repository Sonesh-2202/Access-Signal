"""Every alert goes to the in-app inbox first, then to each of the user's browsers. An inbox item
is written once per dedupe key, so a cron run that finds the same event again sends nothing new."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, PushSubscription
from app.models.entities import utcnow
from app.services.alerts.push import send_push


def notify(db: Session, user_id: str, *, kind: str, title: str, body: str, dedupe_key: str,
           corridor_id: str | None = None, url: str = "settings#alerts") -> Notification | None:
    """Returns the new inbox item, or None when this event was already sent to this user."""
    exists = db.scalar(select(Notification.id).where(Notification.user_id == user_id,
                                                     Notification.dedupe_key == dedupe_key))
    if exists:
        return None
    item = Notification(user_id=user_id, corridor_id=corridor_id, kind=kind, title=title[:120],
                        body=body[:300], dedupe_key=dedupe_key[:160], created_at=utcnow())
    db.add(item)
    db.flush()
    subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id,
                                                     PushSubscription.revoked_at.is_(None))).all()
    payload = {"title": item.title, "body": item.body, "url": url, "kind": kind}
    now = utcnow()
    for sub in subs:
        if send_push(sub, payload) == "gone":
            sub.revoked_at = now
    return item
