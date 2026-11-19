# Design spec: the redesigned practice loop

Author role: principal product designer.
Reads: `01-design-rating.md` to `05-ux-spec.md`, `docs/spec/04-design.md`, `design/tokens.json`, `src/platform/web/audio/metronome.ts`, `src/calibration/arrivals.ts`, `src/dsp/hiband.ts`.
Status: binding for visual values. Behaviour and copy come from `05-ux-spec.md`. Where this document and `docs/spec/04-design.md` disagree on a visual value, this document wins.
Mockups: `docs/redesign/mockups/` (HTML) and `docs/redesign/mockups/png/` (renders). Section 11 lists them.

---

## 0. Where this spec departs from the UX spec

Each point is small. None changes what a control does, what a take counts as, or how anything is graded.

| # | UX spec | This spec | Why |
| --- | --- | --- | --- |
| D1 | 11.1 Classic: a 350 Hz body and a 1.2 kHz sine. Woodblock at 800 Hz. Beep a 1 kHz sine, 40 ms | No tonal energy below 1 kHz. Woodblock at 1,250 Hz. Beep at 2 kHz, 30 ms. Every sound carries the existing Tick burst as its first layer. All clicks stay pre-rendered buffers, never `OscillatorNode` | The metronome module bans oscillators and pitched clicks (05-ios-fork W10, lint rule). A sustained click below 1 kHz sits inside the sung and played range, and the pitch tracker can latch onto it ("zero click-induced extras" gate). The Tick layer keeps the calibration detector exactly as it is. Section 9 gives the recipes. |
| D2 | 5.4 Key grid: 4 columns on desktop | 3 columns while every group has 3 keys or fewer (difficulty 1 to 4), 4 columns from difficulty 5. "Any key" spans the full row | Major and minor rows line up key for key (G major above E minor). A 4th empty column looked like a missing key. |
| D3 | 7.2 Ruler bar axis not stated | The bar is drawn in sounding pitch on the shared C1 to C8 axis. The card's text range stays written | Comparison across cards only works in one pitch frame. A tenor's written A3 to A5 sounds A2 to A4; drawn written, it would sit above the alto. |
| D4 | 7.4 Tap a whole note to hear it | Each whole note is tappable, and a labelled pill under it ("▸ C3") is the visible button | A bare notehead does not look pressable. The pill is the 44 px target and carries the name. |
| D5 | 7.2 Large picture | Adds a keyboard strip under the staff (C2 to C5 for voices; per instrument otherwise), with the same full and served bands | Requested by the owner's brief. Many singers think in keys, not ledger lines. |
| D6 | 8.10 and 04 6.4 rule 5: past marks fade to 60%, then 40% | Past slips fade to 70% once their system is left, and only the slip marks fade: ink notes never fade | At 40% a vermilion mark fails 3:1 on paper. 70% passes (3.2:1 light, 3.7:1 dark). |
| D7 | 04 6.5 review: correct notes teal with a check | Correct notes stay ink in review and get no lane mark. Only slips are coloured | Agreed by both reviews ("calm ink, only slips coloured"). The states stay distinct (ink against vermilion, a glyph under every slip). Drawing only, allowed by UX section 15. |
| D8 | 8.9 count-in in the centre of the screen | The number sits on a raised card in the centre, over the score dimmed to about 20% | A 200 px numeral drawn straight over staff lines is hard to read. The card keeps the music visible behind it. |

Brand decision, not a deviation: the text face is Inter, self-hosted, not the system sans. 03 offered "serif display, system sans". On Linux and many Android phones `system-ui` falls back to fonts with poor tabular figures; Inter costs 48 KB and gives the same look everywhere.

---

## 1. Character

A good music room: warm paper, dark ink, quiet light, one brass detail that says "now". The music is the largest thing on every screen it appears on. The interface steps back while you read and play, and steps forward at three moments: the count-in, the end of the take, and the grade.

Four rules hold everywhere:

1. Ink for action. Primary buttons are ink-filled in light mode and paper-filled in dark mode. There is no blue button.
2. Brass for "now" only: the playhead, the count-in number and current beat, the current calibration mark, the sound that is playing and what it points at, the grade stars, rank progress. Brass never carries meaning alone; a shape or text always goes with it.
3. Selection is a pale wash, a 2 px ink edge and a check mark.
4. Vermilion for slips only. Violet for "what you played". Nothing else uses either colour.

---

## 2. Type

### 2.1 Faces

| Role | Face | File | Licence | Size on disk |
| --- | --- | --- | --- | --- |
| Display (titles, grade, count-in, score number) | Source Serif 4, variable weight 200 to 900, Latin subset | `source-serif-4-latin-wght-normal.woff2` | SIL OFL 1.1 | 51 KB |
| Text (everything else) | Inter, variable weight 100 to 900, Latin subset | `inter-latin-wght-normal.woff2` | SIL OFL 1.1 | 48 KB |
| Music (notation, key and time signatures in controls, clefs as voice icons) | Bravura | already bundled, `src/notation/font/bravura.woff2` | SIL OFL 1.1 | 247 KB |
| Music text (♭ ♮ ♯ ♩ ♪ inside sentences) | Subset of Bravura Text: U+2669, U+266A, U+266D to U+266F | new file, `music-text-subset.woff2` | SIL OFL 1.1 | about 3 KB |

- Files ship from `src/ui/fonts/`, are cached by the service worker, and are preloaded on first paint (`<link rel="preload" as="font" crossorigin>`). `font-display: block` with a 300 ms cap, then fallback. No third-party request.
- Licence texts go in `LICENSES/` (copies are in `docs/redesign/mockups/fonts/` now).
- Stacks:
  - `--font-display`: `"Source Serif 4", "Iowan Old Style", Charter, Georgia, serif`
  - `--font-text`: `"Inter", "Sightread Music Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  - `--font-music`: `"Bravura"`
- Inter settings: `font-feature-settings: "cv11", "ss01"` (single-storey a off, open digits). `font-variant-numeric: tabular-nums` on every number that updates.
- The music-text subset fixes what the mockups show in the ♩ of "♩ = 72": the system fallback ♩ is small and badly spaced. The subset is drawn from Bravura Text, which is designed for running text.

### 2.2 Scale

Sizes are px at desktop / phone (below 700 px). Line height is unitless. Minimum text size stays 12 px.

| Token | Face | Size | Line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | Display | 200 / 132 | 1.0 | 600 | 0 | Count-in number |
| `grade` | Display | 112 / 88 | 0.9 | 600 | −0.03em | Grade letter |
| `display` | Display | 44 / 34 | 1.08 | 600 | −0.015em | Score number, rank-up headline |
| `title` | Display | 34 / 30 | 1.15 | 600 | −0.01em | Screen titles |
| `h2` | Display | 24 / 22 | 1.25 | 600 | 0 | Card titles ("One thing to try", instrument name) |
| `h3` | Text | 17 / 17 | 1.35 | 600 | −0.005em | Sub-headings, list titles |
| `body` | Text | 16 / 16 | 1.5 | 400 (buttons 600) | 0 | Body, control text |
| `label` | Text | 14 / 14 | 1.4 | 600 | 0 | Row labels ("Difficulty", "Key") |
| `small` | Text | 14 / 14 | 1.45 | 400 | 0 | Hints, secondary lines |
| `caption` | Text | 13 / 13 | 1.35 | 500 | 0 | Tags, chip sublines, credits |
| `eyebrow` | Text | 12 / 12 | 1.3 | 600 | 0.09em, uppercase | The "Stars" label, "Selected". Never a heading. |

Headings are sentence case. Data lines never break inside a phrase: each "·"-separated part is `white-space: nowrap`.

---

## 3. Colour

### 3.1 UI tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | `#F4F1EA` | `#111113` | The room |
| `surface` | `#FFFDF9` | `#1B1B1E` | Cards, sheets, dialogs |
| `surface-2` | `#EEEAE1` | `#242427` | Segmented track, icon tiles, tonal buttons |
| `surface-2-hover` | `#E5E0D5` | `#2E2E32` | |
| `surface-2-pressed` | `#DBD5C8` | `#37373C` | |
| `border` | `#E3DDD1` | `#2E2E33` | Hairlines, card edges (decorative) |
| `border-strong` | `#8C8578` | `#76716A` | Control edges, switch off, empty checkbox (3:1) |
| `text` | `#1C1B19` | `#EEEAE2` | |
| `text-muted` | `#5F5A51` | `#A9A398` | |
| `accent` (primary fill) | `#1C1B19` | `#EEEAE2` | Primary button, switch on, slider fill, filled meter segments |
| `accent-hover` | `#34322E` | `#DAD5CB` | |
| `accent-pressed` | `#4A4741` | `#C6C0B5` | |
| `on-accent` | `#FFFDF9` | `#151517` | |
| `selected` | `#E9E4D8` | `#2C2A26` | Selected chip and card wash (with a 2 px `text` edge) |
| `brass` | `#94661A` | `#D8A548` | "Now": marks, rings, stars, current beat |
| `brass-ink` | `#7D5512` | `#E2B460` | Brass text: live sound caption, highlighted key signature |
| `brass-wash` | `rgba(176,124,30,0.14)` | `rgba(216,165,72,0.16)` | Playing sound, tip icon tile, first-time hint |
| `focus-ring` | `#2E56C9` | `#8FB0FF` | Focus only. 2 px, 2 px offset |
| `track` | `#E6E1D6` | `#2E2E33` | Empty bars, slider track, meter segments |
| `tick` | `#C9C2B4` | `#4A4A50` | Ruler ticks |
| `caution` | `#7F5A00` | `#E2B460` | Caution text with its icon |
| `danger` | `#B8360F` | `#FF7A52` | Destructive buttons, error banners |
| `on-danger` | `#FFFDF9` | `#151517` | |
| `toast-bg` / `toast-text` | `#1C1B19` / `#FFFDF9` | `#EEEAE2` / `#151517` | |
| `scrim` | `rgba(28,24,18,0.38)` | `rgba(0,0,0,0.60)` | |
| `range-full` | `#8C877D` | `#8E8981` | Full-range whole notes |
| `range-full-bar` | `#CFC8BA` | `#4F4C47` | Full-range band on ruler and keyboard |

`accent` keeps its name so components need no rename; only its value moves from blue to ink. Where code used `accent` to mean "now" (scan timer ring, current beat, calibration current mark), switch it to `brass`. Where it meant "link", use `text` with an underline.

### 3.2 Paper tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | `#FFFDF8` | `#24221F` | The page. Dark paper is a lifted warm grey, clearly a page against `#111113` |
| `ink` | `#1A1917` | `#EEE9DF` | Notation |
| `staff-line` | `#77736B` | `#8E8981` | |
| `error` (vermilion) | `#C23A12` | `#FF7A52` | Slips |
| `ghost` (violet) | `#6C3FC4` | `#BBA4FF` | What was played |
| `correct` | `#1F7A5C` | `#5CC9A7` | Live correct dot only |
| `ghost-replay` | `#6B6863` | `#A09B93` | Replayed passages |
| `playhead-bar` | `rgba(176,124,30,0.13)` | `rgba(216,165,72,0.15)` | Current bar wash, Listen bar, selected bar |
| `band` | `rgba(28,27,25,0.07)` | `rgba(238,233,223,0.08)` | Served band behind the range staff |
| `playhead-next` | removed | removed | The next-bar marker goes (one highlight only) |
| `ink-accent-soft` | removed | removed | |
| `metro-active` | `= brass` | `= brass` | |

High contrast (`[data-contrast="high"]`): `error` `#A32100` / `#FF9A78`, `ghost` `#5523B0` / `#CDBBFF`, `staff-line` `#4F4C46` / `#B3AEA6`, `brass` `#7D5512` / `#E9C27A`, `border-strong` `#5F5A51` / `#A9A398`.

Forced colours: unchanged from today (glyphs carry meaning).

### 3.3 Contrast, recomputed (WCAG relative luminance)

| Pair | Min | Light | Dark |
| --- | --- | --- | --- |
| text on surface | 4.5 | 16.94 | 14.32 |
| text on bg | 4.5 | 15.26 | 15.72 |
| text on surface-2 | 4.5 | 14.34 | 12.90 |
| text on selected | 4.5 | 13.57 | 11.94 |
| text-muted on surface | 4.5 | 6.74 | 6.86 |
| text-muted on bg | 4.5 | 6.07 | 7.53 |
| text-muted on surface-2 | 4.5 | 5.70 | 6.18 |
| text-muted on surface-2-pressed | 4.5 | 4.68 | 4.72 |
| text-muted on selected | 4.5 | 5.40 | 5.71 |
| on-accent on accent | 4.5 | 16.94 | 15.20 |
| on-accent on accent-hover | 4.5 | 12.59 | 12.47 |
| on-accent on accent-pressed | 4.5 | 9.11 | 10.08 |
| border-strong on surface | 3 | 3.60 | 3.55 |
| border-strong on bg | 3 | 3.24 | 3.90 |
| border-strong on surface-2 | 3 | 3.05 | 3.20 |
| focus-ring on surface | 3 | 6.28 | 8.04 |
| focus-ring on bg | 3 | 5.66 | 8.82 |
| brass on surface | 3 | 4.95 | 7.69 |
| brass on paper | 3 | 4.95 | 7.10 |
| brass on track (xp bar) | 3 | 3.86 | 6.04 |
| brass-ink on surface (text) | 4.5 | 6.50 | 8.94 |
| brass-ink on brass-wash | 4.5 | 5.73 | 7.59 |
| danger on surface | 4.5 | 5.79 | 6.67 |
| on-danger on danger | 4.5 | 5.79 | 7.08 |
| caution on surface | 4.5 | 6.14 | 8.94 |
| ink on paper | 4.5 | 17.28 | 13.11 |
| ink on playhead wash | 4.5 | 14.86 | 10.55 |
| staff-line on paper | 3 | 4.64 | 4.57 |
| error on paper | 3 (4.5 high contrast) | 5.29 | 6.16 |
| error on playhead wash | 3 | 4.55 | 4.96 |
| error at 70% on paper | 3 | 3.19 | 3.71 |
| ghost on paper | 3 | 6.57 | 7.45 |
| ghost at 70% on paper | 3 | 3.46 | 4.38 |
| correct on paper | 3 | 5.17 | 7.83 |
| ghost-replay on paper | 3 | 5.46 | 5.75 |
| range-full on paper | 3 | 3.52 | 4.57 |
| served band (accent) against full band (range-full-bar) | 3 | 10.35 | 7.12 |

The full band against the card (1.6:1) is decorative: the range is always also given in text. Disabled controls stay at 40% opacity (exempt).

---

## 4. Space, radius, elevation, motion

- **Space:** keep the 4 px scale (`space-1` 4 to `space-8` 64) and add `space-9` 96. Page padding 40 desktop, 16 phone. Card padding 28 desktop, 20 phone. Rows inside a setup card: 22 px above and below, a hairline between.
- **Radius:** `xs` 4 (ruler, small bars), `s` 8, `m` 12 (buttons, inputs, chips, segments), `l` 20 (cards, paper), `xl` 28 (sheets top corners, dialogs), `full` 999 (switches, pills, badges). Hero button 14. Count-in card 36.
- **Elevation** (new token group; today only one overlay shadow exists):

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `e0` | none | none | Flat |
| `e1` | `0 1px 2px rgba(40,32,20,.05), 0 1px 1px rgba(40,32,20,.03)` | `inset 0 1px 0 rgba(255,255,255,.03), 0 1px 2px rgba(0,0,0,.4)` | Cards |
| `e2` | `0 2px 6px rgba(40,32,20,.06), 0 10px 28px rgba(40,32,20,.07)` | `inset 0 1px 0 rgba(255,255,255,.04), 0 10px 28px rgba(0,0,0,.45)` | Paper, popovers |
| `e3` | `0 12px 32px rgba(40,32,20,.14), 0 40px 80px rgba(40,32,20,.12)` | `inset 0 1px 0 rgba(255,255,255,.05), 0 40px 80px rgba(0,0,0,.6)` | Sheets, dialogs, count-in card |

Dark paper also gets a 1 px `rgba(255,255,255,.04)` ring so its edge holds on a dark room.

- **Motion:** keep `dur` fast 100, base 200, slow 320; add `grade` 480 and `count` 160. Keep `ease-out` and `ease-in-out`; add `ease-settle` `cubic-bezier(0.2, 0.8, 0.2, 1)`.

| Moment | What moves | Duration and easing | Reduced motion |
| --- | --- | --- | --- |
| Screen change | Fade plus 8 px rise | base, ease-out | Fade 100 |
| Sheet, dialog | Slide up 24 px plus fade; scrim fade | slow, ease-settle | Instant |
| Served band and dark notes on difficulty change | Band width and note positions | base, ease-in-out | Jump |
| Count-in number | Scale 0.92 to 1, opacity 0 to 1 on each click; beat dot fills | count, ease-settle | Number swaps, no scale |
| Calibration current mark | Brass ring 0 to 12 px and fades, once per click | 320, ease-out | Mark fills, no ring |
| Playing sound | Brass equaliser bars in the caption, 3 bars at 0.9, 1.3, 1.1 Hz | loop | Static bars |
| Grade | Letter 96% to 100% plus fade; stars fill one by one 120 ms apart | grade, ease-settle | Static |
| During a take | Colour and opacity only (as 04 7.3) | | |

---

## 5. Exact changes to `design/tokens.json`

Bump `"version"` to 2. Replace the groups below; groups not listed are unchanged. The generator and `tokens.contrast.test.ts` need the new `elevation` group, the new paper keys and the removed ones.

```jsonc
"color": {
  "ui": {
    "bg": { "light": "#F4F1EA", "dark": "#111113" },
    "surface": { "light": "#FFFDF9", "dark": "#1B1B1E" },
    "surface-2": { "light": "#EEEAE1", "dark": "#242427" },
    "surface-2-hover": { "light": "#E5E0D5", "dark": "#2E2E32" },
    "surface-2-pressed": { "light": "#DBD5C8", "dark": "#37373C" },
    "border": { "light": "#E3DDD1", "dark": "#2E2E33" },
    "border-strong": { "light": "#8C8578", "dark": "#76716A" },
    "text": { "light": "#1C1B19", "dark": "#EEEAE2" },
    "text-muted": { "light": "#5F5A51", "dark": "#A9A398" },
    "accent": { "light": "#1C1B19", "dark": "#EEEAE2" },
    "accent-hover": { "light": "#34322E", "dark": "#DAD5CB" },
    "accent-pressed": { "light": "#4A4741", "dark": "#C6C0B5" },
    "on-accent": { "light": "#FFFDF9", "dark": "#151517" },
    "selected": { "light": "#E9E4D8", "dark": "#2C2A26" },
    "brass": { "light": "#94661A", "dark": "#D8A548" },
    "brass-ink": { "light": "#7D5512", "dark": "#E2B460" },
    "brass-wash": { "light": "rgba(176,124,30,0.14)", "dark": "rgba(216,165,72,0.16)" },
    "focus-ring": { "light": "#2E56C9", "dark": "#8FB0FF" },
    "track": { "light": "#E6E1D6", "dark": "#2E2E33" },
    "tick": { "light": "#C9C2B4", "dark": "#4A4A50" },
    "star": { "light": "#94661A", "dark": "#D8A548" },
    "caution": { "light": "#7F5A00", "dark": "#E2B460" },
    "danger": { "light": "#B8360F", "dark": "#FF7A52" },
    "danger-hover": { "light": "#A3300D", "dark": "#FF8E6B" },
    "danger-pressed": { "light": "#8F2A0B", "dark": "#FFA284" },
    "on-danger": { "light": "#FFFDF9", "dark": "#151517" },
    "toast-bg": { "light": "#1C1B19", "dark": "#EEEAE2" },
    "toast-text": { "light": "#FFFDF9", "dark": "#151517" },
    "scrim": { "light": "rgba(28,24,18,0.38)", "dark": "rgba(0,0,0,0.60)" },
    "range-full": { "light": "#8C877D", "dark": "#8E8981" },
    "range-full-bar": { "light": "#CFC8BA", "dark": "#4F4C47" }
    // "elevation-overlay" moves to the elevation group below
  },
  "paper": {
    "paper": { "light": "#FFFDF8", "dark": "#24221F" },
    "ink": { "light": "#1A1917", "dark": "#EEE9DF" },
    "staff-line": { "light": "#77736B", "dark": "#8E8981" },
    "correct": { "light": "#1F7A5C", "dark": "#5CC9A7" },
    "error": { "light": "#C23A12", "dark": "#FF7A52" },
    "ghost": { "light": "#6C3FC4", "dark": "#BBA4FF" },
    "ghost-replay": { "light": "#6B6863", "dark": "#A09B93" },
    "active": { "light": "#1A1917", "dark": "#EEE9DF" },
    "playhead-bar": { "light": "rgba(176,124,30,0.13)", "dark": "rgba(216,165,72,0.15)" },
    "band": { "light": "rgba(28,27,25,0.07)", "dark": "rgba(238,233,223,0.08)" },
    "metro-active": { "light": "#94661A", "dark": "#D8A548" }
    // removed: "playhead-next", "ink-accent-soft"
  },
  "highContrast": {
    "ui": {
      "brass": { "light": "#7D5512", "dark": "#E9C27A" },
      "border-strong": { "light": "#5F5A51", "dark": "#A9A398" }
    },
    "paper": {
      "error": { "light": "#A32100", "dark": "#FF9A78" },
      "correct": { "light": "#005A52", "dark": "#6FE0D0" },
      "ghost": { "light": "#5523B0", "dark": "#CDBBFF" },
      "staff-line": { "light": "#4F4C46", "dark": "#B3AEA6" }
    }
  }
},
"font": {
  "display": "\"Source Serif 4\", \"Iowan Old Style\", Charter, Georgia, serif",
  "ui": "\"Inter\", \"Sightread Music Text\", system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
  "music": "Bravura",
  "featureSettings": "\"cv11\", \"ss01\"",
  "files": ["source-serif-4-latin-wght-normal.woff2", "inter-latin-wght-normal.woff2", "music-text-subset.woff2"],
  "minSizePx": 12
},
"type": {
  "$comment": "size and phoneSize in px; face is display or ui.",
  "count":   { "face": "display", "size": 200, "phoneSize": 132, "line": 1.0,  "weight": 600 },
  "grade":   { "face": "display", "size": 112, "phoneSize": 88,  "line": 0.9,  "weight": 600, "tracking": "-0.03em" },
  "display": { "face": "display", "size": 44,  "phoneSize": 34,  "line": 1.08, "weight": 600, "tracking": "-0.015em" },
  "h1":      { "face": "display", "size": 34,  "phoneSize": 30,  "line": 1.15, "weight": 600, "tracking": "-0.01em" },
  "h2":      { "face": "display", "size": 24,  "phoneSize": 22,  "line": 1.25, "weight": 600 },
  "h3":      { "face": "ui", "size": 17, "line": 1.35, "weight": 600 },
  "body":    { "face": "ui", "size": 16, "line": 1.5,  "weight": 400, "buttonWeight": 600 },
  "label":   { "face": "ui", "size": 14, "line": 1.4,  "weight": 600 },
  "small":   { "face": "ui", "size": 14, "line": 1.45, "weight": 400 },
  "caption": { "face": "ui", "size": 13, "line": 1.35, "weight": 500 },
  "eyebrow": { "face": "ui", "size": 12, "line": 1.3,  "weight": 600, "tracking": "0.09em", "case": "upper" }
},
"space": { "1": 4, "2": 8, "3": 12, "4": 16, "5": 24, "6": 32, "7": 48, "8": 64, "9": 96 },
"radius": { "xs": 4, "s": 8, "m": 12, "l": 20, "xl": 28, "full": 999 },
"elevation": {
  "e1": { "light": "0 1px 2px rgba(40,32,20,0.05), 0 1px 1px rgba(40,32,20,0.03)", "dark": "inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.4)" },
  "e2": { "light": "0 2px 6px rgba(40,32,20,0.06), 0 10px 28px rgba(40,32,20,0.07)", "dark": "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 28px rgba(0,0,0,0.45)" },
  "e3": { "light": "0 12px 32px rgba(40,32,20,0.14), 0 40px 80px rgba(40,32,20,0.12)", "dark": "inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px rgba(0,0,0,0.6)" }
},
"motion": {
  "dur": { "instant": 0, "fast": 100, "base": 200, "slow": 320, "count": 160, "grade": 480 },
  "ease": { "out": "cubic-bezier(0.2, 0, 0, 1)", "in-out": "cubic-bezier(0.4, 0, 0.2, 1)", "settle": "cubic-bezier(0.2, 0.8, 0.2, 1)" }
},
"breakpoints": { "phoneMax": 699, "...": "others unchanged; setup goes inline at lg (1024)" }
```

`component` group changes (px; `{fine, coarse}` as today):

```jsonc
"button-compact-height": { "fine": 36, "coarse": 44 },
"button-default-height": { "fine": 44, "coarse": 44 },
"button-hero-height": { "fine": 56, "coarse": 56 },
"button-x-padding": 18, "button-hero-x-padding": 28, "button-radius": 12, "button-hero-radius": 14,
"segment-height": { "fine": 40, "coarse": 44 }, "segment-track-padding": 4, "segment-radius": 10, "segment-track-radius": 14,
"time-segment-height": 64, "time-segment-min-width": 76, "time-glyph-staff-space": 7.5,
"key-chip-min-height": 64, "key-chip-staff-space": 6.2, "key-chip-staff-width": 78, "key-grid-gap": 8,
"stepper-button-size": { "fine": 44, "coarse": 44 }, "stepper-value-min-width": 96,
"difficulty-meter-segment": [14, 18], "difficulty-meter-gap": 4,
"toggle-track-width": 40, "toggle-track-height": 24, "toggle-thumb-size": 18, "toggle-hit-size": 44,
"tempo-track-height": 4, "tempo-thumb-size": 20, "tempo-hit-size": 44,
"card-x-padding": 20, "card-x-padding-lg": 28,
"info-button-size": 36, "info-button-hit": 44,
"sound-button-min-height": 68, "sound-icon-tile": 44,
"dock-button-min-height": 72,
"instrument-card-icon": 40, "instrument-badge": 56, "ruler-height": 22, "ruler-axis": [24, 108],
"range-staff-space": { "desktop": 12.5, "phone": 10 }, "range-picture-width": { "desktop": 420, "phone": "100%" },
"keyboard-strip-height": 40,
"calibration-mark": 26, "calibration-mark-gap": 14,
"beat-dot-downbeat": 14, "beat-dot-other": 10, "beat-dot-outline": 1.5,
"count-card-padding": [28, 64], "count-card-radius": 36,
"star-size-results": 26,
"component-bar-height": 8,
"mode-chip-height": 36, "scan-timer-ring": 26, "scan-timer-stroke": 3
// removed: random-chip-height, random-chip-x-padding, instrument-circle, verdict-glyph-sizes (see score group)
```

`score` group changes:

```jsonc
"staff-space": { "takeDesktop": 16.5, "takePhone": 8.6, "readDesktop": 13.5, "readPhone": 8.5, "reviewDesktop": 12.5, "reviewPhone": 8 },
"page-margin": { "desktop": [40, 72], "phone": [22, 18] },
"lane-offset-staff-spaces": 2.2,
"lane-glyph-size-staff-spaces": { "live": 1.25, "review": 1.25, "highContrast": 1.5 },
"ghost-stroke": { "live": 1.5, "highContrast": 2.25 },
"ghost-fill": { "live": 0.40, "review": 0.55, "highContrast": 0.55 },
"past-mark-opacity": { "systemLeft": 0.7 },
"missed-ring": { "rx-noteheads": 0.95, "ry-staff-spaces": 0.95, "stroke": 1.5 },
"pitch-arrow": { "length-staff-spaces": 1.6, "gap-staff-spaces": 1.0 },
"playhead-pad-staff-spaces": [1.8, 0.15]
```

Contrast pairs to add to the test: `selected`, `brass`, `brass-ink` on `surface` and on `brass-wash`, `brass` on `track`, `error` and `ghost` at 0.7 opacity on `paper`, `error` on `playhead-bar`, `range-full` on `paper`, `accent` against `range-full-bar`. Values in 3.3.

---

## 6. Components

All heights are fine / coarse pointer. Focus is always a 2 px `focus-ring` outline with 2 px offset (shown on "Keep it ranked" in `scan-confirm`). Disabled is 40% opacity with `aria-disabled` and a visible reason next to it.

### 6.1 Buttons

| Kind | Height | Padding | Radius | Text | Default | Hover | Pressed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Primary | 44 | 0 18 | 12 | body 600, 15 px | `accent` fill, `on-accent` text, 1 px inner top highlight | `accent-hover` | `accent-pressed` |
| Primary hero | 56 | 0 28 | 14 | 17 px 600 | as primary; may show a `kbd` hint ("Space") at 60% | | |
| Secondary | 44 | 0 18 | 12 | 600 | `surface` fill, 1 px `border-strong` | `surface-2-hover` fill | `surface-2-pressed` |
| Tonal | 44 | 0 18 | 12 | 600 | `surface-2` fill, no edge | `surface-2-hover` | `surface-2-pressed` |
| Quiet | 44 | 0 10 | 12 | 600 | text only | `surface-2` fill | `surface-2-pressed` |
| Compact (any kind) | 36 / 44 | 0 14 | 10 | 14 px | | | |

Loading: label stays, a 16 px spinner replaces the leading icon, `aria-busy`. Icons sit 10 px from the label, 16 to 20 px.

### 6.2 Segmented control

Track `surface-2`, 4 px padding, radius 14. Segments 40 / 44 high, radius 10, `text-muted` 500. Selected: `surface` fill, 1 px `border-strong` ring, `text` 600, `e1`. A segment can carry a second line (`caption`, `text-muted`): "+8% XP", "few pieces". Time segments are 64 tall, at least 76 wide, with the meter drawn in Bravura at a 7.5 px staff space (stacked numerals about 30 px tall). Mode uses the full width.

### 6.3 Key chip (radio)

Min 64 tall, radius 12, padding 8 10 10, 1 px `border`, `surface`. Top: a mini staff, 78 wide at a 6.2 px staff space, in the instrument's first clef, with the signature. Under it the key name, `label`. Transposing instruments: a third line "concert F major" in `caption`. Selected: `selected` wash, 2 px `text` edge (1 px border plus 1 px inset), a 20 px ink check disc top right. "Any key" spans the grid row: name, hint "Up to 1 sharp or flat", and the "+8% XP" tag right-aligned. Group labels "Major", "Minor" in `caption` 600 above each row. Grid gap 8.

### 6.4 Difficulty stepper and meter

Stepper 44 tall: two 44 px buttons with equal 1.75 px minus and plus, a value cell at least 96 wide reading "2 of 10" ("of 10" in `text-muted` 500). Meter: ten 14 by 18 segments, radius 4, gap 4; filled `accent`; empty `track`; no music for this instrument: transparent with a 1.5 px dashed `border-strong` edge. The "Follow my progress" switch sits on the label row, right.

### 6.5 Switch

Track 40 by 24, thumb 18. Off: `border-strong` track, `surface` thumb. On: `accent` track, `on-accent` thumb moved right, and a small check mark drawn on the track so on and off differ by shape too. Hit area 44. The label sits right of the track.

### 6.6 Slider and number field

Track 4 px `track`, fill `accent`, thumb 20 px `surface` with a 2 px `accent` ring and `e1`. Number field 44 tall, 60 to 72 wide, 1 px `border-strong`, tabular 600. Tempo row: "♩ = 72" in `h3`, slider, field, then "Hear the tempo" as a tonal compact button with the metronome icon.

### 6.7 Cards, sheets, dialogs, popovers

- Card: `surface`, 1 px `border`, radius 20, `e1`, padding 28 / 20.
- Sheet (phone): `surface`, top radius 28, grabber 40 by 5 at 50%, `e3`, scrim. Header row: title left (`h2` or `h3`), primary compact "Done" right.
- Dialog (desktop): `surface`, radius 28, `e3`, max 920 wide for the instrument picker and 480 for confirms. Actions bottom right; the safe choice is primary and focused ("Keep it ranked").
- Popover: `surface`, 1 px `border-strong`, radius 16, `e2`, padding 16 18, max 340, 12 px arrow. A bold first line names the topic ("What is the reference?").
- Info button: 36 circle (44 hit), 1 px `border`, `info` icon 16 in `text-muted`. Open: `selected` wash, `text` edge, `aria-expanded="true"`.

### 6.8 Sounds group (read-through)

- Desktop: a card under "Start playing". Header "Sounds" with "Nothing plays during the take" right. Each sound is a full-width button, min 68 tall, radius 14: a 44 icon tile (`surface-2`), the label (`body` 600) and the caption (`caption` `text-muted`). Order: Listen first, Hear the tempo, Hear starting pitch or Hear the key (with its info button), then Check my tuning for winds, brass and strings.
- Playing: 1 px plus 1 px inset `brass` edge, the icon tile goes `brass-wash` with a `brass-ink` icon.
- Live caption: one line above the group, `label` in `brass-ink`, led by three animated brass bars ("Key chord: G major"). On the score: the key signature is drawn in `brass-ink` on a `brass` 16% rounded plate; for the first note, the notehead in `brass-ink` on a 1.5 staff-space brass 18% disc with its name above.
- Phone dock: fixed at the bottom on `surface` with a top hairline. Row of three dock buttons (min 72 tall, radius 14, icon over a 13 px label; "Listen first" adds "Makes this practice" at 10.5 px) and the 44 px "What do these do?" info button. "Start playing" hero below. Above the dock, the "Before you play: 1 of 5" peek tab (44 tall, `surface-2`, top radius 14).

### 6.9 Mode chip and timer

36 tall pill on `surface` with a 1 px `border`: a 26 px ring (3 px `track`, 3 px `brass` arc for the time left) and "Ranked · 0:24 to read" in `label`. Practice: no ring, "Practice". Never wraps.

### 6.10 Range picture

- Staff: instrument's first clef, staff space 12.5 desktop and 10 phone, width 420 (desktop column) or full width. Served band: `band` fill, radius 0.8 staff spaces, from 2.2 spaces above the top line to 2.2 below the bottom, spanning the two served notes. Whole notes at 8%, 36%, 64% and 92% of the space after the clef: full low and high in `range-full`, served low and high in `ink`. Ledger lines in the note's colour.
- Note pills under each note: 30 tall, radius full, 13 px 600 with a 12 px play triangle. Served pills are ink-filled; full pills are `surface` with a `border` edge and `text-muted`. Each is a button "Hear C3" (44 hit).
- Keyboard strip: 40 tall (34 compact), from C2 to C5 for voices (instrument range rounded out to C's otherwise). Above the keys, two bracket bars: full range 4 px `range-full-bar`, served range 5 px `accent`. White keys in the full range tinted `#F1ECE2` / `#34322E`; in the served range `#D9CDB2` / `#6A5D45`. Middle C marked with a 2 px ink dot. C labels below in `caption`.
- Legend: two swatch lines ("Full range: G2 to G4", "At difficulty 2: C3 to C4", values in 600), then the voice line or the transposition line in `text-muted`.

### 6.11 Instrument card and ruler bar

Card radius 16, padding 14 14 12, 1 px `border`. Left a 40 px icon tile; right the name (`body` 600, 15 px) and the written range (`caption`). Full width under it, the ruler: 22 tall, track 6 px `track` with `tick` marks at every C from C1 to C8, full range 6 px `range-full-bar`, served range 8 px `accent` (radius 4). Transposing instruments add "Sounds a major 2nd lower" in 12 px. Selected: as the key chip. Voices: 3 by 2 on every width; on phones the voice card stacks icon, name, range and bar. Picker groups flow in a 4-column grid on desktop (Woodwinds 3 plus Brass 1, then Strings 2 plus Keyboard 1). Above the grid one line explains the bars.

### 6.12 Beat dots and count-in

- Status strip dots: 10 px, downbeat 14 px, 1.5 px `text-muted` ring. Past: filled `text-muted`. Current: filled `brass`.
- Count-in card: centred on the paper, `surface`, 1 px `border`, radius 36, `e3`, padding 28 64. Number in `count`, `brass-ink`, lining figures. Dots under it at 14 and 20 px (current gets a 6 px `brass-wash` halo). "Bar 1 · ♩ = 72" in 18 px 600. The paper behind is washed with `paper` at 78%.

### 6.13 Take status strip

64 tall (56 phone), on `bg`. Left "Stop" (secondary compact, stop icon plus the word). Centre beat dots, "Bar 5 of 8" (`label`), "♩ = 72" (`small`, desktop only). Right "Mic" with a 7-bar input meter (3 px bars, `text` when lit, `border-strong` when not).

### 6.14 Calibration

One card, max 720 wide. Intro in body 16. Two selects side by side (stacked on phones). A `bg` inset panel (radius 18, padding 28) holds "Listening…", the instruction, the marks and "5 of 10 heard" (17 px, the count in 600). Marks: 26 px circles, gap 14. Pending: 2 px `border-strong` ring. Heard: filled `accent`. Missed: ring with a 2 px diagonal stroke. Current: filled `brass` with a pulse ring (section 4). Footer: "Hear the click" (tonal, metronome icon) left, "Skip" (quiet) right, and the skip hint under it in `caption`.

### 6.15 Results

- Header: grade letter (`grade`), then the score (`display`, tabular) with "of 100", three 26 px stars (`brass` filled, `border-strong` outline empty) and the grade line. Right: the badge (Ranked: ink pill; Practice: `surface-2` pill), "+12 XP" (`h3`), the rank line and a 220 px, 6 px `brass` progress bar. On phones it stacks; the badge, XP and rank sit on one wrapped line.
- Score card: toolbar (My take / Clean score segmented, Previous slip and Next slip secondary compact, Slower switch, Listen primary compact with the listen icon), then the paper with a 1 px `border` and no shadow.
- "One thing to try": 40 px `brass-wash` tile with the lightbulb icon, title in `h2`, tip in 17 px, evidence in `small` `text-muted`, "Hear bar n" tonal compact buttons, then "1 more tip" as a quiet disclosure. Expanded tips sit on a `bg` panel, radius 14. When "Show a tip after each take" is reachable here, it is the last row.
- Components: label, an 8 px bar (filled `accent`), the number. The weakest bar carries a diagonal hatch so it is marked by shape too; the sentence below names it.
- Actions: hero size. Next excerpt (primary, arrow), Try again (practice) (secondary), Change setup (quiet). Full width and stacked on phones.

### 6.16 Metronome sound option

Radio card, radius 16, padding 14 16: a 22 px radio, the name (`label`) and hint (`small`), a 120 by 36 picture of one bar of that sound (accent beat larger), and a tonal compact "Play a bar" (phones: 44 px play icon only, named "Play a bar of Classic"). Selected: as the key chip, radio filled.

---

## 7. Notation feedback palette

Live drawing (behaviour and timing unchanged, UX section 15). Staff space `sp` per section 5.

| State | Notehead and stem | Ghost (what was played) | Lane glyph (2.2 sp under the staff, 1.25 sp tall) |
| --- | --- | --- | --- |
| Pending | `ink` | none | none |
| Active | `ink` plus 1.5 px `ink` ring | none | none |
| Correct (live) | `ink`, unchanged | none | 0.2 sp dot in `correct` |
| Correct (review) | `ink` | none | none |
| Early / late | `error` | Black notehead at the played x, same pitch: 1.5 px `ghost` stroke, `ghost` fill 40% live, 55% review | Filled triangle pointing left (early) or right (late), `error` |
| Sharp / flat | `error` | Same staff step, offset right 1.1 notehead widths, with a vertical `ghost` arrow 1.6 sp long starting 1 sp above (sharp) or below (flat) the ghost | Filled triangle up or down, `error` |
| Wrong pitch | `error` | At the played pitch; offset right 0.85 widths when within one step; its accidental in `ghost`, placed left of the written note | ✕, 1.75 px strokes, `error` |
| Missed | `error` hollow head plus a 1.5 px `error` ring (0.95 sp tall) around it | none | Ring ○, `error` |
| Extra | unchanged | `ghost` head | + in `error` |
| Replay | unchanged | dashed `ghost-replay` outline, no fill | ↺ in `ghost-replay` |
| Re-judged (review) | final state plus a 2 px dashed `text-muted` ring | | |

- **Playhead:** one `playhead-bar` wash behind the current bar, from 1.8 sp above the staff to below the lane, inset 0.15 sp, radius 0.5 sp. No line, no next-bar marker.
- **Past:** once a system is left, slip notes, ghosts and lane glyphs drop to 70%. Ink never fades.
- **Review ghosts:** add a stem at 75% and use a hollow head for half and whole notes.
- **Margins:** take view 40 px top and 72 px sides inside the paper on desktop; 22 and 18 on phones. The paper is centred vertically in the viewport. The clef never touches an edge.
- **Read-through:** no lane; 2.4 sp below the staff before the next system.
- **Density brake, caps, slots and page turns:** unchanged from 04 6.4.
- The 1 m legibility check (UX 16 item 19) is run on the take mockup values: at 16.5 px staff space, a notehead is about 19 px wide and a lane glyph about 21 px.

---

## 8. Iconography

- One family, drawn for this product: 24 unit grid, 1.75 stroke (1.5 at 28 px and up), round caps and joins, `currentColor`. Shown at 16, 20 and 24 px. Paths are in `docs/redesign/mockups/_build/icons.mjs`.
- UI set: home, settings, chevron left, right and down, check, plus, minus, info, close, more, arrow right, play (filled), stop (filled square), listen (play with two sound arcs), metronome, tuning fork, starting pitch (a stacked three-note chord), note, mic, speaker, headphones, flame, progress, history, practice (two beamed notes), skip, retry, caution, lightbulb, slower.
- "Listen" always uses the listen icon. "Hear the tempo" and "Hear the click" always use the metronome. "Check my tuning" uses the tuning fork, so it is never confused with a sound that plays.
- Instruments: line icons for flute, clarinet, saxophone, trumpet, violin, cello and piano, on a 40 px `surface-2` tile (56 on the setup card). Voices use the clef they read from, set in Bravura: treble for soprano, mezzo and alto, the treble-8 clef for tenor, bass for baritone and bass. No letter abbreviations anywhere.
- Wordmark: "Sightread" in Source Serif 4 600 at 21 px, after a 24 px mark of five staff lines with one brass notehead on the third space.
- Rank emblems keep their geometry (04 7.4); achieved in `text`, current ringed in `brass`, future in `border-strong`.

---

## 9. Metronome sounds

### 9.1 Rules for every sound

1. **Pre-rendered.** Each sound is computed once per sample rate into an `AudioBuffer` (as `renderClick` does today) and scheduled with one `AudioBufferSourceNode` per click. No `OscillatorNode` (W10). The "oscillators" below are sums of damped sinusoids written into the buffer.
2. **Tick layer first.** Every sound starts with layer T, the existing Tick burst: 40 seeded random-phase partials spread uniformly over 5.5 to 9 kHz (seed `0x71c4`, partials above 0.475 × sample rate dropped), envelope `a(t) × exp(−5t / L)` with a 2 ms linear attack. This is the energy above 5 kHz in the first 5 ms that `HiBandEnergy` (5 kHz 4th-order high-pass, 1 ms blocks) and the arrival fit in `arrivals.ts` rely on. It starts at sample 0 in every sound.
3. **Body layers start at sample 0** with a 0.5 to 1 ms attack, so no body layer moves the onset edge.
4. **Nothing tonal below 1 kHz, and tonal parts are short.** Partials are inharmonic (no integer ratios) and decay with τ of 18 ms or less, except the Beep, which is a 30 ms gated tone at 2 kHz. Pitch trackers need about 20 ms of a steady periodic signal; these do not supply one in the sung or played range.
5. **Levels.** Layers are summed with the gains below, the sum is peak-normalised to 1, then scaled by click volume as today (`clickGain` 0.5, about −6 dBFS). Accented beats are scaled by `accentDb` (default +3 dB, still capped at 0.99) and use the accent recipe.
6. **Length.** Every sound is 60 ms or shorter; the last 3 ms are a raised-cosine fade to zero. The fastest tempo in `levels.json` is 176 bpm (341 ms a beat), so clicks never overlap, even with subdivision clicks.
7. **"Accent the first beat" off:** every beat uses the offbeat recipe at 0 dB.

Notation for the recipes: a partial `(f, A, τ)` is `A · sin(2π f t + φ) · e^(−t/τ) · a(t)`, φ = 0, `a(t)` a linear attack over the stated time. A noise band `(f1–f2, A, τ)` is the Tick method (40 seeded partials uniform in f1 to f2) with that envelope.

### 9.2 Classic (default): a mechanical metronome

A dry wooden knock with a short pitched "tock", and a brighter, bell-tinged knock on beat one.

| Layer | Offbeat | Accent (beat one) |
| --- | --- | --- |
| T, Tick burst | A 0.50, L 12 ms | A 0.55, L 14 ms |
| K, knock (noise band) | 1.8 to 3.2 kHz, A 1.00, attack 0.5 ms, τ 6 ms | 2.2 to 3.8 kHz, A 1.00, τ 6 ms |
| B1, body partial | 1,180 Hz, A 0.45, attack 0.5 ms, τ 8 ms | 1,575 Hz (a fourth up), A 0.50, τ 9 ms |
| B2, upper mode | 3,050 Hz (×2.58), A 0.20, τ 4 ms | 4,065 Hz, A 0.22, τ 4 ms |
| R, bell ring | none | 2,362 Hz (×1.5 of B1), A 0.22, attack 1 ms, τ 18 ms |
| Length | 45 ms | 60 ms |

### 9.3 Woodblock: rounder and softer

A hollow, rounded pock. Less click, more tone, still short.

| Layer | Offbeat | Accent |
| --- | --- | --- |
| T, Tick burst | A 0.35, L 10 ms | A 0.40, L 12 ms |
| M1, main mode | 1,250 Hz, A 1.00, half-cosine attack 1 ms, τ 14 ms | 1,670 Hz (×1.335, a fourth), A 1.00, τ 14 ms |
| M2 | 3,150 Hz (×2.52), A 0.32, τ 6 ms | 4,205 Hz, A 0.32, τ 6 ms |
| M3 | 5,800 Hz (×4.64), A 0.15, τ 2.5 ms | 7,740 Hz (dropped above 0.475 × rate), A 0.15, τ 2.5 ms |
| Length | 55 ms | 60 ms |

### 9.4 Beep: cuts through a loud room

| Layer | Offbeat | Accent |
| --- | --- | --- |
| T, Tick burst | A 0.30, L 8 ms | A 0.30, L 8 ms |
| S, tone | 2,000 Hz sine, A 0.80, 2 ms raised-cosine ramps, 30 ms total, flat between | 3,000 Hz (a fifth up), same shape |
| Length | 30 ms | 30 ms |

### 9.5 Ship gate (from UX 11.1, unchanged)

- Each sound passes the loopback calibration detector at the configured gates (at least 7 of 10 found, MAD at most 3 ms) in the synthetic e2e, and on one laptop and one phone.
- Each sound's low-band template is regenerated (`buildClickTemplate`); calibration builds a template for the selected sound as it does for Wood today.
- The synthetic suite runs each sound with bleed at −20 and −10 dB: onset F1 at least 0.97 and zero click-induced extras, as already required for Tick and Wood. A sound that fails ships in headphone modes only, or not at all; the others ship.
- Migration: stored `tick` reads as `classic`, `wood` as `woodblock`.

---

## 10. Screen notes (what the mockups settle)

- **Practice, desktop:** two columns, 5 to 7. Left card: instrument header, "Your range" picture, then Today (streak, takes and XP move to the page header line, right aligned). Right card: rows in the UX order, Start at the foot. The served range shows three times on purpose (staff band, keyboard bracket, the line under Difficulty): one picture, one physical reference, one exact text.
- **Practice, phone:** Today strip, title, summary card (instrument row with its 88 px ruler, then labelled chips: "Difficulty 2", "Key G major", and so on; each chip shows its row name above the value), the first-time hint in a `brass-wash` strip, Mode, rank card. Start and the XP line sit in a dock above the tab bar. At 390 by 844 Mode and Start are visible without scrolling (`home-phone-*.png`).
- **Setup sheet, phone:** the same rows as desktop, range picture on top, tempo shown with the switch off so the slider and "Hear the tempo" appear.
- **Instrument picker:** a 920 px dialog on desktop, a full-height sheet on phones, the large picture for the selection under the voice group on phones and under the grid on desktop.
- **Read-through:** score on paper, left; right column with Start playing, the live caption, Sounds, Before you play. The reference popover is open in the mockup to show its words. Phones: score, peek tab, dock. "What do these do?" opens a sheet with every caption, the reference entry highlighted in `brass-wash`.
- **Listen first, ranked:** confirm dialog (desktop) or sheet (phone), "Keep it ranked" primary and focused; the time left is stated in the dialog.
- **Take:** the music fills the page, centred, with the live palette. Status strip on top.
- **Results and tips:** the tips screen is gone (UX 3.1); `tips.html` shows "One thing to try" expanded with the second tip and the setting.
- **Calibration:** same flow and words, new skin. **Settings, Sound:** metronome cards with pictures and preview, accent switch, click volume, click during the take, then calibration, devices and tuning pitch.

---

## 11. Mockups

Static HTML and CSS, no network. Shared styles in `mockups/mockup.css`; fonts and their licences in `mockups/fonts/`. Theme is chosen by `?dark` in the URL (the app also follows `prefers-color-scheme`). The notation in the mockups comes from a small SVG engraver written for the mockups (`_build/engrave.mjs`); the app keeps VexFlow and applies the values in section 7.

| Mockup | Shows | PNGs (`png/`, deviceScaleFactor 2) |
| --- | --- | --- |
| `home.html` | Practice and setup, inline (desktop) and summary (phone) | `home-{desktop,phone}-{light,dark}.png` |
| `setup-sheet.html` | Phone setup sheet | `setup-sheet-phone-{light,dark}.png` |
| `picker.html` | Instrument picker with ruler bars and the large range picture | `picker-{desktop,phone}-{light,dark}.png` |
| `scan.html` | Read-through with the sounds group, the reference playing and its explanation | `scan-{desktop,phone}-{light,dark}.png` |
| `scan-explain.html` | Phone "What do these do?" sheet | `scan-explain-phone-{light,dark}.png` |
| `scan-confirm.html` | Ranked "Listen first?" confirm | `scan-confirm-{desktop,phone}-{light,dark}.png` |
| `count-in.html` | Count-in | `count-in-{desktop,phone}-{light,dark}.png` |
| `performance.html` | Take with live feedback: sharp, wrong note, late, missed, playhead in bar 5 | `performance-{desktop,phone}-{light,dark}.png` |
| `results.html` | Results with the marked score, Listen, one tip, components, actions | `results-{desktop,phone}-{light,dark}.png` |
| `tips.html` | "One thing to try" expanded inside results | `tips-{desktop,phone}-{light,dark}.png` |
| `calibration.html` | Calibration, mid-run | `calibration-{desktop,phone}-{light,dark}.png` |
| `settings.html` | Settings > Sound with the metronome options | `settings-{desktop,phone}-{light,dark}.png` |

Rebuild and re-render:

```
node docs/redesign/mockups/_build/build.mjs
node docs/redesign/mockups/_build/render.cjs        # optional name filter, e.g. "scan"
```

Known mockup limits, not design intent: the ♩ in text uses the system fallback (section 2.1 fixes it in the app), and on the phone take view the ghost natural in bar 2 sits close to its neighbour because the mockup engraver does not apply 04's collision rule.
