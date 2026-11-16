import os
import tempfile
import uuid
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="accesssignal-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["AI_API_BASE"] = "http://127.0.0.1:9/v1"  # nothing listens here: forces heuristic fallback
os.environ["AUTH_RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["SECRET_KEY"] = "test-secret-key-with-enough-length-1234"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import PathEdge, User  # noqa: E402
from app.services.routing.engine import reset_graph  # noqa: E402

PASSWORD = "Correct-horse-9"

# A 5x5 street grid near Union Square, ~110 m between nodes.
GRID_LAT, GRID_LNG, STEP = 40.7350, -73.9930, 0.001


def node_id(i: int, j: int) -> str:
    return f"n{i}_{j}"


def grid_edges(blocked: set[tuple[str, str]] = frozenset(), steps: set[tuple[str, str]] = frozenset()):
    from app.utils.geo import haversine_m

    rows = []
    for i in range(5):
        for j in range(5):
            for di, dj in ((1, 0), (0, 1)):
                ni, nj = i + di, j + dj
                if ni > 4 or nj > 4:
                    continue
                a = [GRID_LNG + j * STEP, GRID_LAT + i * STEP]
                b = [GRID_LNG + nj * STEP, GRID_LAT + ni * STEP]
                u, v = node_id(i, j), node_id(ni, nj)
                attrs = {"highway": "residential", "has_steps": (u, v) in steps}
                if (u, v) in steps:
                    attrs["highway"] = "steps"
                length = haversine_m(a[1], a[0], b[1], b[0])
                rows.append(PathEdge(id=str(uuid.uuid4()), from_node=u, to_node=v, coords=[a, b], length_m=length,
                                     name=f"Street {i}-{j}", accessibility_attributes=attrs,
                                     wheelchair_cost=length, walking_cost=length))
    return rows


@pytest.fixture(autouse=True)
def fresh_db():
    from app.api.routes.auth import limiter

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    reset_graph()
    limiter.reset()
    yield
    reset_graph()


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def make_user(db, email: str, role: str = "user", name: str = "Test User") -> User:
    u = User(email=email, display_name=name, role=role, password_hash=hash_password(PASSWORD))
    db.add(u)
    db.commit()
    return u


def login(client, email: str) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def user_headers(client, db):
    make_user(db, "reporter@example.org", name="Reporter")
    return login(client, "reporter@example.org")


@pytest.fixture
def manager_headers(client, db):
    make_user(db, "manager@example.org", role="infrastructure_manager", name="Manager")
    return login(client, "manager@example.org")


@pytest.fixture
def grid(db):
    db.add_all(grid_edges())
    db.commit()
    reset_graph()
