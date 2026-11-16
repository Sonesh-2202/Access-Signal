from tests.conftest import PASSWORD, make_user


def test_register_login_me(client):
    r = client.post("/api/auth/register", json={"email": "New@Example.org", "password": PASSWORD,
                                                "display_name": "  Sam  "})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "new@example.org"
    assert body["user"]["display_name"] == "Sam"
    assert body["user"]["role"] == "user"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.json()["email"] == "new@example.org"


def test_register_rejects_weak_password_and_duplicates(client, db):
    r = client.post("/api/auth/register", json={"email": "a@example.org", "password": "alllowercase",
                                                "display_name": "A"})
    assert r.status_code == 422
    make_user(db, "taken@example.org")
    r = client.post("/api/auth/register", json={"email": "taken@example.org", "password": PASSWORD,
                                                "display_name": "Taken"})
    assert r.status_code == 409


def test_wrong_password_is_generic(client, db):
    make_user(db, "x@example.org")
    a = client.post("/api/auth/login", json={"email": "x@example.org", "password": "Wrong-pass-1"})
    b = client.post("/api/auth/login", json={"email": "nobody@example.org", "password": "Wrong-pass-1"})
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]


def test_refresh_rotation_and_replay_detection(client, db):
    make_user(db, "r@example.org")
    first = client.post("/api/auth/login", json={"email": "r@example.org", "password": PASSWORD}).json()
    second = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert second.status_code == 200
    # Replaying the rotated token revokes the whole family, including the new one.
    assert client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": second.json()["refresh_token"]}).status_code == 401


def test_rate_limit(client, db):
    from app.api.routes.auth import limiter

    limiter.limit = 3
    try:
        codes = [client.post("/api/auth/login", json={"email": "z@example.org", "password": "Nope-nope-1"}).status_code
                 for _ in range(4)]
        assert codes[-1] == 429
    finally:
        limiter.limit = 1000


def test_manager_routes_require_role(client, user_headers):
    assert client.get("/api/issues").status_code == 401
    assert client.get("/api/issues", headers=user_headers).status_code == 403
