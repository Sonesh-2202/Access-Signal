# Design audit

Checked against the "Anti AI Looking Web Prompt" directive. Screenshots were taken with Playwright at 1366px and 375px during development.

## Execution checklist

| Directive question | Answer |
|---|---|
| Could it be mistaken for an AI template? | The hero preview is the live, most-corroborated report with its real confidence breakdown, not an illustration. Section structures differ: sticky-label list, tabbed lifecycle on a sunk band, data table with mirrored 4/7 split, staggered figures, pull quote from a real report. |
| 5 or fewer core colours, no gradients or glows? | paper, ink, muted, signal, tint. Structural lines are ink at 10–18% alpha. The only gradient is the skeleton loading sweep (paper on hairline). No blur, no glass, no mesh. |
| Typography with personality, tracking and leading? | Newsreader (variable, optical sizing) for headings with negative tracking at display sizes; IBM Plex Sans for UI; IBM Plex Mono uppercase with +0.08em tracking for meta labels; `leading-relaxed` for reading blocks. All fonts self-hosted via Fontsource. |
| Layout variety, no 3-card rows or bento? | No card grids anywhere. Splits are 7/5, 4/7, 5/7 reversed, 8/4, 3/8. Feature lists are ruled rows. |
| Believable copy and real UI? | Copy names streets, agencies and numbers. Figures come from the API. No testimonials; the quote is a seeded report description with a link to it. |

## Blacklist review

| Item | Status |
|---|---|
| Glow orbs, mesh gradients, neon, purple-on-black | Absent |
| Heavy glass / large backdrop blur | Absent (an early 6px header blur was removed) |
| Dot grids, isometric grids, confetti | Absent |
| Repetitive bento, 3 identical feature cards, pricing tiers | Absent |
| Fake terminal mockups | Absent |
| Icons in pastel rounded squares, sparkles, emoji | Absent. All icons are custom 20×20 inline SVG paths at 1.5px stroke (`Icon.tsx`), including category pictograms |
| Green checkmark comparison lists | Absent |
| Generic AI copy, fake testimonials | Absent |

## System rules

- **Spacing**: Tailwind spacing is replaced by an 8px scale (`1` = 8px … `24` = 192px), plus a 4px half-step for hairline UI. Arbitrary values are used only for pixel-exact borders and typography offsets.
- **Elevation**: 1px low-alpha borders and tonal shifts (`paper-raised`, `paper-sunk`). One soft shadow, on map popups only, so they separate from the busy map.
- **Motion**: 150–300ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Fade-ups move 8px. No bounce. Reduced-motion respected.
- **Loading**: skeletons shaped like the content they replace (report rows, table rows, confidence panel). Busy buttons show three short bars, not a spinner.
- **Mobile**: navigation and map filters are bottom sheets; tables sit in horizontal scroll trays; touch targets ≥ 44px; no horizontal overflow at 320px.
- **3D**: selective. Map building extrusion on demand; a schematic entrance model on place profiles, lazy-loaded with a 2D SVG fallback and WebGL detection.

## Known compromises

- MapLibre's default navigation control icons are kept (restyled container only).
- The Positron basemap brings its own greys, which sit slightly cooler than the paper tone.
