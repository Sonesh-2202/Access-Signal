from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import current_user, text_ai_request
from app.core.database import get_db
from app.models import User
from app.schemas import DescribeIn, DescribeOut, RouteRequest, RouteResponse
from app.services.ai.describe_route import RouteIntentError, describe_route
from app.services.ai.providers import Provider
from app.services.ai.tiers import AIUnavailableError
from app.services.routing.engine import Router, RoutingError, load_graph

router = APIRouter(prefix="/api/routing", tags=["routing"])


@router.post("/route", response_model=RouteResponse)
def plan_route(body: RouteRequest, db: Session = Depends(get_db)):
    if load_graph(db).size["edges"] == 0:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Routing graph not loaded. Run: python -m scripts.seed_demo")
    try:
        return Router(db).route(body.origin, body.destination, body.profile, body.avoid_unknown, body.alternatives,
                                prefer_reliable=body.prefer_reliable)
    except RoutingError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None


@router.post("/describe", response_model=DescribeOut)
def describe(body: DescribeIn, _: User = Depends(current_user), byok: Provider | None = Depends(text_ai_request),
             db: Session = Depends(get_db)) -> DescribeOut:
    """Plan a route from a plain-words request. A cloud model reads the request and explains the route.
    Read-only; signed in and rate limited. Without a cloud key the endpoint says so and nothing is planned."""
    try:
        r = describe_route(db, body.text, byok)
    except RouteIntentError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    except AIUnavailableError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from None
    return DescribeOut(answer=r.answer, source=r.source, model=r.model, route=r.result)


@router.get("/graph-info")
def graph_info(db: Session = Depends(get_db)) -> dict:
    return load_graph(db).size
