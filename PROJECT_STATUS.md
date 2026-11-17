# Project status

Status against `docs/IMPLEMENTATION_PLAN.md`, November 16, 2026, updated for the cloud-only refactor described at the end of this file.

**Verified** = exercised by an automated test or checked in a real browser during development.

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Project setup | Done | Monorepo, Vite/React/TS strict, FastAPI, docker-compose, `.env.example`, ESLint, Prettier |
| 2 | Design system | Done, verified | 5-colour tokens, 8px scale, Newsreader/Plex, base and layout components, focus styles |
| 3 | Schema and migrations | Done | Alembic `0001_initial_schema` (checked with `alembic check`), soft delete, seed script. Lat/lng floats instead of PostGIS geometry (see ARCHITECTURE.md) |
| 4 | Backend auth | Done, verified | bcrypt, JWT, rotating refresh tokens with replay detection, rate limiting, roles |
| 5 | Frontend auth | Done, verified | Login, register with strength meter, protected and staff routes, persistent session |
| 6 | Report API | Done, verified | Creation, uploads with magic-byte check and EXIF stripping, evidence, spatial list, detail, nearby |
| 7 | AI classification | Done, verified (mocked) | Cloud provider chain (BYOK, then Gemini, Groq, Nebius) with JSON-schema output, image input, fallbacks to keyword rules. No real provider call has been made (see Not verified) |
| 8 | Report creation flow | Done, verified (E2E) | Location picker, photos, voice with live transcription, AI preview, category cascade, duplicate check, draft preview |
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
| 25 | Backend tests | Done, verified | 100 pytest tests, including property-based routing tests, cloud provider tests and read-only chat tests. Providers run against a local fake OpenAI server; Supabase Storage against a mocked API |
| 26 | Frontend tests | Done, verified | 47 Vitest tests at the time, including component, axe and chat-panel tests (the chat panel was removed later). 31 Playwright E2E runs on desktop, mobile and 390 px. Current counts are in the README |
| 27 | Accessibility audit | Partial | Automated checks pass. **Manual screen reader and zoom testing not yet done**; see docs/ACCESSIBILITY_AUDIT.md |
| 28 | API docs | Done | Swagger at `/api/docs`, docs/API.md with examples |
| 29 | User docs | Done | README, USER_GUIDE, ARCHITECTURE. No screenshots embedded in the guide |
| 30 | Demo data and polish | Done, verified | Five-story Manhattan narrative plus 46 background reports, `--reset` script |

### Deployment work (November 16, 2026)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for how to run each mode.

| # | Task | Status | Notes |
|---|---|---|---|
| 33 | Cloud tiers (Mode A) | Done, verified (mocked) | `GeminiProvider`, `GroqProvider`, `NebiusProvider` share one prompt, schema and parser, with `AI_CLOUD_ORDER` setting the order. Photo rejection logged once, then text only. Every result carries `source`, `model`, `images_reviewed`, `fallback_reason`; the UI labels the tier |
| 34 | Keyword rules as the last tier | Done, verified | `HeuristicProvider` answers when no cloud tier does, labelled `heuristic` and "Keyword rules, AI offline" in the UI |
| 35 | BYOK | Done, verified | Settings page and report-form dialog. Key in tab `sessionStorage` only, sent as `X-AI-Provider`/`X-AI-Key` to classification and chat endpoints only; never stored, logged or echoed (tested). Separate per-IP limits for classification (20/min) and chat (10/min); AI endpoints capped at 16 KB and 64 KB bodies |
| 36 | Supabase Storage backend | Done, verified (mocked) | `LocalDiskStorage` default; `SupabaseStorage` uploads server-side with the service key, private bucket, 300 s signed URLs. Tests prove drafts and deleted reports never get a signed URL, URLs expire, EXIF is stripped before upload |
| 37 | Supabase Postgres + seeding | Done, verified on PostGIS | URL normalisation (psycopg 3, TLS), migration `0002` enables PostGIS. Seed is one transaction, idempotent, a one-off GitHub Actions job. Verified on `postgis/postgis:16-3.4`: seed from empty, second run skipped, `alembic check` clean |
| 38 | Hosted API config | Done | `render.yaml` (free plan, one worker on `$PORT`), production guard on `SECRET_KEY`, gzip, CORS allow-list with validation, `TRUSTED_PROXY_HOPS` |
| 39 | GitHub Pages frontend | Done, verified locally | Workflow injects `VITE_API_BASE` and `VITE_BASE_PATH`, copies `404.html`. Full E2E suite passed earlier against a Pages-style build on `/Access-Signal/` (served by `scripts/pages_preview.py`) with a production-mode API cross-origin on Postgres. That run predates the refactor |
| 40 | Cold starts (edge case 1) | Done, verified | Wake-up banner with backoff and refetch, checked in a real browser with the API stopped and then started. Keep-warm cron workflow, off unless `KEEP_WARM=true` |
| 41 | Mobile, speech, privacy copy (edge cases 4, 5) | Done, verified | 390 px E2E checks: search and *Use my location* above the map on the report step; map list and route planner don't overflow. Firefox users told before recording that transcription is unavailable. Report form, assistant and privacy page say which provider reads text and photos |

### Cloud-only refactor and the read-only assistant (the assistant was removed later)

The local model server path and the triage agents were removed. The app now uses cloud models with a keyword fallback only, and adds a read-only chat assistant.

| # | Task | Status | Notes |
|---|---|---|---|
| 42 | Remove local AI and agents | Done, verified | The local-server provider, its URL and model settings, the agent API routes, the monitor page and the agent spec document are deleted. Settings reject the removed local `AI_PROVIDER` values with a validation error |
| 43 | Chat backend | Removed | The read-only chat endpoint and its tests were removed in the rules-first revision. The route-description and translation features keep the same safeguards: schema checks, no writes, rate limits, key redaction |
| 44 | Chat frontend | Removed | The assistant panel, its store and the *Ask about this* buttons were removed. Route description now lives on the planner page |
| 45 | Draft this report | Done, verified (unit) | On the report form, a preview card proposes category, subcategory and summary. "Use these details" fills the form; nothing is filed. Drafting uses the schema-checked classifier endpoint rather than chat, because chat replies are free text
| 46 | Route planning from a request (AI-1) | Done, verified (mocked and unit) | Now `POST /api/routing/describe`, opened from the planner's *Describe your route* box. The model reads one sentence into a schema-checked intent. The server resolves place names from the places table and runs the existing router. The explanation cites `[T1]`. The model never supplies coordinates. Ties and unknown names are refused. Without a cloud key it says so |
| 47 | Accessible ride handoff (rules only) | Done, verified (unit) | The curated list in `app/data/accessible_rides.json`, with the source page for each number. `GET /api/rides` is public. `POST /api/rides/draft` fills a fixed template. The AI draft option was removed. Nothing is booked or sent |
| 48 | Corridor risk and reliable routes (AI-2) | Done, verified (unit, property, engine) | `services/intelligence/risk.py` scores streets from hotspots, open reports, confidence and time of day. The router adds a non-negative penalty only when *Prefer reliable routes* is set, so cost stays at or above length. Hypothesis tests cover the bound. Breakdown on the planner, formula on the methodology page |
| 49 | Route alerts (AI-4) | Done, verified (unit; push faked) | Migration `0003` adds saved routes, push subscriptions and the inbox. Opt-in. Web Push with self-hosted VAPID keys through `pywebpush`. `scripts/check_corridors.py` rechecks saved routes. Repairs nudge nearby reporters. Pushes carry no addresses, names or report text. The service worker and inbox are in Settings |
| 50 | Preflight brief (rules only) | Done, verified (unit) | Good, Caution or Blocked from rules, with tagged reasons, sources and a screen-reader sentence on each place page. The AI summary was removed |
| 51 | Multilingual reporting (AI-6) | Done, verified (unit) | A translation of a report draft is labelled as a draft and must be reviewed before it is used. The original and its language are stored with the report. The preferred language is kept on this device. The assistant replies were removed with the assistant |
| 52 | Proximity alerts near me (no AI) | Done, verified (unit and API; push faked) | Opt-in location, 100/250/500 m, a 24-hour expiry, and a one-off *Near you now* check that stores nothing. Dedupe per record and person. Pushes carry generic text only. `scripts/check_corridors.py` runs it with the saved-route checks. The scheduled workflow is off by default |

**Demo credentials are public on purpose.** The four demo accounts (password `Signal-demo-2026`) are published in the README and DEPLOYMENT.md so judges can sign in. They exist only in the disposable demo database, which is reset between sessions. Don't reuse that database or password for anything real.

**Auth decision.** The app keeps its own FastAPI auth (bcrypt, JWT, rotating refresh tokens). Supabase provides Postgres and Storage only. Reasoning is in DEPLOYMENT.md under *Decisions*.

## Not verified
- **Real Web Push delivery.** Push is tested with a stub. No notification has reached a real browser push service. That needs a deployed HTTPS site, VAPID keys in the environment, and a subscription from a real browser.
- **The alert schedule.** The workflow `route-alerts.yml` is written and runs on GitHub only when `ROUTE_ALERTS_ENABLED=true` and the secrets are set. It has not run on GitHub in this repository yet.
- **Ride numbers after release.** The numbers were checked against official pages once, when this was built. Check them again before each release, using the `source_url` in the JSON.
- **Quality of real model output.** Translation, route intent and summaries are tested against a fake server with fixed replies. Real models may name places that don't match the places table, or translate poorly.
- **Risk weights.** The constants in `risk.py` are design choices. They have not been fitted to real report data.
- **Alert migration on PostgreSQL.** Migration `0003` was run up, down and up again on SQLite. It has not been run against PostgreSQL.
- **Alert and preflight UI in the browser suite.** The new screens have Vitest and axe checks. The Playwright suite does not cover them.

- **The live hosted deployment.** Supabase, Render and the Pages workflow need the repository owner's accounts, so nothing has been deployed and the Playwright suite has not been run against a public URL. After deploying, run `E2E_BASE_URL=https://<owner>.github.io/<repo>/ npx playwright test` and record the result here.
- **Playwright E2E on the live site.** The full suite passed on desktop and 390 px against a locally seeded backend (31 passed, 3 skipped, with the seeding run on a throwaway database). It has not been run against the hosted deployment.
- **Real Gemini, Groq and Nebius calls.** These providers are tested against a fake OpenAI-compatible server only; no request has been made with a real key. In particular the defaults `gemini-3.5-flash-lite`, `openai/gpt-oss-20b` and `meta-llama/Llama-3.3-70B-Instruct` are taken from the providers' docs and model lists, not from a live call.
- **Route description from a real model.** The intent and explanation calls are tested against a fake server with fixed replies. Real models may name places that don't match the places table, or explain a route badly.
- **Answer quality of the route description and translation.** Tested against fixed fake replies only. Whether a real model follows the instructions has not been evaluated.
- **Real Supabase Storage.** Tested against a mock of its REST API (upload, authenticated read, sign, private bucket).
- **Render's proxy hop count** for `TRUSTED_PROXY_HOPS`.
- **docker-compose end to end.** The Postgres path and the backend start command are verified; the full compose stack has not been brought up since the refactor.
- **Manual assistive technology testing.** Includes the alerts-near-me controls and the inbox filters with a screen reader.

## Known limitations

- Rate limiting is per process. The free host runs a single worker, so limits hold there; more workers would each count separately.
- The report point picker needs a pointer; keyboard and phone users use search or *Use my location*, which come first on the page.
- Live transcription needs the Web Speech API (not Firefox). Firefox still records a voice note and asks for a typed description.
- Seeded voice evidence has transcripts only, no audio, and is labelled as such.
- The hosted demo's free AI quota is shared. When it runs out, classification falls back to keyword rules with the reason shown, and the assistant shows a message asking the user to try again later or add a key.
- Route planning matches place names only against the places table, which holds the OSM places and curated ones. Other places must be picked on the map. Each plan loads the whole places table, which is fine at about 900 rows and would need an index beyond that.
- The route planner's avoid options are limited to what the router already models. Stairs, steep slopes and rough surfaces are enforced only for the wheelchair and reduced-effort profiles.
