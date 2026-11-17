import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent

DEV_SECRET = "dev-only-secret-change-me"

AIProviderName = Literal["cloud", "none"]
CloudProviderName = Literal["gemini", "groq", "nebius"]


class Settings(BaseSettings):
    """Runtime configuration. Values come from environment variables or a .env file
    at the repository root or in backend/."""

    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # "development" keeps every local convenience. "production" refuses to start with
    # the development secret and skips create_all (Alembic owns the schema).
    environment: Literal["development", "production"] = "development"

    # Database. SQLite is the zero-setup default; docker-compose switches to PostGIS,
    # the hosted demo points this at Supabase Postgres.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'accesssignal.db').as_posix()}"
    auto_create_tables: bool = True

    # Auth
    secret_key: str = DEV_SECRET
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    auth_rate_limit_per_minute: int = 10

    # AI. Cloud models only. Tiers: a bring-your-own-key provider from the request, then the
    # server keys below in AI_CLOUD_ORDER, then keyword rules as the last resort.
    #   cloud   use the server keys that are set
    #   none    keyword rules only (no cloud calls from the server)
    ai_provider: AIProviderName = "cloud"
    ai_fallback_enabled: bool = True
    ai_timeout_seconds: float = 45.0
    ai_cloud_order: Annotated[list[CloudProviderName], NoDecode] = ["gemini", "groq", "nebius"]
    gemini_api_key: str | None = None
    gemini_api_base: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    gemini_model: str = "gemini-3.5-flash-lite"
    groq_api_key: str | None = None
    groq_api_base: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-20b"
    nebius_api_key: str | None = None
    nebius_api_base: str = "https://api.tokenfactory.nebius.com/v1"
    nebius_model: str = "meta-llama/Llama-3.3-70B-Instruct"
    nebius_vision: bool = False
    # Bring-your-own-key: a browser may send X-AI-Provider + X-AI-Key per request.
    byok_enabled: bool = True
    classify_rate_limit_per_minute: int = 20
    classify_max_body_bytes: int = 16_384

    # Chat assistant. Read-only: it answers from public report, place and route data only.
    chat_rate_limit_per_minute: int = 10
    chat_max_messages: int = 12
    chat_max_context_chars: int = 6000
    chat_max_input_chars: int = 4000
    chat_max_tokens: int = 500
    chat_temperature: float = Field(default=0.2, ge=0, le=1)
    chat_max_body_bytes: int = 65_536

    # Web Push for route alerts. Self-hosted VAPID keys: no paid notification service. Generate with
    # scripts/generate_vapid.py. Without them, alerts still reach the in-app inbox, only the push is skipped.
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:alerts@localhost"

    # Files. STORAGE_BACKEND=supabase stores evidence in a private Supabase bucket.
    storage_backend: Literal["local", "supabase"] = "local"
    upload_dir: Path = BACKEND_DIR / "uploads"
    max_file_size_mb: int = 10
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    supabase_storage_bucket: str = "evidence"
    signed_url_ttl_seconds: int = 300

    # CORS. Origins only (scheme://host[:port]); paths and trailing slashes are dropped.
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://localhost:3000"]

    # Number of reverse proxies in front of the app that append to X-Forwarded-For.
    # 0 uses the socket peer address. Set to the platform's hop count when hosted.
    trusted_proxy_hops: int = 0

    # Routing graph
    graph_path: Path = BACKEND_DIR / "data" / "manhattan_graph.json"

    demo_mode: bool = True

    @field_validator("cors_origins", "ai_cloud_order", mode="before")
    @classmethod
    def split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            if value.strip().startswith("["):
                return json.loads(value)
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @field_validator("cors_origins", mode="after")
    @classmethod
    def normalise_origins(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for raw in value:
            if raw == "*":
                raise ValueError("CORS_ORIGINS must list origins explicitly, '*' is not allowed")
            parts = urlsplit(raw.strip())
            if parts.scheme not in ("http", "https") or not parts.netloc:
                raise ValueError(f"Not an origin: {raw!r}. Use scheme://host[:port]")
            origin = f"{parts.scheme}://{parts.netloc}".lower()
            if origin not in out:
                out.append(origin)
        return out

    @field_validator("database_url", mode="after")
    @classmethod
    def normalise_database_url(cls, url: str) -> str:
        # Supabase and most hosts hand out postgres:// or postgresql:// URLs; SQLAlchemy
        # would pick psycopg2 for those, but we ship psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg://" + url[len(prefix):]
                break
        host = urlsplit(url).hostname or ""
        if url.startswith("postgresql") and host.endswith((".supabase.co", ".supabase.com")) and "sslmode=" not in url:
            url += ("&" if "?" in url else "?") + "sslmode=require"
        return url

    @field_validator("upload_dir", "graph_path", mode="after")
    @classmethod
    def resolve_relative(cls, value: Path) -> Path:
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @model_validator(mode="after")
    def production_guards(self) -> "Settings":
        if self.environment == "production" and (self.secret_key == DEV_SECRET or len(self.secret_key) < 32):
            raise ValueError("SECRET_KEY must be set to a random value of at least 32 characters in production")
        if self.storage_backend == "supabase" and not (self.supabase_url and self.supabase_service_key):
            raise ValueError("STORAGE_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        return self

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
