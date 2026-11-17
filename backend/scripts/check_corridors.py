"""Recheck saved routes and send alerts. Schedule it with any free scheduler, every 15 to 60 minutes:

    python -m scripts.check_corridors

It reads DATABASE_URL and the VAPID keys from the environment. It prints counts only, never
endpoints, keys or names."""

from app.core.database import SessionLocal
from app.services.alerts.check import check_all


def main() -> int:
    with SessionLocal() as db:
        totals = check_all(db)
    print(f"checked {totals['corridors']} saved routes, sent {totals['events']} alerts, "
          f"{totals['no_route']} had no route")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())