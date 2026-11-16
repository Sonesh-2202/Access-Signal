# One-time local setup for Windows PowerShell.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements-dev.txt

if (-not (Test-Path backend\data\manhattan_graph.json)) {
  backend\.venv\Scripts\python.exe scripts\osm_extract.py
}
Push-Location backend
.\.venv\Scripts\python.exe -m scripts.seed_demo --reset
Pop-Location

Push-Location frontend
npm install --no-fund --no-audit
Pop-Location

Write-Host ""
Write-Host "Setup complete. In two terminals:"
Write-Host "  cd backend;  .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
Write-Host "  cd frontend; npm run dev"
Write-Host "Open http://localhost:5173  (demo password: Signal-demo-2026)"
