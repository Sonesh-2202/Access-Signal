"""Run the scheduled alert checks in one command: saved routes, then alerts near me.

    python -m scripts.check_corridors

Schedule it every 10 to 15 minutes (see .github/workflows/route-alerts.yml). It reads DATABASE_URL and the
VAPID keys from the environment and prints counts only: no addresses, names, endpoints or keys.
Off unless the scheduler is turned on; nothing here needs a cloud AI key."""

from app.core.database import SessionLocal
from app.services.alerts.check import check_all, check_nearby_all


def main() -> int:
    with SessionLocal() as db:
        routes = check_all(db)
        nearby = check_nearby_all(db)
    print(
        f"saved routes: checked {routes['corridors']}, sent {routes['events']} alerts, "
        f"{routes['no_route']} had no route. "
        f"Alerts near me: {nearby['users']} people checked, {nearby['events']} alerts sent, "
        f"{nearby['purged']} expired locations cleared."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
