import io
import zlib

from app.services.ai.classifier import heuristic_classify
from app.utils.images import strip_jpeg_metadata

UNION = {"lat": 40.7349, "lng": -73.9906}


def _png() -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return len(d).to_bytes(4, "big") + t + d + zlib.crc32(t + d).to_bytes(4, "big")

    ihdr = (1).to_bytes(4, "big") * 2 + bytes([8, 2, 0, 0, 0])
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")


def test_heuristic_classifier_examples():
    c = heuristic_classify("Delivery truck parked on the ramp, blocking the ramp completely")
    assert (c.category, c.subcategory) == ("ramp", "blocked_ramp")
    assert c.source == "heuristic"
    c = heuristic_classify("The subway elevator at the station is out of service")
    assert c.category == "transit"
    assert heuristic_classify("lovely day").category == "other"


def test_classify_falls_back_without_lmstudio(client, user_headers):
    r = client.post("/api/reports/classify", headers=user_headers,
                    json={"description": "No curb cut at the corner after construction"})
    assert r.status_code == 200
    assert r.json()["source"] == "heuristic"
    assert r.json()["subcategory"] == "missing_curb_cut"


def _create(client, headers, **kw):
    body = {**UNION, "category": "sidewalk", "subcategory": "missing_curb_cut",
            "description": "Curb cut removed on the southwest corner during renovation work.", **kw}
    return client.post("/api/reports", json=body, headers=headers)


def test_create_report_opens_issue_and_scores(client, user_headers, manager_headers):
    r = _create(client, user_headers)
    assert r.status_code == 201, r.text
    rep = r.json()
    assert rep["status"] == "open"
    assert rep["issue_status"] == "reported"
    assert 0 < rep["confidence_score"] < 1
    assert len(rep["confidence_breakdown"]["explanation"]) == 4
    issues = client.get("/api/issues", headers=manager_headers).json()
    assert issues["total"] == 1
    assert issues["items"][0]["priority"] == "critical"


def test_report_validation(client, user_headers):
    assert _create(client, user_headers, category="sidewalk", subcategory="blocked_ramp").status_code == 422
    assert _create(client, user_headers, lat=40.80, lng=-73.95).status_code == 422  # outside service area
    assert _create(client, user_headers, description="   ").status_code == 422
    assert client.post("/api/reports", json={**UNION, "category": "other", "subcategory": "other",
                                             "description": "x"}).status_code == 401


def test_duplicates_and_corroboration(client, db, user_headers):
    from tests.conftest import login, make_user

    first = _create(client, user_headers).json()
    dup = client.post("/api/reports/duplicates", json={"lat": UNION["lat"] + 0.0001, "lng": UNION["lng"],
                                                       "category": "sidewalk", "subcategory": "missing_curb_cut",
                                                       "description": "curb cut missing on the corner"}).json()
    assert dup and dup[0]["report"]["id"] == first["id"]
    assert dup[0]["distance_m"] < 50

    make_user(db, "second@example.org")
    h2 = login(client, "second@example.org")
    second = _create(client, h2, duplicate_of=first["id"]).json()
    assert second["status"] == "duplicate"
    refreshed = client.get(f"/api/reports/{first['id']}").json()
    assert refreshed["confidence_score"] > first["confidence_score"]
    assert any(c["id"] == second["id"] for c in refreshed["corroborating"])


def test_far_report_is_not_duplicate(client, user_headers):
    _create(client, user_headers)
    dup = client.post("/api/reports/duplicates", json={"lat": UNION["lat"] + 0.002, "lng": UNION["lng"],
                                                       "category": "sidewalk", "subcategory": "missing_curb_cut",
                                                       "description": "curb cut missing"}).json()
    assert dup == []


def test_evidence_upload_attach_and_privacy(client, user_headers):
    up = client.post("/api/evidence", headers=user_headers, files={"file": ("p.png", io.BytesIO(_png()), "image/png")})
    assert up.status_code == 201, up.text
    ev = up.json()
    assert ev["type"] == "photo"
    # Drafts aren't publicly retrievable.
    assert client.get(f"/api/evidence/{ev['id']}/file").status_code == 404
    rep = _create(client, user_headers, evidence_ids=[ev["id"]]).json()
    assert rep["evidence_count"] == 1
    assert client.get(f"/api/evidence/{ev['id']}/file").status_code == 200
    # Can't reuse it.
    assert _create(client, user_headers, evidence_ids=[ev["id"]]).status_code == 400


def test_evidence_rejects_spoofed_type(client, user_headers):
    r = client.post("/api/evidence", headers=user_headers,
                    files={"file": ("x.jpg", io.BytesIO(b"<script>alert(1)</script>"), "image/jpeg")})
    assert r.status_code == 415


def test_strip_jpeg_metadata_removes_exif():
    exif = b"\xff\xe1" + (2 + 10).to_bytes(2, "big") + b"Exif\x00\x00GPS!"
    jfif = b"\xff\xe0" + (2 + 5).to_bytes(2, "big") + b"JFIF\x00"
    jpeg = b"\xff\xd8" + jfif + exif + b"\xff\xda\x00\x02DATA\xff\xd9"
    out = strip_jpeg_metadata(jpeg)
    assert b"GPS!" not in out and b"JFIF" in out and out.endswith(b"DATA\xff\xd9")


def test_soft_delete(client, user_headers):
    rep = _create(client, user_headers).json()
    assert client.delete(f"/api/reports/{rep['id']}", headers=user_headers).status_code == 204
    assert client.get(f"/api/reports/{rep['id']}").status_code == 404
    assert client.get("/api/reports").json()["total"] == 0
