from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import __version__
from app.core.config import get_settings
from app.core.database import get_db
from app.domain.taxonomy import CATEGORIES, ISSUE_STATUSES, PLACE_FEATURES
from app.models import PathEdge, Report
from app.services.ai.classifier import get_chain
from app.services.ai.providers import CLOUD_PROVIDERS
from app.utils.geo import SERVICE_AREA

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "reports": db.scalar(select(func.count()).select_from(Report)) or 0,
        "graph_edges": db.scalar(select(func.count()).select_from(PathEdge)) or 0,
    }


@router.get("/meta/taxonomy")
def taxonomy() -> dict:
    return {
        "categories": [
            {"key": k, "label": v["label"],
             "subcategories": [{"key": sk, **sv} for sk, sv in v["subcategories"].items()]}
            for k, v in CATEGORIES.items()
        ],
        "features": [{"key": k, "label": v} for k, v in PLACE_FEATURES.items()],
        "issue_statuses": list(ISSUE_STATUSES),
        "service_area": SERVICE_AREA,
    }


@router.get("/meta/ai-status")
def ai_status() -> dict:
    s = get_settings()
    chain = get_chain().status()
    return {
        **chain,
        "fallback_enabled": s.ai_fallback_enabled,
        "mode": s.ai_provider,
        "byok": {"enabled": s.byok_enabled, "providers": list(CLOUD_PROVIDERS)},
        # Server tier only. A user's own key (BYOK) can make chat work when this is false.
        "chat": {
            "available": chain["available"],
            "tier": chain["provider"] if chain["available"] else None,
            "read_only": True,
            "rate_limit_per_minute": s.chat_rate_limit_per_minute,
            "max_messages": s.chat_max_messages,
        },
    }
