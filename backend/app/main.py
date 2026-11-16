import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api.routes import agents, analytics, auth, evidence, issues, meta, places, reports, routing
from app.core.config import get_settings
from app.core.database import init_db
from app.services.ai.classifier import log_startup_status
from app.services.storage import get_storage

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if get_settings().auto_create_tables:
        init_db()
    get_storage()
    log_startup_status()
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
    debug=False,
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

# Endpoints that may call a model take small JSON bodies only.
_AI_PATHS = ("/api/reports/classify", "/api/agents/")


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        s = get_settings()
        small = request.url.path.startswith(_AI_PATHS)
        cap = s.classify_max_body_bytes if small else s.max_file_size_bytes + 64 * 1024
        length = request.headers.get("content-length")
        if length is None:
            if small or "chunked" in request.headers.get("transfer-encoding", ""):
                return JSONResponse({"detail": "Content-Length is required"}, status_code=411)
        elif not length.isdigit() or int(length) > cap:
            return JSONResponse({"detail": f"Request body over {cap} bytes"}, status_code=413)
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


# Added last so it runs first: preflight requests are answered before the size check.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-AI-Provider", "X-AI-Key"],
    max_age=600,
)


for r in (auth, meta, evidence, reports, places, routing, issues, analytics, agents):
    app.include_router(r.router)
