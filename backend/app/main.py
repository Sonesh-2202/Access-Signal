import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import agents, analytics, auth, evidence, issues, meta, places, reports, routing
from app.core.config import get_settings
from app.core.database import init_db

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    get_settings().upload_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="AccessSignal API",
    version=__version__,
    description=(
        "Community accessibility reports, place profiles, accessibility-aware routing and "
        "infrastructure issue management for Midtown and Lower Manhattan. "
        "Map data © OpenStreetMap contributors (ODbL)."
    ),
    lifespan=lifespan,
    # Served under /api so the frontend dev proxy and production reverse proxy expose them too.
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    openapi_tags=[
        {"name": "auth", "description": "Registration, sign-in and token rotation"},
        {"name": "reports", "description": "Community barrier reports, AI classification and duplicates"},
        {"name": "evidence", "description": "Photo and voice evidence uploads"},
        {"name": "places", "description": "Place accessibility profiles"},
        {"name": "routing", "description": "Accessibility-aware pedestrian routing"},
        {"name": "issues", "description": "Infrastructure manager workflow (staff only)"},
        {"name": "analytics", "description": "Trends, hotspots and coverage"},
        {"name": "agents", "description": "Access Monitor triage agents (staff only)"},
        {"name": "meta", "description": "Health, taxonomy and AI status"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


for r in (auth, meta, evidence, reports, places, routing, issues, analytics, agents):
    app.include_router(r.router)
