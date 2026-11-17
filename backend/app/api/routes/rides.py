"""Accessible ride handoff (AI-3). Read-only: the list and the draft message. Nothing is booked
and nothing is written to the database. The draft calls a model only when use_ai is true, and
then through the same rate limit and BYOK rules as the chat assistant."""

from functools import lru_cache

from fastapi import APIRouter, Depends

from app.api.dependencies import chat_request
from app.schemas import DispatcherDraft, RideDraftIn, RideOption
from app.services.ai.providers import Provider
from app.services.ai.ride import draft_message, load_rides

router = APIRouter(prefix="/api/rides", tags=["rides"])


@lru_cache(maxsize=1)
def _rides() -> tuple[RideOption, ...]:
    return tuple(load_rides())


@router.get("", response_model=list[RideOption])
def list_rides() -> list[RideOption]:
    """The curated list. Public and free: it works without AI and without sign-in."""
    return list(_rides())


@router.post("/draft", response_model=DispatcherDraft)
def ride_draft(body: RideDraftIn, byok: Provider | None = Depends(chat_request)) -> DispatcherDraft:
    return draft_message(body.pickup, body.dropoff, body.barrier, body.passengers, body.use_ai, byok)
