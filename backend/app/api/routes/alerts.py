"""Route alerts (AI-4): saved corridors, Web Push subscriptions and the in-app inbox.

Everything here is opt-in and belongs to the signed-in user. Corridors and subscriptions are
private to their owner: a request for someone else's item gets a 404. Nothing in this file
calls a model, and nothing writes to report, place or issue tables."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models import Notification, PushSubscription, SavedCorridor, User
from app.models.entities import utcnow
from app.api.dependencies import current_user
from app.schemas import (
    CorridorIn,
    CorridorOut,
    CorridorPatch,
    InboxItem,
    InboxOut,
    PushStatus,
    PushSubscribeIn,
    PushUnsubscribeIn,
)
from app.services.alerts.push import push_enabled

router = APIRouter(prefix="/api/alerts", tags=["alerts"])
MAX_CORRIDORS_PER_USER = 10
INBOX_LIMIT = 50


def _corridor_out(c: SavedCorridor) -> CorridorOut:
    return CorridorOut(
        id=c.id, name=c.name, origin=(c.origin_lat, c.origin_lng),
        destination=(c.destination_lat, c.destination_lng), profile=c.profile,
        notify_reports=c.notify_reports, notify_outages=c.notify_outages,
        notify_route_changes=c.notify_route_changes, last_checked_at=c.last_checked_at, created_at=c.created_at,
    )


def _own_corridor(db: Session, user: User, corridor_id: str) -> SavedCorridor:
    c = db.get(SavedCorridor, corridor_id)
    if c is None or c.user_id != user.id or c.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved route not found")
    return c


# ------------------------------------------------------------------ push
@router.get("/push", response_model=PushStatus)
def push_status() -> PushStatus:
    """Whether the server can send push. The browser needs the public key to subscribe."""
    s = get_settings()
    return PushStatus(enabled=push_enabled(), public_key=s.vapid_public_key if push_enabled() else None)


@router.post("/push-subscriptions", status_code=status.HTTP_201_CREATED)
def subscribe(body: PushSubscribeIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(user_id=user.id, endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth)
        db.add(sub)
    else:
        sub.user_id, sub.p256dh, sub.auth, sub.revoked_at = user.id, body.keys.p256dh, body.keys.auth, None
    db.commit()
    return {"subscribed": True}


@router.post("/push-subscriptions/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: PushUnsubscribeIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint,
                                                   PushSubscription.user_id == user.id))
    if sub is not None:
        db.delete(sub)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ corridors
@router.get("/corridors", response_model=list[CorridorOut])
def list_corridors(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[CorridorOut]:
    rows = db.scalars(select(SavedCorridor).where(SavedCorridor.user_id == user.id,
                                                  SavedCorridor.deleted_at.is_(None))
                      .order_by(SavedCorridor.created_at)).all()
    return [_corridor_out(c) for c in rows]


@router.post("/corridors", response_model=CorridorOut, status_code=status.HTTP_201_CREATED)
def save_corridor(body: CorridorIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> CorridorOut:
    active = db.scalars(select(SavedCorridor.id).where(SavedCorridor.user_id == user.id,
                                                       SavedCorridor.deleted_at.is_(None))).all()
    if len(active) >= MAX_CORRIDORS_PER_USER:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"You can watch up to {MAX_CORRIDORS_PER_USER} routes. Remove one first.")
    c = SavedCorridor(
        user_id=user.id, name=body.name.strip(), origin_lat=body.origin[0], origin_lng=body.origin[1],
        destination_lat=body.destination[0], destination_lng=body.destination[1], profile=body.profile,
        notify_reports=body.notify_reports, notify_outages=body.notify_outages,
        notify_route_changes=body.notify_route_changes, created_at=utcnow(),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _corridor_out(c)


@router.patch("/corridors/{corridor_id}", response_model=CorridorOut)
def update_corridor(corridor_id: str, body: CorridorPatch, user: User = Depends(current_user),
                    db: Session = Depends(get_db)) -> CorridorOut:
    c = _own_corridor(db, user, corridor_id)
    for field in ("notify_reports", "notify_outages", "notify_route_changes"):
        value = getattr(body, field)
        if value is not None:
            setattr(c, field, value)
    db.commit()
    db.refresh(c)
    return _corridor_out(c)


@router.delete("/corridors/{corridor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_corridor(corridor_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    c = _own_corridor(db, user, corridor_id)
    c.deleted_at = utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ inbox
def _item(n: Notification, names: dict[str, str]) -> InboxItem:
    return InboxItem(id=n.id, kind=n.kind, title=n.title, body=n.body, corridor_id=n.corridor_id,
                     corridor_name=names.get(n.corridor_id or ""), created_at=n.created_at, read=n.read_at is not None)


@router.get("/inbox", response_model=InboxOut)
def inbox(user: User = Depends(current_user), db: Session = Depends(get_db)) -> InboxOut:
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id)
                      .order_by(Notification.created_at.desc()).limit(INBOX_LIMIT)).all()
    unread_count = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None))) or 0
    names = {c.id: c.name for c in db.scalars(select(SavedCorridor).where(SavedCorridor.user_id == user.id)).all()}
    return InboxOut(unread=unread_count, items=[_item(n, names) for n in rows])


@router.post("/inbox/{item_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(item_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    n = db.get(Notification, item_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    n.read_at = n.read_at or utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/inbox/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    now = utcnow()
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id,
                                                   Notification.read_at.is_(None))).all():
        n.read_at = now
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

