# Hackathon strategy

## The pitch in one line

AccessSignal tells you which ramps, elevators and curb cuts in Manhattan are working today, and routes you around the ones that aren't.

## Five-minute demo script

Reset first: `python -m scripts.seed_demo --reset`.

1. **Home (30 s).** The hero card is the live NYU Langone ramp report: three independent reporters, confidence 64, every factor explained. Scroll to the route table: the walking route crosses the missing curb cut at Union Square, the wheelchair route doesn't.
2. **Map (45 s).** Toggle *List only* to show the accessible alternative. Turn on *Data gaps*: the Lower East Side is empty. Toggle 3D.
3. **Report (90 s).** Sign in as Priya. Pin a point, record a voice note or type a description, press *Suggest category*. With LM Studio running, the badge says *Local AI*; otherwise *Keyword rules*. Step 4 shows the duplicate check. Submit.
4. **Route (45 s).** Open the Union Square route. Switch profiles: Walking passes 1 reported issue; Wheelchair avoids it at +170 m and explains why.
5. **Staff (60 s).** Sign in as Dana. The pipeline shows the queue. Open the Herald Square elevator outage (in progress, assigned to MTA). Run *Access Monitor → Stale follow-up* as a dry run, then apply.
6. **Grand Central (30 s).** Place profile: ramp marked working, awaiting reverification, with the full timeline. The 3D schematic shows feature status.

## What judges should notice

- Real data: 24,527 OSM path segments, 918 OSM places.
- Explainable scores: confidence, duplicates, routes and hotspots all show their reasons. `/methodology` documents every formula.
- Local AI with a graceful fallback; nothing leaves the machine.
- Accessibility is tested, not claimed: axe passes on the main pages, overflow checked down to 320px. Manual screen reader testing is listed as not yet done.
- $0 running cost.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| LM Studio not running | Keyword classifier takes over and the UI labels it |
| No internet (tiles, geocoding) | Map shows blank tiles, but lists, routes and directions still work: routing is entirely local |
| Demo data edited by rehearsals | `seed_demo --reset` takes a few seconds |
