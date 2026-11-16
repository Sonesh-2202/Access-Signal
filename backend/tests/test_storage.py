"""Supabase Storage backend against a mocked Supabase API.

The mock behaves like a private bucket: objects can be read only with the service
key or a signed URL, and a signed URL stops working after its expiresIn. The tests
prove the evidence privacy rules hold on this path: drafts and deleted reports never
get a signed URL, signed URLs are short-lived, EXIF is gone before upload, and the
service key never reaches the browser."""

import io
import re
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.core.config import Settings, get_settings
from app.services.storage import LocalDiskStorage, SupabaseStorage, build_storage, check_key, set_storage
from tests.test_reports import UNION

SUPABASE = "https://demo-project.supabase.co"
SERVICE_KEY = "service-role-key-for-tests-only-a1b2c3d4e5f6"
BUCKET = "evidence"


class FakeSupabase:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.tokens: dict[str, tuple[str, float]] = {}  # token -> (object path, expires at)
        self.sign_requests: list[int] = []
        self.clock = time.time
        self.requests: list[httpx.Request] = []

    def _authed(self, req: httpx.Request) -> bool:
        return (req.headers.get("authorization") == f"Bearer {SERVICE_KEY}"
                and req.headers.get("apikey") == SERVICE_KEY)

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        path = req.url.path
        if m := re.fullmatch(rf"/storage/v1/object/sign/{BUCKET}/(.+)", path):
            if req.method == "POST":
                if not self._authed(req):
                    return httpx.Response(400, json={"error": "Unauthorized"})
                if m.group(1) not in self.objects:
                    return httpx.Response(400, json={"error": "not_found"})
                expires_in = int(httpx.Response(200, content=req.content).json()["expiresIn"])
                self.sign_requests.append(expires_in)
                token = f"tok{len(self.tokens)}"
                self.tokens[token] = (m.group(1), self.clock() + expires_in)
                return httpx.Response(200, json={"signedURL": f"/object/sign/{BUCKET}/{m.group(1)}?token={token}"})
            token = parse_qs(urlsplit(str(req.url)).query).get("token", [""])[0]
            obj, exp = self.tokens.get(token, (None, 0))
            if obj != m.group(1) or self.clock() > exp:
                return httpx.Response(400, json={"error": "InvalidJWT", "message": "jwt expired"})
            data, mime = self.objects[obj]
            return httpx.Response(200, content=data, headers={"content-type": mime})
        if m := re.fullmatch(rf"/storage/v1/object/authenticated/{BUCKET}/(.+)", path):
            if not self._authed(req) or m.group(1) not in self.objects:
                return httpx.Response(400, json={"error": "not_found"})
            return httpx.Response(200, content=self.objects[m.group(1)][0])
        if re.fullmatch(rf"/storage/v1/object/public/{BUCKET}/(.+)", path):
            return httpx.Response(400, json={"error": "Bucket not found"})  # private bucket
        if m := re.fullmatch(rf"/storage/v1/object/{BUCKET}/(.+)", path):
            if req.method == "POST":
                if not self._authed(req):
                    return httpx.Response(403, json={"error": "Unauthorized"})
                self.objects[m.group(1)] = (req.content, req.headers.get("content-type", ""))
                return httpx.Response(200, json={"Key": f"{BUCKET}/{m.group(1)}"})
            return httpx.Response(400, json={"error": "not_found"})  # unauthenticated read
        return httpx.Response(404)


@pytest.fixture
def supa():
    fake = FakeSupabase()
    client = httpx.Client(transport=httpx.MockTransport(fake.handler))
    set_storage(SupabaseStorage(SUPABASE, SERVICE_KEY, BUCKET, ttl_seconds=120, client=client))
    yield fake, client
    set_storage(None)


def _jpeg_with_gps() -> bytes:
    exif = b"\xff\xe1" + (2 + 10).to_bytes(2, "big") + b"Exif\x00\x00GPS!"
    jfif = b"\xff\xe0" + (2 + 5).to_bytes(2, "big") + b"JFIF\x00"
    return b"\xff\xd8" + jfif + exif + b"\xff\xda\x00\x02DATA\xff\xd9"


def _upload(client, headers) -> dict:
    r = client.post("/api/evidence", headers=headers, files={"file": ("p.jpg", io.BytesIO(_jpeg_with_gps()), "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()


def _report_with(client, headers, evidence_id) -> dict:
    r = client.post("/api/reports", headers=headers, json={
        **UNION, "category": "sidewalk", "subcategory": "missing_curb_cut",
        "description": "Curb cut removed on the corner.", "evidence_ids": [evidence_id]})
    assert r.status_code == 201, r.text
    return r.json()


def test_upload_strips_exif_before_it_reaches_supabase(client, user_headers, supa):
    fake, _ = supa
    ev = _upload(client, user_headers)
    assert len(fake.objects) == 1
    key, (data, mime) = next(iter(fake.objects.items()))
    assert b"GPS!" not in data and b"JFIF" in data and mime == "image/jpeg"
    # Unguessable object names: YYYY/MM/<128-bit random hex>.jpg
    assert re.fullmatch(r"\d{4}/\d{2}/[0-9a-f]{32}\.jpg", key)
    # The API response points at our own endpoint, never at Supabase.
    assert ev["url"] == f"/api/evidence/{ev['id']}/file"
    assert SUPABASE not in str(ev) and SERVICE_KEY not in str(ev)


def test_draft_and_deleted_evidence_never_get_a_signed_url(client, user_headers, supa):
    fake, _ = supa
    ev = _upload(client, user_headers)
    assert client.get(f"/api/evidence/{ev['id']}/file").status_code == 404
    assert fake.sign_requests == []  # privacy check ran before storage was asked
    rep = _report_with(client, user_headers, ev["id"])
    assert client.get(f"/api/evidence/{ev['id']}/file", follow_redirects=False).status_code == 307
    assert client.delete(f"/api/reports/{rep['id']}", headers=user_headers).status_code == 204
    before = len(fake.sign_requests)
    assert client.get(f"/api/evidence/{ev['id']}/file", follow_redirects=False).status_code == 404
    assert len(fake.sign_requests) == before


def test_signed_url_is_short_lived_and_expires(client, user_headers, supa):
    fake, http = supa
    ev = _upload(client, user_headers)
    _report_with(client, user_headers, ev["id"])
    r = client.get(f"/api/evidence/{ev['id']}/file", follow_redirects=False)
    assert r.status_code == 307
    assert fake.sign_requests == [120]
    assert r.headers["cache-control"] == "private, max-age=60"  # never cached past the URL's life
    signed = r.headers["location"]
    assert signed.startswith(f"{SUPABASE}/storage/v1/object/sign/{BUCKET}/") and "token=" in signed
    assert SERVICE_KEY not in signed
    # Works now, without any key...
    ok = http.get(signed)
    assert ok.status_code == 200 and b"GPS!" not in ok.content
    # ...and not after expiry.
    start = time.time()
    fake.clock = lambda: start + 121
    assert http.get(signed).status_code == 400


def test_private_bucket_refuses_direct_access(supa):
    fake, http = supa
    store = SupabaseStorage(SUPABASE, SERVICE_KEY, BUCKET, client=http)
    key = store.save(b"\xff\xd8\xff\xe0data", ".jpg", "image/jpeg")
    assert http.get(f"{SUPABASE}/storage/v1/object/public/{BUCKET}/{key}").status_code == 400
    assert http.get(f"{SUPABASE}/storage/v1/object/{BUCKET}/{key}").status_code == 400
    assert http.get(f"{SUPABASE}/storage/v1/object/authenticated/{BUCKET}/{key}").status_code == 400
    assert store.read(key) == b"\xff\xd8\xff\xe0data"  # only the server, with the service key


def test_classifier_reads_photos_back_from_supabase(client, user_headers, supa):
    fake, _ = supa
    ev = _upload(client, user_headers)
    r = client.post("/api/reports/classify", headers=user_headers,
                    json={"description": "Curb cut missing", "evidence_ids": [ev["id"]]})
    assert r.status_code == 200
    assert any("/object/authenticated/" in str(q.url) for q in fake.requests)


def test_object_keys_are_validated():
    for bad in ("../../etc/passwd", "2026/11/abc.jpg", "2026/11/" + "a" * 32 + ".exe", ""):
        with pytest.raises(FileNotFoundError):
            check_key(bad)
    check_key("2026/11/" + "a" * 32 + ".jpg")


def test_backend_selection_defaults_to_local_disk(tmp_path):
    assert isinstance(build_storage(Settings(upload_dir=tmp_path)), LocalDiskStorage)
    s = Settings(storage_backend="supabase", supabase_url=SUPABASE, supabase_service_key=SERVICE_KEY)
    assert isinstance(build_storage(s), SupabaseStorage)
    with pytest.raises(ValueError, match="SUPABASE_URL"):
        Settings(storage_backend="supabase")
    assert get_settings().storage_backend == "local"
