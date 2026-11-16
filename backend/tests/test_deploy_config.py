"""Hosted-deployment configuration: CORS origins, database URLs, production guards,
proxy-aware client IPs and gzip."""

import pytest
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.ratelimit import client_ip

PAGES = "https://demo-owner.github.io"


def test_cors_allows_configured_pages_origin_with_byok_headers(client):
    r = client.options("/api/reports/classify", headers={
        "Origin": PAGES, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-ai-provider,x-ai-key"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == PAGES
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "x-ai-key" in allowed and "x-ai-provider" in allowed
    r = client.get("/api/health", headers={"Origin": PAGES})
    assert r.headers["access-control-allow-origin"] == PAGES


def test_cors_rejects_other_origins(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
    r = client.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert r.status_code == 400


def test_cors_origins_are_normalised():
    s = Settings(cors_origins="https://Owner.github.io/Access-Signal/, http://localhost:5173/,http://localhost:5173")
    assert s.cors_origins == ["https://owner.github.io", "http://localhost:5173"]
    assert Settings(cors_origins='["http://localhost:3000"]').cors_origins == ["http://localhost:3000"]
    with pytest.raises(ValueError):
        Settings(cors_origins="*")
    with pytest.raises(ValueError):
        Settings(cors_origins="github.io")
    # The test app was started with a trailing-slash origin in CORS_ORIGINS.
    assert PAGES in get_settings().cors_origins


def test_supabase_database_url_uses_psycopg3_and_tls():
    s = Settings(database_url="postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres")
    assert s.database_url == ("postgresql+psycopg://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
                              "?sslmode=require")
    assert Settings(database_url="postgres://u:p@localhost/db").database_url == "postgresql+psycopg://u:p@localhost/db"
    sqlite = Settings().database_url
    assert Settings(database_url=sqlite).database_url == sqlite


def test_production_refuses_default_secret():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(environment="production", secret_key="dev-only-secret-change-me")
    Settings(environment="production", secret_key="x" * 40)


def _req(xff: str | None, peer: str = "10.0.0.5") -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_client_ip_trusts_only_configured_proxy_hops(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "trusted_proxy_hops", 0)
    assert client_ip(_req("1.1.1.1")) == "10.0.0.5"  # header ignored by default
    monkeypatch.setattr(s, "trusted_proxy_hops", 1)
    # A client-forged entry on the left can't change the address the proxy saw.
    assert client_ip(_req("6.6.6.6, 203.0.113.9")) == "203.0.113.9"
    assert client_ip(_req(None)) == "10.0.0.5"


def test_large_json_responses_are_gzipped(client):
    r = client.get("/api/meta/taxonomy", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and r.headers.get("content-encoding") == "gzip"
