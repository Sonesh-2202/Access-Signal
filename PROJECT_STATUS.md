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
| 7 | AI classification | Done, verified | Provider chain with JSON-schema output, image input, fallbacks. **Live-verified with Ollama 0.40.16 + `gemma4:12b`** on a real curb-ramp photo (see task 33). The LM Studio server itself still hasn't been run, but it shares the same client code path |
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
| 25 | Backend tests | Done | 71 tests incl. property-based routing tests. AI providers run against a local fake OpenAI server; Supabase Storage against a mocked API |
| 26 | Frontend tests | Done | 37 Vitest component/axe/client tests; 31 Playwright E2E runs on desktop, mobile and 390 px |
| 27 | Accessibility audit | Partial | Automated checks pass. **Manual screen reader and zoom testing not yet done**; see docs/ACCESSIBILITY_AUDIT.md |
| 28 | API docs | Done | Swagger at `/api/docs`, docs/API.md with examples |
| 29 | User docs | Done | README, USER_GUIDE, ARCHITECTURE. No screenshots embedded in the guide |
| 30 | Demo data and polish | Done, verified | Five-story Manhattan narrative plus 46 background reports, `--reset` script |
| 31 | Access Monitor spec | Done | docs/ACCESS_MONITOR_AGENT.md, typed outputs, tool definitions |
| 32 | Access Monitor implementation | Done, verified | Five agents, dry-run/apply, UI at `/dashboard/monitor` |

### Deployment work (November 16, 2026)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for how to run each mode.

| # | Task | Status | Notes |
|---|---|---|---|
| 33 | Ollama support (Mode A) | Done, verified live | `AI_PROVIDER=ollama` defaults to `http://localhost:11434/v1`, `gemma4:12b` (the registry tag; `gemma4-12b` doesn't exist). Startup probe logs the active tier. Live result, RTX 3060: photo only → `crossing/missing_tactile_paving`, `images_reviewed: true`, 5.0 s; photo + "delivery van parked across this curb ramp" → `ramp/blocked_ramp`, severity 1.0, 4.6 s. Found and fixed on the way: over `/v1`, gemma4 thinks by default and returned empty content; the provider now sends `reasoning_effort: "none"` |
| 34 | Provider-agnostic AI (Mode B) | Done, verified (mocked) | `LocalProvider`, `GeminiProvider`, `GroqProvider`, `NebiusProvider`, `HeuristicProvider` share one prompt, schema and parser. Photo rejection logged once, then text only. Every result carries `source`, `model`, `images_reviewed`, `fallback_reason`; the UI labels the tier |
| 35 | BYOK (Mode B, edge case 7) | Done, verified | Settings page and report-form dialog. Key in tab `sessionStorage` only, sent as `X-AI-Provider`/`X-AI-Key` to classification and agent endpoints only; never stored, logged or echoed (tested). Per-IP limit (20/min) applies with or without a key; AI endpoints capped at 16 KB bodies |
| 36 | Supabase Storage backend | Done, verified (mocked) | `LocalDiskStorage` default; `SupabaseStorage` uploads server-side with the service key, private bucket, 300 s signed URLs. Tests prove drafts and deleted reports never get a signed URL, URLs expire, EXIF is stripped before upload |
| 37 | Supabase Postgres + seeding | Done, verified on PostGIS | URL normalisation (psycopg 3, TLS), migration `0002` enables PostGIS. Seed is one transaction, idempotent, a one-off GitHub Actions job. Verified on `postgis/postgis:16-3.4`: seed from empty, second run skipped, `alembic check` clean |
| 38 | Hosted API config | Done | `render.yaml` (free plan, one worker on `$PORT`), production guard on `SECRET_KEY`, gzip, CORS allow-list with validation, `TRUSTED_PROXY_HOPS` |
| 39 | GitHub Pages frontend | Done, verified locally | Workflow injects `VITE_API_BASE` and `VITE_BASE_PATH`, copies `404.html`. Full E2E suite passed against a Pages-style build on `/Access-Signal/` (served by `scripts/pages_preview.py`) calling a production-mode API cross-origin on Postgres with Ollama |
| 40 | Cold starts (edge case 1) | Done, verified | Wake-up banner with backoff and refetch, checked in a real browser with the API stopped and then started. Keep-warm cron workflow, off unless `KEEP_WARM=true` |
| 41 | Mobile, speech, privacy copy (edge cases 4, 5) | Done, verified | 390 px E2E checks: search and *Use my location* above the map on the report step; map list and route planner don't overflow. Firefox users told before recording that transcription is unavailable. Report form and privacy page say which provider reads evidence |

**Demo credentials are public on purpose.** The four demo accounts (password `Signal-demo-2026`) are published in the README and DEPLOYMENT.md so judges can sign in. They exist only in the disposable demo database, which is reset between sessions. Don't reuse that database or password for anything real.

**Auth decision.** The app keeps its own FastAPI auth (bcrypt, JWT, rotating refresh tokens). Supabase provides Postgres and Storage only. Reasoning is in DEPLOYMENT.md under *Decisions*.

## Not verified

- **The live hosted deployment.** Supabase, Render and the Pages workflow need the repository owner's accounts, so nothing has been deployed and the Playwright suite has not yet run against a public URL. Every piece was rehearsed locally (task 39). After deploying, run `E2E_BASE_URL=https://<owner>.github.io/<repo>/ npx playwright test` and record the result here.
- **Real Gemini, Groq and Nebius calls.** These providers are tested against a fake OpenAI-compatible server only; no request has been made with a real key. In particular the defaults `gemini-3.5-flash-lite`, `openai/gpt-oss-20b` and `meta-llama/Llama-3.3-70B-Instruct` are taken from the providers' docs and model lists, not from a live call.
- **Real Supabase Storage.** Tested against a mock of its REST API (upload, authenticated read, sign, private bucket).
- **Render's proxy hop count** for `TRUSTED_PROXY_HOPS`.
- **LM Studio server.** Not run; it uses the same OpenAI-compatible client that was verified live with Ollama.
- **docker-compose end to end.** The Postgres path and the backend start command are verified; the full compose stack has not been brought up.
- **Manual assistive technology testing.**

## Known limitations

- Rate limiting is per process. The free host runs a single worker, so limits hold there; more workers would each count separately.
- The report point picker needs a pointer; keyboard and phone users use search or *Use my location*, which come first on the page.
- Live transcription needs the Web Speech API (not Firefox). Firefox still records a voice note and asks for a typed description.
- Seeded voice evidence has transcripts only, no audio, and is labelled as such.
- The hosted demo's free AI quota is shared. When it runs out, results fall back to keyword rules with the reason shown.
