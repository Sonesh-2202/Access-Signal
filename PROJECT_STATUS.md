# Project status

Status against `docs/IMPLEMENTATION_PLAN.md`, November 16, 2026.

**Verified** = exercised by an automated test or checked in a real browser during development.

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Project setup | Done | Monorepo, Vite/React/TS strict, FastAPI, docker-compose, `.env.example`, ESLint, Prettier |
| 2 | Design system | Done, verified | 5-colour tokens, 8px scale, Newsreader/Plex, base and layout components, focus styles |
| 3 | Schema and migrations | Done | Alembic `0001_initial_schema` (checked with `alembic check`), soft delete, seed script. Lat/lng floats instead of PostGIS geometry (see ARCHITECTURE.md) |
| 4 | Backend auth | Done, verified | bcrypt, JWT, rotating refresh tokens with replay detection, rate limiting, roles |
| 5 | Frontend auth | Done, verified | Login, register with strength meter, protected and staff routes, persistent session |
| 6 | Report API | Done, verified | Creation, uploads with magic-byte check and EXIF stripping, evidence, spatial list, detail, nearby |
| 7 | AI classification | Done | LM Studio client with JSON-schema output, image input, fallbacks. **Heuristic path verified; LM Studio path not exercised** because the server wasn't running during development |
| 8 | Report creation flow | Done, verified (E2E) | Location picker, photos, voice with live transcription, AI preview, category cascade, duplicate check |
| 9 | Report list and detail | Done, verified | Infinite scroll, filters, evidence viewer, confidence breakdown, community verify |
| 10 | Map foundation | Done, verified | MapLibre, configurable tiles, controls, Nominatim search, geolocation, list-only mode |
| 11 | Data layers | Done, verified | Clustered reports with severity encoding, popups, filters, heat, hotspots, coverage |
| 12 | Place discovery | Done, verified | Search, type, feature and verification filters, sidebar preview |
| 13 | 3D | Done, verified | Map building extrusions; Three.js entrance model on place profiles with WebGL detection and 2D fallback |
| 14 | OSM import and graph | Done, verified | Overpass extract: 18,854 nodes, 24,527 edges, 918 places; accessibility attributes from tags; stored in `path_edges` |
| 15 | Routing algorithm | Done, verified | A* with per-profile costs, live barriers, unknown penalty, alternatives, explanations. Hypothesis property tests on costs |
| 16 | Routing UI | Done, verified (E2E) | Inputs, profiles, comparison, map display, directions with segment details |
| 17 | Duplicate detection | Done, verified | 50 m / 30 days, text similarity, category match, scoring endpoint |
| 18 | Confidence scoring | Done, verified | Evidence, corroboration, recency, credibility, explanations |
| 19 | Hotspots | Done, verified | DBSCAN, severity index, dominant category, 14-day trend |
| 20 | Manager backend | Done, verified | Filters, assignment, transition validation, resolution, audit trail, CSV/JSON export |
| 21 | Manager frontend | Done, verified (E2E) | Pipeline, table, issue detail, status, assignment, resolution with photo |
| 22 | Analytics | Done, verified | Weekly trend, categories, resolution times, heat map, coverage gaps |
| 23 | Place profile backend | Done | OSM-derived features, report enrichment, verification status |
| 24 | Place profile frontend | Done, verified | Feature list with evidence links, timeline, report quick action |
| 25 | Backend tests | Done | 33 tests incl. property-based routing tests; LM Studio is mocked by pointing at a closed port |
| 26 | Frontend tests | Done | 16 Vitest component/axe tests; 27 Playwright E2E tests on desktop and mobile |
| 27 | Accessibility audit | Partial | Automated checks pass. **Manual screen reader and zoom testing not yet done**; see docs/ACCESSIBILITY_AUDIT.md |
| 28 | API docs | Done | Swagger at `/api/docs`, docs/API.md with examples |
| 29 | User docs | Done | README, USER_GUIDE, ARCHITECTURE. No screenshots embedded in the guide |
| 30 | Demo data and polish | Done, verified | Five-story Manhattan narrative plus 46 background reports, `--reset` script |
| 31 | Access Monitor spec | Done | docs/ACCESS_MONITOR_AGENT.md, typed outputs, tool definitions |
| 32 | Access Monitor implementation | Done, verified | Five agents, dry-run/apply, UI at `/dashboard/monitor` |

## Not verified

- **PostgreSQL / docker-compose.** Docker Desktop wasn't running on the dev machine, so the Postgres path and the Dockerfiles have not been run. The code uses only portable SQLAlchemy features, but treat this path as untested.
- **LM Studio classification.** The prompt, schema and parsing are written against the OpenAI-compatible API, but no call to a live model was made. Whether the Gemma build accepts image input depends on the model files; the client retries text-only if it doesn't.
- **Manual assistive technology testing.**

## Known limitations

- Rate limiting is per process.
- The report point picker needs a pointer; keyboard users use search or geolocation.
- Live transcription needs the Web Speech API (not Firefox).
- Seeded voice evidence has transcripts only, no audio, and is labelled as such.
