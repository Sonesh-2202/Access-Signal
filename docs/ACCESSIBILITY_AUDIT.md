# Accessibility audit

Target: WCAG 2.2 level AA. This file records what has been checked, how, and what is still open. "Not yet done" means exactly that.

## Automated checks (done, passing)

| Check | Tool | Scope | Result |
|---|---|---|---|
| WCAG 2.0/2.1/2.2 A and AA rules | axe-core 4.10 in Playwright, real Chromium | `/`, `/terms`, `/privacy`, `/accessibility`, `/methodology`, `/places`, `/analytics`, `/login` at 1366px and Pixel 7 | 0 violations |
| Component rules | axe-core in Vitest/jsdom (contrast disabled: no layout engine) | Form controls, confidence breakdown, legal pages, login | 0 violations |
| Static JSX rules | eslint-plugin-jsx-a11y (recommended) | All of `src/` | 0 errors (rule exceptions listed below) |
| Horizontal overflow | Playwright, `scrollWidth - innerWidth` | All main pages at 320, 375 and 1366px | 0 px |
| Skip link and focus | Playwright keyboard | `/reports` | Tab lands on "Skip to content"; Enter moves to `#main` |

Run them: `npm test` and `npm run test:e2e` in `frontend/`.

## Colour contrast (computed from tokens)

WCAG relative luminance, computed with a script against the five palette colours:

| Foreground | Background | Ratio | Use |
|---|---|---|---|
| ink `#1C1B19` | paper `#F4F1EA` | 15.26:1 | body text (AAA) |
| muted `#5F5A51` | paper | 6.07:1 | secondary text |
| muted | tint `#E7DCC3` | 5.03:1 | text on tags |
| signal `#A8360F` | paper | 5.82:1 | accent text, focus ring |
| paper | signal | 5.82:1 | primary button text |
| signal-deep `#862B0C` | signal-wash | ≥ 6.5:1 | critical labels |

## Design measures

- Severity, feature status and verification are shown with shape and text, never colour alone (filled/outlined squares, diamond for "not working").
- The map is never the only channel: list-only map mode, written directions with segment details, data tables under every chart, place feature lists beside the 3D model.
- 44×44 px minimum touch targets (`min-h-touch`, `min-w-touch`).
- Focus ring: 2px signal outline, 2px offset, `:focus-visible` only.
- Route changes move focus to `<main>`; dynamic results are announced through a polite live region.
- Dialogs use native `<dialog>` (focus trap, Escape, inert background, focus return).
- `prefers-reduced-motion` turns off transitions, skeleton sweeps and the 3D auto-rotation.
- Voice notes are audio-only and always stored and shown with a text transcript (WCAG 1.2.1). This is why `jsx-a11y/media-has-caption` is disabled.

## ESLint rule exceptions

- `click-events-have-key-events`, `no-noninteractive-element-interactions`: table rows are clickable for mouse users, but each row contains a real link, which is the keyboard path.
- `no-static-element-interactions`: the 3D canvas drag handler; the canvas is `aria-hidden` and decorative.

## Manual testing (not yet done)

| Test | Status |
|---|---|
| NVDA + Firefox and Chrome, full report flow | Not yet done |
| JAWS + Chrome, dashboard workflow | Not yet done |
| VoiceOver iOS, map list view and route planner | Not yet done |
| 200% and 400% browser zoom | Not yet done |
| Windows High Contrast / forced colours | Not yet done |
| Keyboard-only walkthrough of every page | Partial (skip link, forms and dialogs exercised by automated tests) |

## Known issues

- Map markers are not individually focusable. Keyboard and screen reader users should use the list view; the map canvas itself pans with arrow keys.
- The point picker in the report flow is mouse/touch only. Keyboard users set the location by address search or "Use my location".
- Live voice transcription depends on the Web Speech API (Chrome, Edge, Safari). Firefox users can record but must type the transcript.
