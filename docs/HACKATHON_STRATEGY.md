# Hackathon strategy

## The pitch in one line

AccessSignal tells you which ramps, elevators and curb cuts in Manhattan are working today, and routes you around the ones that aren't.

## Five-minute demo script

Reset first: `python -m scripts.seed_demo --reset`.

1. **Home (30 s).** The hero card is the live NYU Langone ramp report: three independent reporters, confidence 64, every factor explained. Scroll to the route table: the walking route crosses the missing curb cut at Union Square, the wheelchair route doesn't.
2. **Map (45 s).** Toggle *List only* to show the accessible alternative. Turn on *Data gaps*: the Lower East Side is empty. Toggle 3D.
3. **Report (90 s).** Sign in as Priya. Pin a point, record a voice note or type a description, press *Draft this report* or *Suggest category*. With a cloud key set, the badge says *Cloud AI (Gemini)*; otherwise *Keyword rules, AI offline*. Step 4 shows the duplicate check. Submit.
4. **Assistant (45 s).** Open the Union Square report and press *Ask about this report*. Ask "Is the ramp still blocked?" The answer cites the report, and the source link opens it. Then ask it to close the report: it says only a person can, and the panel says it can only read.
5. **Route (45 s).** Open the Union Square route. Switch profiles: Walking passes 1 reported issue; Wheelchair avoids it at +170 m and explains why.
6. **Staff (60 s).** Sign in as Dana. The pipeline shows the queue. Open the Herald Square elevator outage (in progress, assigned to MTA) and show the audit trail, with each change tied to a person.
7. **Grand Central (30 s).** Place profile: ramp marked working, awaiting reverification, with the full timeline. The 3D schematic shows feature status.

## What judges should notice

- Real data: 24,527 OSM path segments, 918 OSM places.
- Explainable scores: confidence, duplicates, routes and hotspots all show their reasons. `/methodology` documents every formula.
- Cloud models with a keyword fallback. Judges can paste their own key, and the form and the assistant say where text goes before it's sent.
- A read-only assistant that cites the records it used and can't change anything. Human decisions stay human.
- Accessibility is tested, not claimed: axe passes on the main pages, overflow checked down to 320px. Manual screen reader testing is listed as not yet done.
- $0 running cost.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Shared free AI quota runs out | Keyword rules take over and the UI labels it; judges paste their own key in Settings |
| No internet (tiles, geocoding) | Map shows blank tiles, but lists, routes and directions still work: routing is entirely local |
| Assistant gives a wrong answer | Every answer lists its sources; the panel says it can only read and that people make changes |
| Demo data edited by rehearsals | `seed_demo --reset` takes a few seconds |
