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
- **Plain-text answers.** Answers call the provider with no `response_format` or JSON schema, and never pass the reply through the classification parser. The one structured call is route-intent extraction, described below.
- **Limits.** Its own per-IP limit (`CHAT_RATE_LIMIT_PER_MINUTE`, default 10), up to 12 turns of 4,000 characters each, 6,000 characters of context, 500 output tokens, and a 64 KB request body.
- **Untrusted text.** Report descriptions and user messages are data. The context wraps them in delimiters, strips delimiter lookalikes, and the system prompt says to ignore instructions inside them.

The panel is `frontend/src/components/assistant/AssistantPanel.tsx`. It uses the same native dialog as the rest of the app, so focus moves in on open and back to the trigger on close.

## Route planning from a request (AI-1)
The route planner's "Ask for a route" button opens the same panel with `intent: "plan_route"`. The server then reads the latest message as a route request:
1. **Intent.** The first cloud tier (the request's own key first, then the server's) returns JSON that must match `ROUTE_INTENT_SCHEMA` in `services/ai/prompts.py`: `profile`, `start`, `end` (place names), `avoid_features`, `max_detour_pct`, `max_incline`. If the model rejects `response_format`, the call is retried once without it. The reply is validated against `RouteIntent` (`extra="forbid"`, ranges and enums). A reply that doesn't validate is refused with a plain message.
2. **Places.** `resolve_place` matches the names against the `places` table. An exact name beats a phrase inside the name, which beats a match on every word. Ties are refused, not guessed. The server calls no geocoding service.
3. **Route.** `Router.route` (the A* engine) computes the route between the two places' stored coordinates. The model never returns coordinates or a path. `Router.shortest_walk_m` gives the baseline for `max_detour_pct`. `max_incline` is checked against the route's mapped segment slopes.
4. **Explanation.** The planned route goes into the same grounded context format as other answers, tagged `[T1]`. The model writes the explanation, and the response links `[T1]` to `/route?from=…&to=…&profile=…`.
5. **Unsupported limits.** `avoid_features` are checked against the profile. The router applies barrier and unknown-data penalties to every profile, and stairs, steep slopes and rough surfaces only to the wheelchair and reduced-effort profiles. Anything else is listed as *not enforced* and is never claimed as avoided.

Without a cloud tier the endpoint returns 503 "Route planning needs cloud AI", and the route planner page still works without AI. The route is drawn only after the user presses "Apply to map". That sends the plan through `stores/routePlan.ts`, which re-runs the normal route request. Nothing is written to the database.

## Accessible rides, corridor risk, alerts and preflight (AI-2 to AI-6)
- **Accessible ride handoff (AI-3).** `backend/app/data/accessible_rides.json` lists local services. Each entry carries the source page its phone number was checked against. `GET /api/rides` is public. `POST /api/rides/draft` returns a dispatcher message labelled as a draft to review. The fixed template always works. With `use_ai`, a cloud tier may write the message, but the text must keep the pickup, drop-off and wheelchair facts, or the template is used. Only `tel:` and `https:` links are rendered. Nothing is booked, sent or stored.
- **Corridor risk (AI-2).** `services/intelligence/risk.py` scores each street from 0 to 1. It combines hotspots (`1 - e^-n`), open barrier reports (`1 - e^-(n/2)`) and their mean confidence, then multiplies by a time-of-day factor from 1.0 to 1.5. The factor comes from report timestamps in New York hours, and it stays 1.0 with fewer than 30 reports. The router adds `1.5 x length x risk` only when `prefer_reliable` is set. Costs can only rise, so cost stays at or above length and A* stays admissible. Hypothesis tests check that bound with risk included. The response's `risk` object gives the breakdown and the summary sentence.
- **Route alerts (AI-4).** A person saves a route, up to ten per account, and chooses which kinds of change to hear about. Every alert goes to the in-app inbox first. Web Push goes through `pywebpush` with self-hosted VAPID keys (`python -m scripts.generate_vapid`). A push holds only generic text and a relative link. `python -m scripts.check_corridors` rechecks saved routes on a schedule. It compares a fingerprint of length, barrier ids and street order. Reports count once staff have confirmed their issue, and they are matched to the shortest walk within 25 m. Outages of step-free entrances, ramps and elevators count within 50 m. A repair filed through the issue workflow nudges reporters of open reports nearby with the same subcategory. The nudge changes no report. Migration `0003_alert_tables` adds the three tables. Push subscriptions that the browser drops are revoked.
- **Preflight brief (AI-5).** `GET /api/places/{id}/preflight` returns Good, Caution or Blocked from rules, with no model call. Blocked means an open report that stops a wheelchair user (the router's rule), or a critical feature recorded as out of service. Each reason starts with the tag of the record it comes from. `POST /api/places/{id}/preflight/summary` (signed in, rate limited) asks a cloud tier for a short summary of the same context, with citations. With no cloud tier, the rule text is returned and labelled `rules`.
- **Multilingual reporting (AI-6).** `POST /api/reports/translate` (signed in, rate limited) returns a translation labelled as a draft. The reporter edits it and chooses to file it. The call stores nothing. A filed translation keeps the original text and its language in `ai_analysis.translation`, with `reviewed_by_reporter` set. The reporter's language is kept in the browser only.

## Security

- bcrypt password hashes; 30-minute JWT access tokens kept in memory; rotating refresh tokens stored as SHA-256 hashes. Replay of a rotated token revokes all of that user's sessions.
- Sliding-window rate limit on auth endpoints. Constant-work login path to reduce user enumeration.
- Role checks via dependencies (`manager_only`). Evidence ownership is checked before attaching.
- CSV export neutralises formula injection. Open-redirect guard on `?next=`. Security headers on API and nginx.
- Known gaps: rate limiter is in-process (one node only); refresh token lives in Web Storage rather than an httpOnly cookie (documented trade-off in `frontend/src/stores/auth.ts`).
