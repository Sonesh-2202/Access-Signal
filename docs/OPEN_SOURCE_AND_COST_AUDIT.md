# Open source and cost audit

Policy: no paid services, no API keys, no proprietary runtime dependencies.

## Runtime services

| Service | Used for | Cost | Key needed | Notes |
|---|---|---|---|---|
| LM Studio (local) | AI classification | $0 | No | Runs on your machine. Optional; keyword fallback built in |
| Gemma 4 12B QAT GGUF | Model | $0 | No | Gemma terms of use apply |
| OpenFreeMap | Vector tiles and fonts | $0 | No | Replaceable via `VITE_MAP_STYLE_URL` |
| tile.openstreetmap.org | Optional raster tiles | $0 | No | Subject to the OSMF tile usage policy; light use only |
| Nominatim (OSMF) | Address search | $0 | No | Client limits itself to 1 request/second and caches results, per policy |
| Overpass API | One-off data extract | $0 | No | Only `scripts/osm_extract.py`; output is committed |

## Backend dependencies

| Package | Licence |
|---|---|
| FastAPI, Starlette | MIT / BSD-3 |
| Pydantic, pydantic-settings | MIT |
| SQLAlchemy, Alembic | MIT |
| Uvicorn | BSD-3 |
| bcrypt | Apache-2.0 |
| PyJWT | MIT |
| httpx | BSD-3 |
| NetworkX | BSD-3 |
| python-multipart | Apache-2.0 |
| email-validator | Unlicense |
| psycopg (Postgres only) | LGPL-3.0 (dynamic use) |
| pytest, Hypothesis (dev) | MIT / MPL-2.0 |

## Frontend dependencies

| Package | Licence |
|---|---|
| React, React DOM, React Router | MIT |
| MapLibre GL JS | BSD-3 |
| three, @react-three/fiber | MIT |
| Zustand | MIT |
| Tailwind CSS, PostCSS, Autoprefixer | MIT |
| Vite, Vitest, TypeScript | MIT / Apache-2.0 |
| Testing Library, jsdom | MIT |
| axe-core | MPL-2.0 |
| Playwright | Apache-2.0 |
| ESLint, typescript-eslint, eslint-plugin-jsx-a11y | MIT |
| Fontsource: Newsreader, IBM Plex Sans/Mono | OFL-1.1 |

## Infrastructure

| Component | Licence |
|---|---|
| PostgreSQL | PostgreSQL Licence |
| PostGIS | GPL-2.0 (server-side, unmodified) |
| SQLite | Public domain |
| nginx | BSD-2 |

## Data

OpenStreetMap data in `backend/data/` is © OpenStreetMap contributors under ODbL 1.0. Attribution appears in the site footer and on every map.

Total recurring cost: $0.
