# Note colours: design

Role: principal product designer.
Input: the owner's request, `01-research.md`, `02-ux.md`, `docs/redesign/06-design-spec.md` §3 and §7, `docs/redesign/round2/04-design.md`.
Status: proposal only. Nothing in `src/`, `config/` or `design/` changes.
Mockups: `mockups/*.html`, PNG at deviceScaleFactor 2 in `mockups/png/`. Every screen is the owner's own state: baritone voice, difficulty 1, Melody in F major, not calibrated.

## My recommendation

**Option B: ink noteheads, with a band of coloured letter chips under the music in the read-through, gone before bar 1.** I agree with the UX note on the option, and I differ on four details:

1. **Colour by note name should be the default for everyone, voices included.** Scale degree stays as a setting. The owner asked for "a colour for each note", and the recognised classroom palette means C is red. In degree mode, F is red in F major and G is red in G major, so the colour the owner learns for a note changes with every piece (compare `b-scan-desktop-light.png` with `b-scan-degree-desktop-light.png`). That is a good tool for a singer who already thinks in solfège, but a poor first meaning for colour. Still the **owner's choice**.
2. **Twelve tokens, seven on the page.** The owner gets a twelve-colour palette, but the score only uses the seven letter colours (a sharp or flat keeps its letter's colour, and the chip says F♯ or B♭). The five in-between colours are pale on purpose: at full strength, the chromatic blends land on the feedback hues (C♯ on error, D♯ on brass, F♯ on correct, G♯ on ghost). They appear only where there is no spelling, which means a coloured keyboard.
3. **Option C must reserve the lane slot too.** If "Show note help" puts the band in a layout without a lane, the music jumps. With the slot always reserved, C's read-through has the take's layout, the same as B's.
4. **Chips are a pale fill, an edge one shade deeper and an ink letter**, not a saturated fill with a white letter. So every chip uses the same letter colour, the 4.5:1 text rule holds, and the band reads as a study aid rather than a children's colour score.

I would not build option A. The mockups show why: in `a-take-desktop-light.png` the correct red C sits next to the wrong B♭, now vermilion, and the violet heard note sits beside a purple A. Under simulated deuteranopia the F notehead and the error colour come within 2.9 ΔE2000. In option A those colours share a staff with the marks.

## 1. Palette

### How it was tuned

- Hues follow the classroom order from C: red, orange, yellow, green, blue, purple, pink, with G as blue (as in `02-ux.md`; a teal G would collide with `correct`). The hex values are our own. I did not copy them from any product, and the help text must not name one.
- Each colour was set in OKLCH, then checked with the tools in `docs/redesign/mockups/_build/colour-math.mjs`: WCAG relative-luminance contrast; CIEDE2000 (ΔE2000) in CIE Lab, D65; and the Machado, Oliveira and Fernandes (2009) simulations at severity 1.0, applied in linear RGB. (The round 1 spec used the same Machado simulations with CIE76.) `node docs/redesign/mockups/_build/notecolours.mjs` prints every table below from the token values, so the note, the sheet and the mockups cannot drift apart.
- Rules kept:
  - The ink letter on every fill is at least 4.5:1, in both themes.
  - Light theme: every edge is at least 3:1 against paper.
  - Dark theme: every fill is at least 3:1 against dark paper, so the fill is also the edge.
  - With normal vision, every letter fill is at least 18 ΔE2000 from error, correct and ghost in its own theme, and every in-between fill at least 16.
  - Lightness is spread so that the pairs red-green vision confuses (C, D, E and F) differ in greyscale where they can.

### Tokens

`pitch-{pc}` is the chip fill. `pitch-{pc}-edge` is the chip edge and any colour drawn straight on paper (pill swatches, the keyboard caps, option A's noteheads). In dark, the edge is the same as the fill. `pitch-on` is `#1A1917` in both themes: the letter on every chip.

| Token | Note | Name | Light fill | Light edge | Dark fill (and edge) | Light: fill on paper | Light: edge on paper | Light: ink letter on fill | Dark: fill on paper | Dark: ink letter on fill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pitch-c` | C | red | `#E05864` | `#C5193D` | `#D96272` | 3.59 | 5.77 | 4.81 | 4.49 | 4.97 |
| `pitch-cs` | C♯/D♭ | pale coral | `#FEC0AF` | `#A57163` | `#FBC2B2` | 1.54 | 4.02 | 11.19 | 10.17 | 11.26 |
| `pitch-d` | D | orange | `#E48233` | `#C96805` | `#FABC86` | 2.74 | 3.78 | 6.31 | 9.52 | 10.54 |
| `pitch-ds` | D♯/E♭ | pale amber | `#EECB95` | `#977B4F` | `#EBCC9D` | 1.52 | 3.93 | 11.39 | 10.32 | 11.42 |
| `pitch-e` | E | yellow | `#FFEF72` | `#9C8E11` | `#FBEB75` | 1.16 | 3.28 | 14.93 | 13.03 | 14.42 |
| `pitch-f` | F | green | `#97DB60` | `#528918` | `#96D35F` | 1.64 | 4.17 | 10.56 | 8.90 | 9.85 |
| `pitch-fs` | F♯/G♭ | pale aqua | `#A0E5ED` | `#488C94` | `#ACE7EE` | 1.38 | 3.79 | 12.49 | 11.65 | 12.90 |
| `pitch-g` | G | blue | `#7DC3F4` | `#0470A5` | `#71BAE9` | 1.88 | 5.34 | 9.19 | 7.48 | 8.28 |
| `pitch-gs` | G♯/A♭ | pale periwinkle | `#C3D8FF` | `#6981AB` | `#D7E5FF` | 1.42 | 3.88 | 12.20 | 12.50 | 13.84 |
| `pitch-a` | A | purple | `#B665B9` | `#9A389F` | `#B46CB2` | 3.72 | 6.00 | 4.64 | 4.33 | 4.79 |
| `pitch-as` | A♯/B♭ | pale orchid | `#F7BDDF` | `#9E708B` | `#F3BFDD` | 1.55 | 4.02 | 11.13 | 10.05 | 11.13 |
| `pitch-b` | B | pink | `#FEBCCF` | `#CC5A82` | `#FBC2D6` | 1.55 | 3.86 | 11.13 | 10.42 | 11.54 |

Light fills below 3:1 on paper rely on their edge, which is 3:1 or better in every case. That is the "1 px edge in a darker shade" from `02-ux.md` §5, drawn at 0.085 staff spaces (at least 1 px).

High contrast (`[data-contrast="high"]`): the same fills, a 1.5 px `ink` edge on every chip, and the letter at 600 weight. Forced colours: system text in a system-coloured outline, so the letter carries everything.

### Distance from the feedback colours

Measure: ΔE2000 between the pitch colour and `error`, `correct`, `ghost` and `brass` in the same theme, after the same simulation applied to both.

| Note | Light fill: error / correct / ghost / brass | Light edge: error / correct / ghost / brass | Dark fill: error / correct / ghost / brass |
| --- | --- | --- | --- |
| C | 19 / 61 / 37 / 33 | 15 / 63 / 35 / 34 | 18 / 63 / 32 / 38 |
| C♯/D♭ | 35 / 52 / 52 / 35 | 17 / 42 / 37 / 19 | 19 / 43 / 32 / 23 |
| D | 22 / 48 / 57 / 20 | 16 / 47 / 54 / 14 | 19 / 39 / 43 / 12 |
| D♯/E♭ | 40 / 43 / 64 / 31 | 25 / 29 / 51 / 10 | 26 / 30 / 44 / 13 |
| E | 54 / 46 / 83 / 39 | 40 / 31 / 71 / 18 | 42 / 31 / 62 / 19 |
| F | 65 / 35 / 69 / 42 | 55 / 19 / 80 / 30 | 56 / 19 / 53 / 29 |
| F♯/G♭ | 57 / 37 / 49 / 49 | 47 / 18 / 31 / 37 | 46 / 19 / 27 / 38 |
| G | 56 / 39 / 41 / 53 | 48 / 31 / 25 / 44 | 48 / 29 / 21 / 48 |
| G♯/A♭ | 52 / 44 / 43 / 50 | 42 / 31 / 21 / 41 | 39 / 29 / 17 / 39 |
| A | 38 / 43 / 20 / 49 | 39 / 44 / 12 / 52 | 35 / 46 / 19 / 52 |
| A♯/B♭ | 43 / 52 / 43 / 48 | 30 / 42 / 25 / 36 | 30 / 44 / 19 / 40 |
| B | 40 / 58 / 45 / 44 | 27 / 61 / 29 / 40 | 27 / 50 / 22 / 37 |

**Minimum kept, normal vision:** the seven letter fills are at least **18.4** ΔE2000 from error, correct and ghost (C against error, dark). The light edges get as close as **12.2** (A against ghost). Brass is closer (D at 12 to 14), which I accept: brass never paints a rectangle or a letter.

Under simulated colour vision the distances shrink, and I could not keep them apart by colour alone without losing the classroom order:

| Shade | Vision | Closest letter colour to error, correct or ghost |
| --- | --- | --- |
| Light fill | deuteranopia / protanopia / tritanopia | 13.9 (C, error) / **3.0 (C, correct)** / 11.7 (C, error) |
| Light edge | deuteranopia / protanopia / tritanopia | **2.9 (F, error)** / **4.4 (A, ghost)** / 2.6 (C, error) |
| Dark fill | deuteranopia / protanopia / tritanopia | **3.3 (G, ghost)** / 6.2 (G, ghost) / 4.9 (C, error) |

This table is the strongest argument for B. For about 1 in 12 men, an F notehead in option A is nearly the colour of a wrong note, and an A notehead nearly the colour of a heard note. In B a chip and a mark are never on screen together, and they never share a shape: a chip is a rounded rectangle with a letter, and no feedback mark is either.

## 2. Simulated colour vision: which letters come close

Pairs under 15 ΔE2000 among the seven letter fills (the full grid is on `palette-desktop-light.png`). In brackets: the difference in WCAG luminance, which is what survives in greyscale.

| Theme | Deuteranopia | Protanopia |
| --- | --- | --- |
| Light | E–F 9.6 (0.26), D–F 10.0 (0.25), C–D 12.6 (0.09), G–A 14.8 (0.27) | E–F 6.4 (0.26), G–B 13.5 (0.12) |
| Dark | D–F 4.8 (0.04), D–E 9.1 (0.23), E–F 10.5 (0.27), G–A 12.1 (0.21) | E–F 7.5 (0.27), D–F 8.2 (0.04), D–E 12.6 (0.23), G–B 13.2 (0.19) |

With normal vision no pair is under 15. Under tritanopia, the light C–D and dark D–B pairs are the close ones.

**Second cue, in order:**

1. **The letter**, on every chip, always. "Letters only" gives the whole benefit with no colour.
2. **Position.** The close pairs (D–F, E–F, C–D) sit on different lines and spaces, and the chip is under its own note.
3. **Lightness.** E is the lightest fill, and C and A the darkest (light: E 0.84 > B 0.62 > F 0.58 > G 0.50 > D 0.33 > C 0.24 > A 0.23). The known red-green risk, C against F, is 0.34 apart in luminance. D–F in dark is the one close pair with no lightness gap (0.04). It needs the letter, and the CVD session in `02-ux.md` §6 test 6 should check it first.

## 3. How the colour is shown (option B)

- **Chip:** 1.56 staff spaces tall, corner radius 30% of the height, fill `pitch-{pc}`, edge `pitch-{pc}-edge` at 0.085 sp. The letter is Inter 650 at 0.98 sp, never below 11.5 px, and the chip is never under 18 px tall. The accidental is the Bravura glyph, so B♭ reads like the key signature. At the read-through's desktop size (sp 15), a chip is 23 px tall with a 15 px letter.
- **Band:** one chip centred under each notehead, on one row per system, at the lane slot (2.25 sp under the bottom line, or 2.2 sp under the lowest note in that system when ledger lines reach lower). Rests get no chip. The read-through uses the take's layout, so the music does not move at Start (`b-fade-desktop-light.png`). With the lane reserved, the 1440 x 900 read-through still does not scroll.
- **Under the score:** "Read it through. Start when you are ready. The colours go during the count-in.", then the links "Colour key" and "Hide note help". The colour key opens below the score: seven chips, each named in words, and "Each letter has its own colour, in every key and octave. Sharps and flats keep their letter's colour. The colours go before you play." (`b-scan-key-desktop-light.png`).
- **Starting pitch:** the card reads "First note: F3" with its chip. The first note keeps its brass ring. The band stays, dimmed with the score.
- **Count-in:** the band fades from 100% to 0 over the first count-in bar (opacity only). Under reduced motion it is cut at the first click. From the last count-in bar there is no colour on screen.
- **Take:** nothing coloured. The lane slot holds only feedback: the green dot sits where the F chip was.
- **Results:** "Clean score" shows the band, with the line "Note help is on the clean score only." "My marks" is today's view.
- **Match a note:** a 46 px chip beside the 88 px "E3", and a swatch (fill with its edge) in each range pill. The needle, band and "You hit it" are unchanged. The notehead stays ink.
- **Picker:** a 12 px swatch inside each of the four note pills. The served and full pill styles are unchanged. No colour on the whole notes or on the keyboard strip, which already carries the served and full tones.
- **Dense rhythm ("Always" above difficulty 3):** where two chips would touch, the second becomes a dot 0.68 sp across in its colour, and the first note of every beat keeps its letter. Drawn on the palette sheet with eighths. It reads, but at sixteenths I would show letters on beats only and no dots.
- **Low notes:** a baritone's E2 and G2 push the band below the ledger line, like the lane glyphs (palette sheet).

## 4. The three options as drawn

| | A | B (recommended) | C |
| --- | --- | --- | --- |
| Read-through | Noteheads in `pitch-*-edge` (light) or `pitch-*` (dark), today's layout, "Colour key" link | Band of chips, take's layout | Ink, take's layout, "Show note help" button with seven colour dots. Pressed: B's band, "Hide note help" |
| Mid-try | Colour stays. Wrong notes turn `error`, and marks draw over colour | No colour | No colour |
| Results | Marked score in colour. The reason line reads "Note colours were on, so this one is practice." | Band on the clean score | Ink, with the button on the clean score |
| Match a note | Coloured notehead plus chip and swatches | Chip and swatches | As B |
| Picker | Swatches, plus a colour cap at the foot of every key (the five pale colours on the black keys) | Swatches | As B |

The mid-try boards show a wrong note, a correct note and a heard note together (B♭3 sung as A3: a red head, a ✕ and a violet ghost). They use the Display setting "Show played notes live: Always", because at difficulty 1 the heard note otherwise waits for the results.

## 5. Mockups

Build: `node docs/redesign/mockups/_build/notecolours-build.mjs`, then `node docs/redesign/mockups/_build/notecolours-render.cjs`. New files in `_build/`: `colour-math.mjs`, `notecolours.mjs` (palette and tables), `notecolours-build.mjs` and `notecolours-render.cjs`. `engrave.mjs` gained two optional hooks (`headFill` and `overlay`) and now also returns the note positions. These are additions only: the round 2 pages rebuild byte for byte.

| Page | Sizes and themes | What it settles |
| --- | --- | --- |
| `palette` | desktop, light (the dark panels are drawn in) | All 12 tokens with names, letters, hex values and contrast; Machado simulations for both papers; chip, dense rhythm, low notes, Settings › Display |
| `compare` | desktop, light and dark | A, B and C on bars 5 and 6: read-through, mid-try, results |
| `a-`, `b-`, `c-scan` | desktop and phone, light and dark | Read-through |
| `c-scan-on` | desktop and phone, light and dark | C with note help shown |
| `b-scan-key`, `b-scan-degree` | desktop, light | Colour key open; degree mode |
| `b-fade` | desktop, light | Read-through, starting pitch, count-in fade, no colour, bar 1 |
| `a-`, `b-`, `c-take` | desktop and phone, light and dark | Mid-try with correct, wrong and heard marks |
| `a-`, `b-`, `c-results` | desktop and phone, light | Results |
| `a-`, `b-`, `c-match` | desktop and phone, light | Match a note |
| `a-`, `b-`, `c-picker` | desktop and phone, light | Range picture, pills, keyboard strip |

52 PNGs. I looked at every one and fixed what I found: the phone help row was wrapping under the dock, compare-sheet chips were touching, the swatches were drawn in the edge shade only, the read-through frame said "Stop", and the note count was wrong. Known limit, the same as in round 2: on the phone results the sticky bar shows mid-page in a full-page capture.

## 6. Open items

- **Owner's choice:** option (I recommend B), the colour-by default (I recommend note name for everyone), and the cut-off difficulty (3, as in `02-ux.md`).
- **Before release:** someone qualified should check the plain rainbow-from-C order against the trademark and patent notes in `01-research.md`. No product name goes in the app or the help.
- **For the contrast test:** add every pair in the token table (ink letter on fill; light edge on paper; dark fill on paper) to `tokens.contrast.test.ts` when the tokens land.
- **For the CVD session:** test D–F in dark first.
