#!/usr/bin/env bash
# One-time local setup (macOS/Linux). Windows: scripts/setup_dev.ps1
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements-dev.txt

if [ ! -f backend/data/manhattan_graph.json ]; then
  backend/.venv/bin/python scripts/osm_extract.py
fi
(cd backend && .venv/bin/python -m scripts.seed_demo --reset)

(cd frontend && npm install --no-fund --no-audit)

cat <<'EOF'

Setup complete. In two terminals:
  cd backend && .venv/bin/uvicorn app.main:app --port 8000
  cd frontend && npm run dev
Open http://localhost:5173  (demo password: Signal-demo-2026)
EOF
