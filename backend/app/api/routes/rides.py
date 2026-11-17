"""Accessible ride handoff: the curated list and a fixed dispatcher message. Read-only. Nothing is
booked, sent or stored, and no model is called."""

from functools import lru_cache

from fastapi import APIRouter

from app.schemas import DispatcherDraft, RideDraftIn, RideOption
from app.services.rides import dispatcher_draft, load_rides

router = APIRouter(prefix="/api/rides", tags=["rides"])


@lru_cache(maxsize=1)
def _rides() -> tuple[RideOption, ...]:
    return tuple(load_rides())


@router.get("", response_model=list[RideOption])
def list_rides() -> list[RideOption]:
    """The curated list. Public and free: it works without sign-in."""
    return list(_rides())


@router.post("/draft", response_model=DispatcherDraft)
def ride_draft(body: RideDraftIn) -> DispatcherDraft:
    """A fixed message for the person to review. Public: it costs nothing and stores nothing."""
    return dispatcher_draft(body.pickup, body.dropoff, body.barrier, body.passengers)
