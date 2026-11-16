# User guide

## Finding out what works

- **Map** (`/map`): every open barrier. Filled orange dots are critical, orange rings are high severity, solid dark dots medium, open rings low. Zoom in to see places. The **List only** toggle hides the map and lists every matching report, which is the fastest way through with a keyboard or screen reader.
- **Layers**: severity heat map, hotspots (clusters of 2+ reports), and data gaps (blocks nobody has reported on).
- **3D**: tilts the map and raises buildings. Purely visual.
- **Places** (`/places`): stations, hospitals, libraries and more. Each profile lists features (entrance, ramp, elevator, restroom…) with where the information came from: an OpenStreetMap tag, a community report, or a staff update.

## Planning a route

1. Go to **Plan a route**, enter a start and destination (or pick points on the map with the pin buttons).
2. Choose a profile: Wheelchair, Reduced effort, Low vision, or Walking.
3. Optionally tick **Avoid segments with missing data**.
4. Compare up to three options. Each says what it avoids, how much longer it is than the shortest walk, and how much of it has no surface or kerb data.
5. Directions list every segment with surface, kerb and any reported issue.

## Reporting a barrier

You need an account so reports can be followed up.

1. **Location**: search, use your location, or click the map and drag the pin.
2. **What you saw**: add up to 4 photos, a voice note (transcribed live in Chrome and Edge), and a description. Photo location data is removed before storage.
3. **Category**: press **Suggest category** to have the local AI read your evidence. You choose the final category.
4. **Check and send**: if someone already reported the same thing within 50 m, choose it. Your report is added as a confirmation and raises its confidence.

On any report page you can answer **Still there** or **It's cleared**. That's how fixes get verified.

## For infrastructure staff

- **Issue queue** (`/dashboard`): click a pipeline stage to filter. Sorted by priority, then confidence. Export CSV or JSON.
- **Issue page**: move the issue through its workflow, assign it, change priority, and add notes. Resolving needs a description of the fix and optionally a photo.
- **Access Monitor** (`/dashboard/monitor`): run triage agents as a dry run, or tick **Allow changes** to let them write notes and status changes. All agent changes appear in the audit trail as "Access Monitor".

## Developer setup

See the README. Key commands:

```powershell
python scripts\osm_extract.py                      # refresh OSM data (optional; data is included)
cd backend; .\.venv\Scripts\python.exe -m scripts.seed_demo --reset
.\.venv\Scripts\alembic.exe upgrade head          # for Postgres deployments
```
