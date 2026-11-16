# Access Monitor agents

Access Monitor is the "Kiro Crew" part of the plan (tasks 31–32): five narrow agents that do the triage a coordinator would otherwise do by hand. They run inside the backend (`backend/app/services/agents/access_monitor.py`), are exposed to staff at `/dashboard/monitor`, and over the API at `POST /api/agents/{agent}/run`.

## Principles

- **Dry run by default.** Without `"apply": true` an agent only returns what it would do.
- **Visible actions.** Every applied action is an `IssueHistory` entry with no human actor and notes prefixed `Access Monitor:`, so it shows in the audit trail and can be reversed by a manager.
- **Small permissions.** Agents can add notes, move `reported → under_review`, and move `resolved → reverification`. They can't confirm, assign, resolve, merge or delete.
- **Typed output.** Each agent returns a Pydantic model (below), so results can be consumed by other tools.

## Agents

| Agent | Input | Tools | Output | Applied actions |
|---|---|---|---|---|
| `intake` | `report_id` | get_report, compute_confidence, find_duplicates, add_issue_note, set_issue_status | `IntakeResult`: completeness, missing evidence, suggested priority, duplicate candidates, confidence | Note; `reported → under_review` if confidence ≥ 0.5 |
| `evidence_analysis` | `report_id` | get_report, classify_evidence, add_issue_note | `EvidenceResult`: model category, agreement with reporter, summary, detected features | Note flagging disagreement |
| `duplicate_investigation` | – | find_duplicates, add_issue_note | `DuplicateResult`: clusters of open reports that match | Note on the primary report's issue |
| `hotspot_analysis` | – | recalculate_hotspots | `HotspotResult`: per-hotspot briefing with escalation advice by category and trend | None (hotspots table is recalculated) |
| `stale_followup` | `days` (default 14) | list_stale_issues, add_issue_note, set_issue_status | `StaleResult`: idle issues and unverified fixes | Note; `resolved → reverification` after 7 days |

## Tool definitions

`GET /api/agents` returns the tool registry as JSON Schema function definitions (`TOOLS` in the module), in the shape OpenAI-compatible tool-calling expects. They describe the backend functions each agent uses, so the same contracts can be given to an LLM-driven agent later.

## Example

```http
POST /api/agents/intake/run
{ "report_id": "…", "apply": false }
```

```json
{
  "agent": "intake",
  "report_id": "…",
  "completeness": 0.67,
  "missing": ["photo"],
  "suggested_priority": "critical",
  "duplicate_candidates": [{"report_id": "…", "score": 0.82, "distance_m": 9.4}],
  "confidence": 0.64,
  "actions": [
    {"issue_id": "…", "kind": "note", "detail": "intake complete (67% complete); missing photo; 1 possible duplicate(s), best match 0.82.", "applied": false},
    {"issue_id": "…", "kind": "status", "detail": "reported -> under_review (confidence 0.64)", "applied": false}
  ]
}
```

## Scheduling

The agents are invoked on demand. To run them periodically, call the endpoints from cron or a Kiro hook with a staff token, for example `stale_followup` nightly and `hotspot_analysis` hourly.
