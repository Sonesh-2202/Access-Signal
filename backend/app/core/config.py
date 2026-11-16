from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Runtime configuration. Values come from environment variables or a .env file
    at the repository root or in backend/."""

    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database. SQLite is the zero-setup default; docker-compose switches to PostGIS.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'accesssignal.db').as_posix()}"

    # Auth
    secret_key: str = "dev-only-secret-change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    auth_rate_limit_per_minute: int = 10

    # AI (LM Studio, OpenAI-compatible)
    ai_api_base: str = "http://localhost:1234/v1"
    ai_model: str = "gemma-4-12b-it-qat-gguf"
    ai_fallback_enabled: bool = True
    ai_timeout_seconds: float = 45.0

    # Files
    upload_dir: Path = BACKEND_DIR / "uploads"
    max_file_size_mb: int = 10

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Routing graph
    graph_path: Path = BACKEND_DIR / "data" / "manhattan_graph.json"

    demo_mode: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip().startswith("["):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @field_validator("upload_dir", "graph_path", mode="after")
    @classmethod
    def resolve_relative(cls, value: Path) -> Path:
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
