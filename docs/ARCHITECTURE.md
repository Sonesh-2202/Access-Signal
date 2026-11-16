# Architecture

```
Browser (React 18 + Vite)
  ├─ MapLibre GL (OpenFreeMap vector tiles, configurable)
  ├─ Three.js via React Three Fiber (place entrance model, lazy-loaded)
  └─ fetch /api/*  ── Vite dev proxy / nginx in Docker ──┐
                                                         ▼
FastAPI (backend/app)
  ├─ api/routes        auth · reports · evidence · places · routing · issues · analytics · chat · meta
  ├─ services/ai       cloud provider chain (BYOK, Gemini, Groq, Nebius) + keyword fallback; chat.py for the read-only assistant
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

## Chat assistant (read-only)

`POST /api/chat` answers a signed-in user's questions about one report, place or route, or about how the app works. It is read-only by design:

- **No writes.** The route never creates, updates or deletes rows, and keeps no conversation state. The browser sends the history with each request. A test asserts that row counts in every write table are unchanged after chat calls.
- **No tools.** The model gets no function or tool definitions and can't ask the server to act. The reply is shown as text.
- **Public data only.** The server loads the record from the `context` descriptor (`kind` plus an id, or origin and destination for a route). It uses the same serializers and routing engine as the public API. Deleted reports, drafts, evidence transcripts, file paths, email addresses and keys stay out of the context.
- **Grounded answers.** Each context item has a tag (`R1`, `P1`, `T1`). The system prompt requires citations by tag, and the response lists the cited items as `sources` with links to the record. If the model cites nothing, the response lists everything it was given.
- **Plain-text calls only.** The chat calls the provider with no `response_format` or JSON schema, and never passes the reply through the classification parser.
- **Limits.** Its own per-IP limit (`CHAT_RATE_LIMIT_PER_MINUTE`, default 10), up to 12 turns of 4,000 characters each, 6,000 characters of context, 500 output tokens, and a 64 KB request body.
- **Untrusted text.** Report descriptions and user messages are data. The context wraps them in delimiters, strips delimiter lookalikes, and the system prompt says to ignore instructions inside them.

The panel is `frontend/src/components/assistant/AssistantPanel.tsx`. It uses the same native dialog as the rest of the app, so focus moves in on open and back to the trigger on close.

## Security

- bcrypt password hashes; 30-minute JWT access tokens kept in memory; rotating refresh tokens stored as SHA-256 hashes. Replay of a rotated token revokes all of that user's sessions.
- Sliding-window rate limit on auth endpoints. Constant-work login path to reduce user enumeration.
- Role checks via dependencies (`manager_only`). Evidence ownership is checked before attaching.
- CSV export neutralises formula injection. Open-redirect guard on `?next=`. Security headers on API and nginx.
- Known gaps: rate limiter is in-process (one node only); refresh token lives in Web Storage rather than an httpOnly cookie (documented trade-off in `frontend/src/stores/auth.ts`).
