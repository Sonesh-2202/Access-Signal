"""Create the private evidence bucket in Supabase Storage. Safe to run repeatedly.

    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python -m scripts.supabase_setup

The bucket is private (no public URLs), limited to the file types and size the
API accepts. The app serves objects only through short-lived signed URLs."""

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402

MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]


def main() -> int:
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY first.")
        return 1
    base = s.supabase_url.rstrip("/") + "/storage/v1"
    auth = {"Authorization": f"Bearer {s.supabase_service_key}", "apikey": s.supabase_service_key}
    spec = {"id": s.supabase_storage_bucket, "name": s.supabase_storage_bucket, "public": False,
            "file_size_limit": s.max_file_size_bytes, "allowed_mime_types": MIME_TYPES}
    with httpx.Client(timeout=30.0, headers=auth) as c:
        r = c.get(f"{base}/bucket/{s.supabase_storage_bucket}")
        if r.status_code == 200:
            if r.json().get("public"):
                print(f"! Bucket '{s.supabase_storage_bucket}' is public. Making it private.")
            r = c.put(f"{base}/bucket/{s.supabase_storage_bucket}", json=spec)
            r.raise_for_status()
            print(f"Bucket '{s.supabase_storage_bucket}' exists; settings updated (private).")
        else:
            r = c.post(f"{base}/bucket", json=spec)
            r.raise_for_status()
            print(f"Created private bucket '{s.supabase_storage_bucket}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
