import math

EARTH_RADIUS_M = 6_371_000.0

# Bounding box of the demo area (Manhattan below ~59th St). Reports outside are rejected.
SERVICE_AREA = {"min_lat": 40.6950, "max_lat": 40.7700, "min_lng": -74.0250, "max_lng": -73.9600}


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bbox_around(lat: float, lng: float, radius_m: float) -> tuple[float, float, float, float]:
    """(min_lat, min_lng, max_lat, max_lng) enclosing a circle of radius_m."""
    dlat = math.degrees(radius_m / EARTH_RADIUS_M)
    dlng = math.degrees(radius_m / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
    return lat - dlat, lng - dlng, lat + dlat, lng + dlng


def in_service_area(lat: float, lng: float) -> bool:
    a = SERVICE_AREA
    return a["min_lat"] <= lat <= a["max_lat"] and a["min_lng"] <= lng <= a["max_lng"]


def circle_polygon(lat: float, lng: float, radius_m: float, steps: int = 24) -> dict:
    coords = []
    for i in range(steps + 1):
        theta = 2 * math.pi * i / steps
        dlat = math.degrees(radius_m * math.cos(theta) / EARTH_RADIUS_M)
        dlng = math.degrees(radius_m * math.sin(theta) / (EARTH_RADIUS_M * math.cos(math.radians(lat))))
        coords.append([round(lng + dlng, 6), round(lat + dlat, 6)])
    return {"type": "Polygon", "coordinates": [coords]}


def point_to_segment_m(lat: float, lng: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    """Approximate distance in metres from (lat, lng) to segment a-b where a and b are
    (lng, lat). Uses a local equirectangular projection; accurate at city scale."""
    k = math.cos(math.radians(lat))
    px, py = lng * k, lat
    ax, ay = a[0] * k, a[1]
    bx, by = b[0] * k, b[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        t = 0.0
    else:
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy) * (math.pi / 180) * EARTH_RADIUS_M
