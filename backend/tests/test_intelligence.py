from datetime import UTC, datetime, timedelta

from app.services.intelligence.confidence import corroboration_score, recency_score
from app.services.intelligence.duplicates import score_pair
from app.services.intelligence.hotspots import dbscan, severity_index
from app.services.intelligence.text import cosine_similarity


def test_text_similarity_uses_synonyms():
    assert cosine_similarity("lift broken at station", "elevator out at the station") > 0.5
    assert cosine_similarity("ramp blocked", "audible signal missing") == 0


def test_duplicate_score_ordering():
    close_same = score_pair(5, True, True, 0.6)
    far_same = score_pair(45, True, True, 0.6)
    close_diff = score_pair(5, False, False, 0.6)
    assert close_same > far_same > close_diff


def test_corroboration_and_recency_monotonic():
    assert corroboration_score(0)[0] == 0
    assert corroboration_score(1)[0] < corroboration_score(3)[0] < 1
    now = datetime.now(UTC)
    assert recency_score(now, now)[0] > recency_score(now - timedelta(days=14), now)[0]
    assert abs(recency_score(now - timedelta(days=14), now)[0] - 0.5) < 0.01


def test_dbscan_groups_nearby_points():
    pts = [(40.7350, -73.9900), (40.7351, -73.9901), (40.7352, -73.9899),  # cluster
           (40.7450, -73.9800)]  # isolated
    labels = dbscan(pts, eps_m=120, min_pts=2)
    assert labels[0] == labels[1] == labels[2] >= 0
    assert labels[3] == -1


class _R:
    def __init__(self, s, c):
        self.severity_score, self.confidence_score = s, c


def test_severity_index_grows_with_volume():
    one = severity_index([_R(0.9, 0.9)])
    five = severity_index([_R(0.9, 0.9)] * 5)
    assert one < five <= 1
    assert severity_index([]) == 0
