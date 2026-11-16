# API

FastAPI generates the OpenAPI spec. With the backend running:

- Swagger UI: http://localhost:8000/api/docs (or via the frontend proxy at `/api/docs`)
- ReDoc: `/api/redoc`
- Spec: `/api/openapi.json`

Authenticated endpoints take `Authorization: Bearer <access_token>`. Errors return `{"detail": "..."}` with a human-readable message.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account, returns token pair |
| POST | `/api/auth/login` | – | Token pair (rate limited) |
| POST | `/api/auth/refresh` | – | Rotate refresh token |
| POST | `/api/auth/logout` | – | Revoke refresh token |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/meta/taxonomy` | – | Categories, subcategories, features, service area |
| GET | `/api/meta/ai-status` | – | Cloud tiers and whether each has a key; which tier answers now; chat availability and limits |
| POST | `/api/evidence` | user | Upload photo/voice (multipart: `file`, `transcription?`, `alt_text?`) |
| GET | `/api/evidence/{id}/file` | – | Evidence file (attached evidence only) |
| POST | `/api/reports/classify` | user | AI category suggestion |
| POST | `/api/reports/duplicates` | – | Likely duplicates near a point |
| POST | `/api/reports` | user | Create report |
| GET | `/api/reports` | – | List: `bbox`, `category[]`, `status[]`, `q`, `sort`, `offset`, `limit` |
| GET | `/api/reports/geojson` | – | Map layer |
| GET | `/api/reports/nearby` | – | `lat`, `lng`, `radius` |
| GET | `/api/reports/{id}` | – | Detail with evidence, confidence breakdown, corroborations |
| POST | `/api/reports/{id}/verify` | user | `{still_present, note}` community check-in |
| DELETE | `/api/reports/{id}` | owner/staff | Soft delete |
| GET | `/api/places` | – | `q`, `type[]`, `verification[]`, `feature`, `bbox`, `with_issues` |
| GET | `/api/places/types` | – | Counts by type |
| GET | `/api/places/{id}` | – | Profile, features, reports, timeline |
| POST | `/api/routing/route` | – | Routes for a profile |
| GET | `/api/issues` | staff | Queue with filters and sort |
| GET | `/api/issues/{id}` | staff | Detail, history, allowed transitions |
| PATCH | `/api/issues/{id}` | staff | Status, assignee, priority, notes, resolution |
| GET | `/api/issues/export?format=csv\|json` | staff | Export |
| GET | `/api/issues/assignees`, `/api/issues/stats` | staff | Helpers |
| GET | `/api/analytics/overview\|trends\|categories\|resolution\|heat\|coverage\|hotspots` | – | Public analytics |
| POST | `/api/analytics/hotspots/recalculate` | staff | Re-cluster |
| POST | `/api/chat` | user | Read-only assistant. Body `{messages[], context{kind, id? \| origin?, destination?, profile?}, language?}`. Returns `{answer, sources[], source, model, truncated}`. Writes nothing. Accepts `X-AI-Provider` / `X-AI-Key` |

## Examples

Create a report:

```http
POST /api/reports
{
  "lat": 40.73478, "lng": -73.99071,
  "address": "Broadway & E 14th St, SW corner",
  "category": "sidewalk", "subcategory": "missing_curb_cut",
  "description": "New sidewalk work removed the curb cut.",
  "evidence_ids": ["7b0c…"],
  "ai_analysis": { "...": "classification returned by /classify" },
  "user_confirmed": true,
  "duplicate_of": null
}
```

Route:

```http
POST /api/routing/route
{ "origin": [40.7338, -73.9925], "destination": [40.7362, -73.9893], "profile": "wheelchair", "avoid_unknown": false, "alternatives": 2 }
```

Response (abridged):

```json
{
  "profile": "wheelchair",
  "routes": [{
    "label": "Recommended", "distance_m": 618.6, "duration_min": 10.3,
    "accessibility_score": 1.0, "unknown_share": 0.0, "barriers_avoided": 1, "barriers_on_route": 0,
    "explanation": ["Avoids 1 reported barrier on the shortest walking route: missing curb cut.", "170 m longer (+36%) than the shortest walking route."],
    "geometry": {"type": "LineString", "coordinates": [[-73.9925, 40.7338], "..."]},
    "segments": [{"name": "East 12th Street", "instruction": "Start on East 12th Street and continue 10 m", "surface": "asphalt", "...": "..."}]
  }],
  "warnings": []
}
```

Issue transition rules: `reported → under_review|confirmed`, `under_review → confirmed|reported`, `confirmed → assigned|under_review`, `assigned → in_progress|confirmed`, `in_progress → resolved|assigned`, `resolved → reverification`, `reverification → resolved|confirmed`. `assigned` needs an assignee; `resolved` needs resolution notes (10+ characters). Invalid moves return 409.
