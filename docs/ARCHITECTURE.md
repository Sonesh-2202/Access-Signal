# Architecture

```
Browser (React 18 + Vite)
  ├─ MapLibre GL (OpenFreeMap vector tiles, configurable)
  ├─ Three.js via React Three Fiber (place entrance model, lazy-loaded)
  └─ fetch /api/*  ── Vite dev proxy / nginx in Docker ──┐
                                                         ▼
FastAPI (backend/app)
  ├─ api/routes        auth · reports · evidence · places · routing · issues · analytics · alerts · rides · meta
  ├─ services/ai       cloud provider chain (BYOK, Gemini, Groq, Nebius) + keyword fallback; classification, translation and route descriptions only. tiers.py is shared access to the cloud tiers
  ├─ services/intelligence   duplicates · confidence · hotspots (DBSCAN)
  ├─ services/routing  NetworkX graph in memory, per-profile costs, live barriers
  ├─ services/places   OSM-derived profiles enriched by reports
  └─ services/storage  local filesystem behind a small interface
                                                         ▼
SQLAlchemy 2 ── SQLite (default) or PostgreSQL/PostGIS (docker-compose)
                                                         ▲
scripts/osm_extract.py ── Overpass API ── backend/data/*.json ── scripts/seed_demo.py
```

## Decisions that differ from the implementation plan

| Plan | Built | Why |
|---|---|---|
| PostGIS geometry columns | Float lat/lng with composite indexes; bbox prefilter in SQL, haversine in Python | Same schema runs on SQLite (no Docker or Postgres was available on the dev machine) and on Postgres. At demo scale (thousands of rows) this is fast enough. Switching hot queries to PostGIS `ST_DWithin` is the upgrade path. |
| osmium / osmnx | Plain Overpass JSON + a ~200-line parser | Avoids heavy native dependencies on Windows. |
| OSM.org raster tiles default | OpenFreeMap Positron vector style default, raster via `VITE_MAP_STYLE=raster` | Vector tiles give building heights for the 3D view; still free and keyless. |
| Drei helpers | Plain R3F primitives | Smaller bundle; only boxes, cylinders and spheres are needed. |
| Chart library | Hand-written SVG with data tables | Small, matches the design system, accessible by construction. |

## Data model

Tables match the plan (`users`, `reports`, `evidence`, `places`, `place_accessibility`, `issues`, `issue_history`, `path_edges`, `hotspots`) plus `refresh_tokens`. Additions: `reports.confidence_breakdown` (JSON, the explained score), `reports.duplicate_of`, `reports.deleted_at` and `issues.deleted_at` (soft delete), `place_accessibility.source` and `notes`, `hotspots.trend` and `report_ids`. Schema is managed by Alembic (`backend/migrations`), with `create_all` on startup for zero-setup local runs.

## Request flow: a new report

1. Client uploads photos/voice to `POST /api/evidence`. Files are sniffed by magic bytes (client MIME is ignored), JPEG EXIF is stripped, and the file is stored as an unattached draft owned by the uploader.
2. `POST /api/reports/classify` sends text + photos to the first cloud tier that answers, with a JSON-schema response format. The order is a bring-your-own-key provider from the request if one was sent, then the server's keys in `AI_CLOUD_ORDER` (Gemini → Groq → Nebius). Each tier tries photos + schema, then text, then without the schema; a tier that fails hands over to the next, and the keyword classifier is always last. The result records which tier answered and why higher tiers didn't. See `app/services/ai/providers.py` and [DEPLOYMENT.md](DEPLOYMENT.md#decisions).
3. `POST /api/reports/duplicates` returns nearby candidates (50 m, 30 days).
4. `POST /api/reports` validates category and service area, links the nearest place within 40 m, attaches evidence, computes confidence, opens an issue (or records a corroboration on the original), and updates the place profile.
5. Routing picks the report up on the next request: barriers are mapped to edges within 25 m each time a route is computed.

## Text features that use AI: describing a route, and translation
Two features use a cloud model besides classification. Both are signed in, rate limited (`TEXT_AI_RATE_LIMIT_PER_MINUTE`), read-only, and need a cloud key or the user's own key. Without one they say so, and nothing else changes.
- **Describe a route (`POST /api/routing/describe`).** The model turns one sentence into a schema-checked intent: profile, start and end place names, avoid features, and optional detour and slope limits. The model never returns coordinates or a path. The server resolves the names against the places table (exact name first, then a phrase, then every word; ties are refused, not guessed), runs the existing A* router, checks each limit against the router's own numbers, and then asks a model for a two-to-four sentence explanation that cites the route as `[T1]`. The explanation is the only model output the user reads, and the route they see is the router's. If the explanation can't be written, the router's summary is shown and `source` is null.
- **Translation (`POST /api/reports/translate`).** Returns a draft labelled for review. Nothing is filed. A reporter who uses a translation files it with `translation` set, and the original text and its language are kept in `ai_analysis.translation` with `reviewed_by_reporter`.

The panel that answered free questions about reports and places was removed. It added little beyond the record pages and it was not needed for the safety-relevant features.

## Accessible rides, preflight and reliable routes (rules only)
- **Accessible ride handoff.** `app/data/accessible_rides.json` lists local services. Each entry carries the source page its phone number was checked against. `GET /api/rides` is public. `POST /api/rides/draft` fills a fixed template for the person to review. The app never books, calls a ride API, or sends anything.
- **Preflight brief.** `GET /api/places/{id}/preflight` returns Good, Caution or Blocked from rules, with tagged reasons (`[P1]` the place, `[R1]`... the open reports) and a link for each. Blocked means an open report that stops a wheelchair user (the router's rule), or a critical feature recorded as out of service.
- **Corridor risk.** `services/intelligence/risk.py` scores each street from 0 to 1 from hotspots (`1 - e^-n`), open barrier reports (`1 - e^-(n/2)`) and their mean confidence, then multiplies by a time-of-day factor from 1.0 to 1.5. The factor comes from report timestamps in New York hours and stays 1.0 with fewer than 30 reports. The router adds `1.5 x length x risk` only when `prefer_reliable` is set. Costs can only rise, so cost stays at or above length and A* stays admissible. Hypothesis tests check that bound with risk included.

## Alerts near me and saved routes (no AI)
- **Alerts near me.** Off by default. A person turns it on, chooses 100, 250 or 500 m, and shares a location. The location is rounded to four decimal places (about 11 m), kept for 24 hours at most, and forgotten when the feature is turned off. `services/alerts/check.py` `find_nearby` uses a bounding box on latitude and longitude, then exact great-circle distance. It counts open reports that are not deleted, resolved or duplicates, and out-of-service features of step-free entrances, ramps, elevators and accessible restrooms. `check_nearby` alerts each record once per person (dedupe key `nearby:report:<id>` or `nearby:outage:<id>`).
- **Saved routes.** A person can save up to ten routes. The check compares a fingerprint of each route (its length to 10 m, the barrier reports it passes, and its streets in order), so a change is a real change. Reports and outages are matched against the shortest walk within 25 m and 50 m, because that is where a barrier would affect the person, even when the saved profile routes around it. Only confirmed reports count: their issue is confirmed, assigned or in progress.
- **Delivery.** Every alert goes to the in-app inbox first. Web Push, through `pywebpush` with self-hosted VAPID keys, carries only a generic title, a short body and a relative link. No push contains an address, a place name, a corridor name or report text. A browser that drops its subscription is unsubscribed on the next send.
- **Scheduler.** `python -m scripts.check_corridors` runs the saved-route check and the nearby check. The workflow in `.github/workflows/route-alerts.yml` runs it every 15 minutes, off unless `ROUTE_ALERTS_ENABLED` is `true`. It prints counts only.
- **Reverification nudge.** When a repair is filed through the issue workflow, reporters of nearby open reports with the same subcategory (within 50 m) get an inbox item and a push. It changes no report.
- Migrations: `0003_alert_tables` adds saved routes, push subscriptions and the inbox. `0004_nearby_alerts` adds the per-user opt-in, radius and location columns.

## Security

- bcrypt password hashes; 30-minute JWT access tokens kept in memory; rotating refresh tokens stored as SHA-256 hashes. Replay of a rotated token revokes all of that user's sessions.
- Sliding-window rate limit on auth endpoints. Constant-work login path to reduce user enumeration.
- Role checks via dependencies (`manager_only`). Evidence ownership is checked before attaching.
- CSV export neutralises formula injection. Open-redirect guard on `?next=`. Security headers on API and nginx.
- Known gaps: rate limiter is in-process (one node only); refresh token lives in Web Storage rather than an httpOnly cookie (documented trade-off in `frontend/src/stores/auth.ts`).
