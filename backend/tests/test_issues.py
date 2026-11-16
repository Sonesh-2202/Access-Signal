from tests.conftest import make_user


def _report(client, headers):
    r = client.post("/api/reports", headers=headers, json={
        "lat": 40.7349, "lng": -73.9906, "category": "ramp", "subcategory": "blocked_ramp",
        "description": "Truck parked across the ramp at the entrance."})
    assert r.status_code == 201
    return r.json()


def _issue_id(client, manager_headers):
    return client.get("/api/issues", headers=manager_headers).json()["items"][0]["id"]


def test_full_workflow(client, db, user_headers, manager_headers):
    rep = _report(client, user_headers)
    iid = _issue_id(client, manager_headers)
    mgr_id = client.get("/api/issues/assignees", headers=manager_headers).json()[0]["id"]

    def patch(**body):
        return client.patch(f"/api/issues/{iid}", headers=manager_headers, json=body)

    assert patch(status="confirmed").status_code == 200
    # Must assign before 'assigned'.
    assert patch(status="assigned").status_code == 409
    assert patch(assigned_to=mgr_id, status="assigned").status_code == 200
    assert patch(status="in_progress").status_code == 200
    assert patch(status="resolved").status_code == 409  # needs resolution notes
    done = patch(status="resolved", resolution_notes="Truck moved and loading zone relocated.")
    assert done.status_code == 200
    body = done.json()
    assert body["status"] == "resolved"
    assert body["allowed_transitions"] == ["reverification"]
    assert [h["new_status"] for h in body["history"]][-1] == "resolved"
    assert client.get(f"/api/reports/{rep['id']}").json()["status"] == "resolved"

    # Community says it's back: resolved -> reverification.
    v = client.post(f"/api/reports/{rep['id']}/verify", headers=user_headers, json={"still_present": True})
    assert v.status_code == 200
    assert client.get(f"/api/issues/{iid}", headers=manager_headers).json()["status"] == "reverification"


def test_invalid_transition(client, user_headers, manager_headers):
    _report(client, user_headers)
    iid = _issue_id(client, manager_headers)
    r = client.patch(f"/api/issues/{iid}", headers=manager_headers, json={"status": "resolved"})
    assert r.status_code == 409


def test_cannot_assign_to_community_user(client, db, user_headers, manager_headers):
    _report(client, user_headers)
    iid = _issue_id(client, manager_headers)
    civilian = make_user(db, "civ@example.org")
    r = client.patch(f"/api/issues/{iid}", headers=manager_headers, json={"assigned_to": civilian.id})
    assert r.status_code == 422


def test_export_csv_neutralises_formulas(client, user_headers, manager_headers):
    client.post("/api/reports", headers=user_headers, json={
        "lat": 40.7349, "lng": -73.9906, "category": "other", "subcategory": "other",
        "description": "=HYPERLINK(\"http://evil\")"})
    r = client.get("/api/issues/export?format=csv", headers=manager_headers)
    assert r.status_code == 200
    assert "'=HYPERLINK" in r.text
    j = client.get("/api/issues/export?format=json", headers=manager_headers).json()
    assert len(j) == 1


def test_agents_dry_run_does_not_write(client, user_headers, manager_headers):
    rep = _report(client, user_headers)
    iid = _issue_id(client, manager_headers)
    before = len(client.get(f"/api/issues/{iid}", headers=manager_headers).json()["history"])
    out = client.post("/api/agents/intake/run", headers=manager_headers, json={"report_id": rep["id"]}).json()
    assert out["agent"] == "intake"
    assert "photo" in out["missing"]
    assert all(not a["applied"] for a in out["actions"])
    assert len(client.get(f"/api/issues/{iid}", headers=manager_headers).json()["history"]) == before
    client.post("/api/agents/intake/run", headers=manager_headers, json={"report_id": rep["id"], "apply": True})
    hist = client.get(f"/api/issues/{iid}", headers=manager_headers).json()["history"]
    assert any((h["notes"] or "").startswith("Access Monitor:") for h in hist)
