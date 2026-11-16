from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas import RouteRequest, RouteResponse
from app.services.routing.engine import Router, RoutingError, load_graph

router = APIRouter(prefix="/api/routing", tags=["routing"])


@router.post("/route", response_model=RouteResponse)
def plan_route(body: RouteRequest, db: Session = Depends(get_db)):
    if load_graph(db).size["edges"] == 0:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Routing graph not loaded. Run: python -m scripts.seed_demo")
    try:
        return Router(db).route(body.origin, body.destination, body.profile, body.avoid_unknown, body.alternatives)
    except RoutingError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None


@router.get("/graph-info")
def graph_info(db: Session = Depends(get_db)) -> dict:
    return load_graph(db).size
