# Deployment

AccessSignal runs in three modes from the same code. Local is the default and needs no cloud account.

| Mode | Frontend | API | Database | Files | AI |
|---|---|---|---|---|---|
| **Local** (default) | Vite dev server | uvicorn on your machine | SQLite | `backend/uploads/` | LM Studio or Ollama, then keyword rules |
| **Docker** | nginx | container | PostGIS container | volume | LM Studio or Ollama on the host |
| **Hosted demo** | GitHub Pages | Render free web service | Supabase Postgres | Supabase Storage (private bucket) | Gemini, then Groq, then Nebius, then keyword rules. Judges can bring their own key |

- [Judge quick demo](#judge-quick-demo)
- [Self-hoster quick start with Ollama](#self-hoster-quick-start-with-ollama)
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
3. **File a report** as Priya. On a phone, use *Use my location* or the address search; dragging the pin is optional. Add a photo, then *Suggest category*. The badge says which model answered, for example *Cloud AI (Gemini)*, and the model name.
4. **Optional: your own AI key.** If suggestions say *Keyword rules, AI offline* (shared free quota used up), choose *Use your own AI key* in the form or open **Settings** from the footer. A Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) takes about 30 seconds. The key stays in that browser tab and is deleted when you close it.
5. **Manager workflow** as Dana. *Dashboard* shows the priority queue. Open an issue, move it to *Under review*, add a note, and see it in the audit trail.
6. **Access Monitor.** *Dashboard → Monitor*. Agents run as a dry run by default. They can add notes and move reports into review; only staff can confirm, assign or resolve.

The demo files real reports. Ask the owner to reseed afterwards (see [Reset the demo](#reset-the-demo)).

---

## Self-hoster quick start with Ollama

Everything runs on your machine; nothing leaves it.

1. Install [Ollama](https://ollama.com) and pull the model. The registry tag is `gemma4:12b` (with a colon):

   ```bash
   ollama pull gemma4:12b
   ```

   12B needs about 9 GB of free GPU memory for the Q4 build. On smaller machines use `gemma4:e4b` and set `AI_MODEL=gemma4:e4b`.

2. Set up the app (Windows: `.\scripts\setup_dev.ps1`, macOS/Linux: `scripts/setup_dev.sh`) and create `.env` at the repository root:

   ```dotenv
   AI_PROVIDER=ollama
   ```

   That's all: the base URL defaults to `http://localhost:11434/v1` and the model to `gemma4:12b`. To use LM Studio instead, leave `AI_PROVIDER` unset (default `lmstudio`, `http://localhost:1234/v1`).

3. Start the API and the frontend:

   ```bash
   cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000
   cd frontend && npm run dev
   ```

   The API logs one line per AI tier at startup, for example
   `AI tier Ollama: available (gemma4:12b at http://localhost:11434/v1)`.
   If Ollama isn't running you'll see `not reachable`, and the keyword classifier answers. The UI labels those results *Keyword rules, AI offline*.

**What we measured** (Ollama 0.40.16, `gemma4:12b` Q4_K_M, RTX 3060 12 GB): a real curb-ramp photo with no text came back as `crossing / missing_tactile_paving`, `images_reviewed: true`, in 5.0 s. The same photo with "A delivery van is parked across this curb ramp…" came back as `ramp / blocked_ramp`, severity 1.0, in 4.6 s.

**Thinking mode.** Over Ollama's OpenAI-compatible API, `gemma4:12b` thinks by default and spends the whole `max_tokens` budget on hidden reasoning, leaving the answer empty. The Ollama provider sends `reasoning_effort: "none"`, which fixes this. If you point `AI_PROVIDER=ollama` at an older Ollama that ignores the flag, the log says `empty answer (finish_reason=length, output went to reasoning)`.

**Photos.** The provider sends photos first. If a model rejects image input while accepting text, the log says once, on one line, `Ollama model … rejected image input (…); classifying text only from now on.`, and later requests skip the photos. `gemma4:12b` accepted images in our test.

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
| `AI_PROVIDER` | Render | `cloud` for the demo; `lmstudio` / `ollama` / `none` elsewhere |
| `AI_API_BASE`, `AI_MODEL` | local | override the local server's URL and model |
| `AI_CLOUD_ORDER` | Render | default `gemini,groq,nebius` |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `NEBIUS_API_KEY` | Render | a tier is used only when its key is set |
| `GEMINI_MODEL`, `GROQ_MODEL`, `NEBIUS_MODEL`, `NEBIUS_VISION` | optional | model overrides |
| `STORAGE_BACKEND` | Render | `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Render, GitHub secret | Storage REST API, server-side only |
| `SUPABASE_STORAGE_BUCKET` | Render | default `evidence` |
| `SIGNED_URL_TTL_SECONDS` | optional | default 300 |
| `CORS_ORIGINS` | Render | Pages origin plus localhost dev origins |
| `TRUSTED_PROXY_HOPS` | Render | `1`; see [Known limits](#known-limits) |
| `BYOK_ENABLED`, `CLASSIFY_RATE_LIMIT_PER_MINUTE`, `CLASSIFY_MAX_BODY_BYTES` | optional | BYOK switch and abuse limits |
| `VITE_API_BASE` | GitHub variable | API origin baked into the frontend build |
| `VITE_BASE_PATH` / `PAGES_BASE_PATH` | workflow | site sub-path |

---

## Decisions

**Auth stays in FastAPI; Supabase Auth is not used.** The existing bcrypt + JWT + rotating refresh tokens (with replay detection) are covered by the backend tests, and the roles (community, infrastructure manager, admin) are app-specific. Moving to Supabase Auth would rewrite the auth layer and its tests for no functional gain in a demo. Supabase is used as Postgres and Storage only. Please don't reopen this without a new requirement.

**Photos: private bucket and signed URLs.** The API checks the evidence privacy rules first (a draft upload or evidence on a deleted report gets 404 and no URL is signed), then answers with a 307 redirect to a signed URL valid for `SIGNED_URL_TTL_SECONDS` (300 s). Object names are `YYYY/MM/<128-bit random hex>.<ext>`. Magic-byte checks and EXIF/GPS stripping run in the API before any bytes reach storage, on every backend. `backend/tests/test_storage.py` proves these rules against a mocked Supabase API.

**AI tiers.** Every provider shares one prompt, one JSON schema and one parser (`app/services/ai/providers.py`). The order on the hosted demo is Gemini (text and photos, best free vision quota), Groq (fast, text only; photos are not sent and the result says so), Nebius (only if `NEBIUS_API_KEY` is set, to use existing credits; never the default), then keyword rules. Each result carries `source`, `model`, `images_reviewed` and `fallback_reason`, and the UI shows them.

**BYOK.** A judge's key travels as `X-AI-Provider` / `X-AI-Key` on classification and agent requests only. The server builds a one-request provider with it and drops it; it isn't stored, logged or echoed in errors (tested). Base URLs and models always come from server settings, so a caller can't point the server at an arbitrary host. The key sits in the browser tab's `sessionStorage`, readable by anyone using that tab. That's acceptable for a demo session and not for public users.

**Privacy on free tiers.** Google's free Gemini tier may use submitted content to improve Google's products. The report form tells the reporter which provider will read their text and photos before they ask for a suggestion, and the privacy page says the same. Self-hosted copies with Ollama or LM Studio send nothing out.

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

- **Rate limiting is per process.** Login, registration, token refresh and classification limits live in memory. The free host runs one uvicorn worker (`--workers 1`), so the limits hold. More workers or instances would each count separately; a shared store (Redis) would be needed then. The routing graph cache is per process too, and 512 MB fits one copy.
- **Client IPs behind Render's proxy.** Per-IP limits use `TRUSTED_PROXY_HOPS`: with `1`, the right-most `X-Forwarded-For` entry (written by the platform's proxy) is used, and client-forged entries further left are ignored. We haven't confirmed Render's hop count from inside a live service. After deploying, check that `X-Forwarded-For` has the shape you expect and adjust.
- **Cold starts.** The first request after 15 idle minutes waits about a minute. Handled by the keep-warm workflow and the wake-up banner.
- **Shared AI quota.** The demo's Gemini and Groq keys are free tiers shared by everyone using the demo. When they run out, results fall back to keyword rules with the reason shown, and judges can paste their own key.
- **Supabase pause.** A week without traffic pauses the project; restore it from the Supabase dashboard (the data is kept).
