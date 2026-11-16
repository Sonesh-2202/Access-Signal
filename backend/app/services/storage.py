"""Local filesystem storage behind a tiny interface so an S3-style backend can
replace it without touching the API layer."""

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

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


class Storage(Protocol):
    def save(self, data: bytes, ext: str) -> str: ...
    def read(self, key: str) -> bytes: ...
    def path_for(self, key: str) -> Path: ...


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, data: bytes, ext: str) -> str:
        now = datetime.now(UTC)
        rel = Path(f"{now:%Y}") / f"{now:%m}" / f"{uuid.uuid4().hex}{ext}"
        dest = self.root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return rel.as_posix()

    def path_for(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise FileNotFoundError(key)
        return p

    def read(self, key: str) -> bytes:
        return self.path_for(key).read_bytes()


_storage: LocalStorage | None = None


def get_storage() -> LocalStorage:
    global _storage
    if _storage is None:
        _storage = LocalStorage(get_settings().upload_dir)
    return _storage
