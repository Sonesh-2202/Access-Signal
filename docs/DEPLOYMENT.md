# Deployment

AccessSignal runs in three modes from the same code. Local is the default and needs no cloud account.

| Mode | Frontend | API | Database | Files | AI |
|---|---|---|---|---|---|
| **Local** (default) | Vite dev server | uvicorn on your machine | SQLite | `backend/uploads/` | Keyword rules, or cloud models once you add a key |
| **Docker** | nginx | container | PostGIS container | volume | Keyword rules, or cloud models with keys in `.env` |
| **Hosted demo** | GitHub Pages | Render free web service | Supabase Postgres | Supabase Storage (private bucket) | Gemini, then Groq, then Nebius, then keyword rules. Judges can bring their own key |

- [Judge quick demo](#judge-quick-demo)
- [AI keys and free tiers](#ai-keys-and-free-tiers)
- [Hosting the demo yourself](#hosting-the-demo-yourself)
- [Decisions](#decisions)
- [Free-tier facts, checked November 16, 2026](#free-tier-facts-checked-november-16-2026)
- [Known limits](#known-limits)

---

## Judge quick demo

About five minutes. Open the demo URL on a laptop or phone.

> **The first load may show "Demo server waking up — retrying…".** The free API host sleeps after 15 minutes without traffic and takes about a minute to start. The pages show the bundled demo data meanwhile, and switch to live data by themselves when the server answers. Signing in waits for it.

Demo accounts all use the password **`Signal-demo-2026`**. These credentials are public on purpose; the demo database is disposable and reset between sessions.

| Account | Role |
|---|---|
| `priya.raman@example.org` | Community member, wheelchair user |
| `dana.whitfield@city.example.org` | Infrastructure manager (DOT liaison) |
| `marcus.oyelaran@city.example.org` | Infrastructure manager (MTA accessibility) |
| `admin@city.example.org` | Admin |

1. **Home.** The most corroborated open report, its confidence breakdown, and a walking-versus-wheelchair route comparison.
2. **Plan a route.** Open *Plan a route*, pick the wheelchair profile. The route avoids the missing curb cut at Union Square and says what that costs: *"Avoids 1 reported barrier … 170 m longer"*.
3. **File a report** as Priya. On a phone, use *Use my location* or the address search; dragging the pin is optional. Add a photo, then *Suggest category*. The badge says which model answered, for example *Cloud AI (Gemini)*, and the model name. *Draft this report* offers a preview you can accept or discard.
4. **Turn on alerts near me.** In Settings, switch on *Alerts near me* and allow location. Open the home page and press *Check near me*: open barriers and out-of-service features within 250 m are listed with their distance. The inbox shows the same alerts.
5. **Optional: your own AI key.** If suggestions say *Keyword rules, AI offline* (shared free quota used up), choose *Use your own AI key* in the form or open **Settings** from the footer. A Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) takes about 30 seconds. The key stays in that browser tab and is deleted when you close it.
6. **Manager workflow** as Dana. *Dashboard* shows the priority queue. Open an issue, move it to *Under review*, add a note, and see it in the audit trail.

The demo files real reports. Ask the owner to reseed afterwards (see [Reset the demo](#reset-the-demo)).

---

## AI keys and free tiers

The app works with no AI key. Suggestions then come from keyword rules, labelled *Keyword rules, AI offline*. Translation and route descriptions are unavailable. Alerts near me, the route planner and the scores work in full, because they use no AI.

To use cloud models, set keys in the backend's environment (a platform variable, or `.env` at the repository root for local runs). Each provider is used only when its key is set:

| Variable | Provider | Photos | Get a key |
|---|---|---|---|
| `GEMINI_API_KEY` | Google Gemini, OpenAI-compatible endpoint | Yes | [Google AI Studio](https://aistudio.google.com/apikey) |
| `GROQ_API_KEY` | GroqCloud | No, text only | [GroqCloud console](https://console.groq.com/keys) |
| `NEBIUS_API_KEY` | Nebius Token Factory (optional) | Only with `NEBIUS_VISION=true` | [Nebius Token Factory](https://tokenfactory.nebius.com/project/api-keys) |

`AI_PROVIDER=cloud` (the default) uses whichever keys are set, in `AI_CLOUD_ORDER` (default `gemini,groq,nebius`). `AI_PROVIDER=none` turns cloud calls off and uses keyword rules only. At startup the API logs one line per tier, for example `AI tier Gemini: key configured (gemini-3.5-flash-lite)`. If no key is set, it logs a warning that names the variables.

**Bring your own key.** Anyone can paste a key in **Settings**. The browser sends it as `X-AI-Provider` / `X-AI-Key`, only with classification, translation and route-description requests. The key is never stored or logged, and it wins over the server keys for that request.

**Thinking models.** Gemini 3 and later always think, and thinking tokens count against the output budget. The Gemini provider sends `reasoning_effort: low` and allows 2,048 output tokens so an answer isn't cut off. An empty answer is logged with its `finish_reason`, and the next tier takes over.

**Photos.** Providers receive photos first. If a model rejects image input while accepting text, the log says so once, and later requests send text only.

---

## Hosting the demo yourself

Zero running cost: every service below is on a free plan with no card required, except that Gemini and Groq keys come from free developer tiers.

### 1. Supabase (database and photo storage)

1. Create a project at [supabase.com](https://supabase.com). Pick a region near your Render region.
2. **Connect → Session pooler**: copy the connection string. Use the pooler, not the direct `db.<ref>.supabase.co` host: the direct host is IPv6-only on free projects and Render's outbound network is IPv4. `postgresql://` URLs are accepted; the app switches them to psycopg 3 and adds `sslmode=require`.
3. **Project settings → API**: copy the project URL and the `service_role` key. The service key stays server-side (Render env vars and GitHub secrets). Never put it in a `VITE_` variable.
4. PostGIS: migration `0002` enables it automatically (`CREATE EXTENSION postgis WITH SCHEMA extensions`). The app stores coordinates as plain lat/lng floats, so nothing depends on it yet.

### 2. Seed the hosted database (one-off)

In GitHub: **Settings → Secrets and variables → Actions → Secrets**, add `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Then **Actions → Seed hosted database → Run workflow**. It:

- creates the private `evidence` bucket (`scripts/supabase_setup.py`, idempotent),
- runs Alembic migrations,
- loads the routing graph (24,527 edges), 918 places, the demo narrative and the demo accounts.

Seeding runs in one transaction and skips itself when data exists, so re-running is safe. It never runs on boot. Locally the same thing is:

```bash
cd backend
DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python -m scripts.supabase_setup
DATABASE_URL=... python -m scripts.seed_demo
```

#### Reset the demo

Run the workflow with **reset** ticked, or `python -m scripts.seed_demo --reset`. This deletes every report filed during the demo. Uploaded photos stay in the bucket; delete the bucket's contents in the Supabase dashboard if you want them gone.

### 3. Render (API)

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → pick this repository. `render.yaml` defines a free Python web service rooted at `backend/`.
2. Fill the prompted secrets: `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY` (optional), `NEBIUS_API_KEY` (optional), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. `SECRET_KEY` is generated.
3. Edit `CORS_ORIGINS` if your Pages origin isn't `https://sonesh-2202.github.io`. Origins only, no path.
4. Deploy. Start command: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1`. Health check: `/api/health`.

The same backend image runs on Koyeb or a Hugging Face Docker Space: `backend/Dockerfile` honours `$PORT`. Set the same env vars there.

### 4. GitHub Pages (frontend)

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables**: `VITE_API_BASE` = your Render URL, e.g. `https://accesssignal-api.onrender.com`. It's a variable, not a secret: it ends up in public JavaScript anyway.
3. Push to `main` (or run **Deploy frontend to GitHub Pages**). The site appears at `https://<owner>.github.io/<repo>/`.

The workflow builds with `VITE_BASE_PATH=/<repo>/` and copies `index.html` to `404.html`, so refreshing `/map`, `/reports` or `/dashboard` loads the app instead of a GitHub 404. For a custom domain, set the variable `PAGES_BASE_PATH=/`.

To try a Pages build locally, `scripts/pages_preview.py` serves `frontend/dist` the way Pages does (sub-path, 404 fallback, no proxy).

### 5. Keep it warm during judging

Render spins a free service down after 15 minutes without traffic; Supabase pauses a free project after 7 days without activity. `/api/health` touches both.

- Repository variables: `KEEP_WARM=true`, `API_HEALTH_URL=https://<your-service>.onrender.com/api/health`.
- `.github/workflows/keep-warm.yml` then pings every 10 minutes between 13:00 and 04:59 UTC. Edit the cron to match the judging window.
- GitHub can delay scheduled runs by several minutes, which is why the spacing is 10 rather than 14 minutes. GitHub also disables scheduled workflows in repositories with no activity for 60 days.
- One always-on service uses about 744 of Render's 750 free instance hours a month, so even 24/7 fits, but turn `KEEP_WARM` off after the event.

The frontend handles any remaining cold start: it shows the bundled dataset and the *Demo server waking up — retrying…* banner, pings `/api/health` with backoff for about 2.5 minutes, holds sign-in and report submission until the server answers, and then reloads live data.

### 6. Run the E2E suite against the live site

```bash
cd frontend
E2E_BASE_URL=https://<owner>.github.io/<repo>/ npx playwright test
```

The tests navigate relative to that URL, so the sub-path is kept. They file a report and edit an issue, so reset the demo afterwards. Wake the server first (open `/api/health`), or the first test may spend its timeout on the cold start.

### Environment variables

All of these are platform environment variables. Nothing secret is committed; `.env`, `.env.*` (except `.env.example`), `*.local`, `*.pem` and `*.key` are git-ignored.

| Variable | Where | Purpose |
|---|---|---|
| `ENVIRONMENT` | Render | `production` refuses the development `SECRET_KEY` |
| `SECRET_KEY` | Render (generated) | JWT signing |
| `DATABASE_URL` | Render, GitHub secret | Supabase session pooler URL |
| `AUTO_CREATE_TABLES` | Render | `false`: Alembic owns the schema |
| `AI_PROVIDER` | Render | `cloud` (default) uses the keys below; `none` uses keyword rules only |
| `AI_CLOUD_ORDER` | Render | default `gemini,groq,nebius` |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `NEBIUS_API_KEY` | Render | a tier is used only when its key is set |
| `GEMINI_MODEL`, `GROQ_MODEL`, `NEBIUS_MODEL`, `NEBIUS_VISION` | optional | model overrides |
| `STORAGE_BACKEND` | Render | `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Render, GitHub secret | Storage REST API, server-side only |
| `SUPABASE_STORAGE_BUCKET` | Render | default `evidence` |
| `SIGNED_URL_TTL_SECONDS` | optional | default 300 |
| `CORS_ORIGINS` | Render | Pages origin plus localhost dev origins |
| `TRUSTED_PROXY_HOPS` | Render | `1`; see [Known limits](#known-limits) |
| `BYOK_ENABLED`, `CLASSIFY_RATE_LIMIT_PER_MINUTE`, `CLASSIFY_MAX_BODY_BYTES` | optional | BYOK switch and classification limits |
| `TEXT_AI_RATE_LIMIT_PER_MINUTE`, `TEXT_AI_MAX_TOKENS`, `TEXT_AI_TEMPERATURE`, `TEXT_AI_MAX_BODY_BYTES` | optional | Limits for route descriptions and translations |
| `VITE_API_BASE` | GitHub variable | API origin baked into the frontend build |
| `VITE_BASE_PATH` / `PAGES_BASE_PATH` | workflow | site sub-path |

---

## Decisions

**Auth stays in FastAPI; Supabase Auth is not used.** The existing bcrypt + JWT + rotating refresh tokens (with replay detection) are covered by the backend tests, and the roles (community, infrastructure manager, admin) are app-specific. Moving to Supabase Auth would rewrite the auth layer and its tests for no functional gain in a demo. Supabase is used as Postgres and Storage only. Please don't reopen this without a new requirement.

**Photos: private bucket and signed URLs.** The API checks the evidence privacy rules first (a draft upload or evidence on a deleted report gets 404 and no URL is signed), then answers with a 307 redirect to a signed URL valid for `SIGNED_URL_TTL_SECONDS` (300 s). Object names are `YYYY/MM/<128-bit random hex>.<ext>`. Magic-byte checks and EXIF/GPS stripping run in the API before any bytes reach storage, on every backend. `backend/tests/test_storage.py` proves these rules against a mocked Supabase API.

**Cloud tiers.** Every provider shares one prompt, one JSON schema and one parser (`app/services/ai/providers.py`). The order on the hosted demo is Gemini (text and photos, best free vision quota), Groq (fast, text only; photos are not sent and the result says so), Nebius (only if `NEBIUS_API_KEY` is set, to use existing credits; never the default), then keyword rules. Each classification result carries `source`, `model`, `images_reviewed` and `fallback_reason`, and the UI shows them.

**Scheduled alert checks.** `python -m scripts.check_corridors` checks saved routes and alerts near me in one run. The workflow `.github/workflows/route-alerts.yml` runs it every 15 minutes. It is off unless the repository variable `ROUTE_ALERTS_ENABLED` is `true`, so forks and the public demo don't run it. To enable it, set the secret `DATABASE_URL` (the database the API uses) and, for browser push, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (generate them once with `python -m scripts.generate_vapid`), with `VAPID_SUBJECT` as an optional `mailto:` address. Without the VAPID keys alerts still reach the inbox, and only browser push is skipped. No cloud AI key is needed. GitHub may delay scheduled runs by several minutes.

**Local models are not supported.** Earlier versions could call a model server running on the same machine. That path was removed to keep the product to one code path: cloud models with bring-your-own-key, then keyword rules. A setting that selects a local server now fails validation at startup. The old URL and model variables are ignored.

**Text features are read-only.** `POST /api/routing/describe` and `POST /api/reports/translate` read one sentence or draft, return text, and write nothing. They need sign-in, a rate limit, and a cloud key or a user's own key. Without either they say so. Nothing else uses a model.

**BYOK.** A judge's key travels as `X-AI-Provider` / `X-AI-Key` on classification, translation and route-description requests only. The server builds a one-request provider with it and drops it; it isn't stored, logged or echoed in errors (tested). Base URLs and models always come from server settings, so a caller can't point the server at an arbitrary host. The key sits in the browser tab's `sessionStorage`, readable by anyone using that tab. That's acceptable for a demo session and not for public users.

**Privacy on free tiers.** Google's free Gemini tier may use submitted content to improve Google's products. The report form and the route description box say where your text goes before you send it. Do not put personal details in either.

---

## Free-tier facts, checked November 16, 2026

These change often. Re-check before an event and update this table rather than guessing.

| Service | What we found | Source |
|---|---|---|
| Gemini API (AI Studio) | Free tier covers `gemini-3.5-flash-lite` (default here) and `gemini-4-hydrogen`; input and output free of charge; free-tier content may be used to improve Google products. Per-model RPM/RPD are only shown per project in AI Studio. OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/`. Thinking can't be turned off on Gemini 3+; we send `reasoning_effort: low` and allow 2,048 output tokens | [pricing](https://aistudio.google.com/docs/pricing), [rate limits](https://aistudio.google.com/docs/rate-limits), [OpenAI compatibility](https://aistudio.google.com/docs/openai) |
| Groq | Production models include `openai/gpt-oss-20b` (default here) and `openai/gpt-oss-120b`; the free plan has per-model daily caps. The Llama 3.x models are now listed as Enterprise. `qwen/qwen3.8-27b` accepts files but is a preview model, so Groq stays text-only here | [models](https://console.groq.com/docs/models), [rate limits](https://console.groq.com/docs/rate-limits) |
| Nebius Token Factory | OpenAI-compatible at `https://api.tokenfactory.nebius.com/v1/`, key in `NEBIUS_API_KEY`. Several serverless models leave on December 9, 2026. Check `GET /v1/models` with your key and set `NEBIUS_MODEL` (and `NEBIUS_VISION=true` for a VL model) | [API intro](https://docs.tokenfactory.nebius.com/api-reference/introduction), [December 2026 deprecations](https://docs.tokenfactory.nebius.com/model-deprecations-december-2026.md) |
| Render | Free web service: 512 MB RAM, 0.1 CPU, 750 instance hours per workspace per month, spins down after 15 minutes without inbound traffic, about a minute to wake, ephemeral disk | [Render free docs](https://render.com/docs/free) |
| Koyeb | Free instance scales to zero after an hour idle and wakes in seconds; bandwidth over 100 GB/month is billed, so a card may be on file. Kept as the alternative | [Koyeb scale-to-zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero), [pricing FAQ](https://www.koyeb.com/docs/faqs/pricing) |
| Supabase | Free plan: 500 MB database (read-only above that), 1 GB file storage, 5 GB egress, 2 active projects, paused after 1 week of inactivity, no automatic backups, 50 MB max file size. Our seed uses well under 100 MB | [storage limits](https://supabase.com/docs/guides/storage/uploads/file-limits), plan summary in [SSD Nodes, October 2026](https://www.ssdnodes.com/learn/is-supabase-free-cloud-vs-self-hosted) |
| Fly.io | Not used: no meaningful free allowance | — |

---

## Known limits

- **Rate limiting is per process.** Login, registration, token refresh, classification and text-AI limits live in memory. The free host runs one uvicorn worker (`--workers 1`), so the limits hold. More workers or instances would each count separately; a shared store (Redis) would be needed then. The routing graph cache is per process too, and 512 MB fits one copy.
- **Client IPs behind Render's proxy.** Per-IP limits use `TRUSTED_PROXY_HOPS`: with `1`, the right-most `X-Forwarded-For` entry (written by the platform's proxy) is used, and client-forged entries further left are ignored. We haven't confirmed Render's hop count from inside a live service. After deploying, check that `X-Forwarded-For` has the shape you expect and adjust.
- **Cold starts.** The first request after 15 idle minutes waits about a minute. Handled by the keep-warm workflow and the wake-up banner.
- **Shared AI quota.** The demo's Gemini and Groq keys are free tiers shared by everyone using the demo. When they run out, classification falls back to keyword rules with the reason shown, and route descriptions and translations ask the user to try again later or add a key. Judges can paste their own key.
- **Supabase pause.** A week without traffic pauses the project; restore it from the Supabase dashboard (the data is kept).
