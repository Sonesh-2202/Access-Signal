"""Evidence storage behind a small interface.

    LocalDiskStorage  files under UPLOAD_DIR (default; local and docker-compose)
    SupabaseStorage   a private Supabase Storage bucket (hosted demo)

Both receive bytes that have already passed the magic-byte check and EXIF stripping
in the evidence route; the backend never sees anything else. Object keys are
YYYY/MM/<uuid4 hex><ext>, so they can't be guessed or enumerated.

Serving: the evidence route checks the privacy rules (attached to a live report)
first, then asks the backend for a response. Local disk streams the file; Supabase
answers with a redirect to a signed URL that expires after SIGNED_URL_TTL_SECONDS.
The bucket is private, so an object can't be fetched without such a URL."""

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx
from fastapi.responses import FileResponse, RedirectResponse, Response

from app.core.config import Settings, get_settings

# Magic-byte sniffing: we never trust the client-supplied content type.
_SIGNATURES: list[tuple[bytes, int, str, str, str]] = [
    # (signature, offset, mime, ext, kind)
    (b"\xff\xd8\xff", 0, "image/jpeg", ".jpg", "photo"),
    (b"\x89PNG\r\n\x1a\n", 0, "image/png", ".png", "photo"),
    (b"WEBP", 8, "image/webp", ".webp", "photo"),
    (b"\x1aE\xdf\xa3", 0, "audio/webm", ".webm", "voice"),
    (b"OggS", 0, "audio/ogg", ".ogg", "voice"),
    (b"WAVE", 8, "audio/wav", ".wav", "voice"),
    (b"ftyp", 4, "audio/mp4", ".m4a", "voice"),
]
_KEY = re.compile(r"^\d{4}/\d{2}/[0-9a-f]{32}\.(jpg|png|webp|webm|ogg|wav|m4a)$")


class UnsupportedFile(ValueError):
    pass


def sniff(data: bytes) -> tuple[str, str, str]:
    for sig, offset, mime, ext, kind in _SIGNATURES:
        if data[offset : offset + len(sig)] == sig:
            if sig == b"WEBP" and data[:4] != b"RIFF":
                continue
            if sig == b"WAVE" and data[:4] != b"RIFF":
                continue
            return mime, ext, kind
    raise UnsupportedFile("Only JPEG, PNG, WebP images and WebM, Ogg, WAV, M4A audio are accepted")


def new_key(ext: str) -> str:
    now = datetime.now(UTC)
    return f"{now:%Y}/{now:%m}/{uuid.uuid4().hex}{ext}"


def check_key(key: str) -> str:
    """Only keys this module generated are valid; blocks traversal and odd paths."""
    if not _KEY.match(key or ""):
        raise FileNotFoundError(key)
    return key


class Storage(Protocol):
    def save(self, data: bytes, ext: str, mime: str) -> str: ...
    def read(self, key: str) -> bytes: ...
    def response(self, key: str, mime: str | None) -> Response: ...


class LocalDiskStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, data: bytes, ext: str, mime: str = "application/octet-stream") -> str:
        key = new_key(ext)
        dest = self.root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return key

    def path_for(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise FileNotFoundError(key)
        return p

    def read(self, key: str) -> bytes:
        return self.path_for(key).read_bytes()

    def response(self, key: str, mime: str | None) -> Response:
        path = self.path_for(key)
        if not path.exists():
            raise FileNotFoundError(key)
        return FileResponse(path, media_type=mime, headers={"Cache-Control": "public, max-age=86400",
                                                            "X-Content-Type-Options": "nosniff"})


# Kept for anything importing the old name.
LocalStorage = LocalDiskStorage


class SupabaseStorage:
    """Supabase Storage over its REST API with the service key, server-side only.
    The service key never leaves this process; browsers only ever see signed URLs."""

    def __init__(self, url: str, service_key: str, bucket: str, ttl_seconds: int = 300,
                 client: httpx.Client | None = None):
        self.base = url.rstrip("/") + "/storage/v1"
        self.bucket = bucket
        self.ttl = ttl_seconds
        self._client = client or httpx.Client(timeout=30.0)
        self._auth = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    def __repr__(self) -> str:
        return f"<SupabaseStorage {self.base} bucket={self.bucket}>"

    def _object(self, key: str) -> str:
        return f"{quote(self.bucket)}/{quote(check_key(key))}"

    def save(self, data: bytes, ext: str, mime: str = "application/octet-stream") -> str:
        key = new_key(ext)
        r = self._client.post(f"{self.base}/object/{self._object(key)}", content=data,
                              headers={**self._auth, "Content-Type": mime, "x-upsert": "false",
                                       "Cache-Control": "max-age=3600"})
        r.raise_for_status()
        return key

    def read(self, key: str) -> bytes:
        r = self._client.get(f"{self.base}/object/authenticated/{self._object(key)}", headers=self._auth)
        if r.status_code in (400, 404):
            raise FileNotFoundError(key)
        r.raise_for_status()
        return r.content

    def signed_url(self, key: str) -> str:
        r = self._client.post(f"{self.base}/object/sign/{self._object(key)}", json={"expiresIn": self.ttl},
                              headers=self._auth)
        if r.status_code in (400, 404):
            raise FileNotFoundError(key)
        r.raise_for_status()
        signed = r.json().get("signedURL") or r.json().get("signedUrl")
        if not signed:
            raise FileNotFoundError(key)
        return signed if signed.startswith("http") else f"{self.base}{signed if signed.startswith('/') else '/' + signed}"

    def response(self, key: str, mime: str | None) -> Response:
        # A browser may cache the redirect only while the URL behind it is still valid.
        return RedirectResponse(self.signed_url(key), status_code=307,
                                headers={"Cache-Control": f"private, max-age={max(0, self.ttl - 60)}"})


def build_storage(s: Settings) -> Storage:
    if s.storage_backend == "supabase":
        return SupabaseStorage(s.supabase_url or "", s.supabase_service_key or "", s.supabase_storage_bucket,
                               s.signed_url_ttl_seconds)
    return LocalDiskStorage(s.upload_dir)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = build_storage(get_settings())
    return _storage


def set_storage(storage: Storage | None) -> None:
    """Swap the backend (tests, scripts). None rebuilds from settings on next use."""
    global _storage
    _storage = storage
