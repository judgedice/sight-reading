# Note colours: proposal for the owner

Role: principal UX. Input: `01-research.md`, `02-ux.md`, `03-design.md` and all 52 PNGs in `mockups/png/`.
Status: proposal only. Nothing in `src/`, `config/` or `design/` has changed.

## What we propose

Each of the seven letter names gets its own colour, in the classroom order from C: red, orange, yellow, green, blue, purple, pink. The colour sits on a small chip with the letter in it, in a band under the music, and the noteheads stay black. You see the band while you read the piece through, it fades during the first count-in bar, and it is gone before bar 1, so nothing coloured is ever on screen while you are being marked. After the try it comes back on the clean score only, never on "My marks". Every chip carries its letter, so the help still works for anyone who cannot tell the colours apart, and a "Letters only" setting removes the colour altogether.

## The palette

Our own values, tuned for our paper. They are not copied from any product.

| Note | Colour | Light chip fill | Light chip edge | Dark chip fill |
| --- | --- | --- | --- | --- |
| C | red | `#E05864` | `#C5193D` | `#D96272` |
| D | orange | `#E48233` | `#C96805` | `#FABC86` |
| E | yellow | `#FFEF72` | `#9C8E11` | `#FBEB75` |
| F | green | `#97DB60` | `#528918` | `#96D35F` |
| G | blue | `#7DC3F4` | `#0470A5` | `#71BAE9` |
| A | purple | `#B665B9` | `#9A389F` | `#B46CB2` |
| B | pink | `#FEBCCF` | `#CC5A82` | `#FBC2D6` |

- The letter is always near-black (`#1A1917`), at 4.6:1 or better on every fill in both themes.
- In the light theme every chip edge is at least 3:1 against the paper. In the dark theme every fill is at least 3:1.
- Sharps and flats keep their letter's colour, and the chip says F♯ or B♭.
- With normal vision, every fill is at least 18 ΔE2000 from the green, red and purple feedback colours.
- The designer also drew five pale in-between colours for a coloured keyboard. Option B does not use them.

## Three options

- **A, coloured noteheads.** Gain: the most familiar look from classrooms. Lose: a red C sits next to a red wrong note, a purple A sits next to the purple heard note, and every try would have to count as practice.
- **B, black noteheads with a band of letter chips (recommended).** Gain: you get the colours while you study the music, the feedback stays as it is, and ranked tries are unchanged. Lose: one more row in the read-through, and chips get crowded in fast rhythms.
- **C, colour only when you ask for it.** Gain: the screen stays as it is today. Lose: few people will find the button, so it helps the least.

## Recommendation

**Build B.** Above difficulty 3, keep C's "Show note help" link so you can still turn the band on for one try. The designer and I agree on B. We disagreed on one point, and I have changed my view:

- **Colour by note name or by scale degree.** I first proposed scale degree as the default for voices: the key note is always red, and the chip says do, re, mi. That fits how singers learn to pitch. The designer said a colour should mean one thing first: in degree mode, F is red in F major and G is red in G major. Compare `b-scan-desktop-light.png` with `b-scan-degree-desktop-light.png` to see this. You asked for "a colour for each note", so **note name is the default for everyone**, and scale degree is one setting away. Which one helps you more is for you to find out (question 2).

I checked every mockup for colour clashing with feedback, for dark-theme legibility and for pairs that cannot be told apart. I found no fault that needed a fix. The clashes in option A's mockups are the point of those mockups, not drawing errors. Phone captures of the results screen show the sticky bar halfway down the page. That comes from the full-page capture, not from the design.

## What is not verified

- **The research.** No source page could be loaded. en.wikipedia.org, drakemusicscotland.org, www.nature.com and web.pdx.edu did not resolve, so everything we know about existing palettes comes from search-result snippets. No published hex value was confirmed. Sources disagree on G (dark green or teal in one, blue in another), and we chose blue. The study suggesting colour notation can weaken plain reading (Rogers 1991) was cited, not read.
- **The legal side.** The product names are trademarks, and there are patents on colour notation. The plain rainbow order from C needs a check by someone qualified before any public release. No product name appears in the app.
- **Colour vision.** The colour-vision figures come from simulations, not from real people. Under red-green deficiency, D and F in the dark theme are nearly the same colour and the same lightness, so only the letter tells them apart.
- **Real learners.** Nothing has been tested with anyone yet: not whether it helps, not whether the fade feels like losing something, and not whether the chips can be read at a metre. `02-ux.md` §6 sets out seven short tests. Start with you, then about five learners, including at least one man with a colour vision deficiency.

## Questions for you before we build

1. Option B, as recommended, or A or C?
2. Colour by note name (C is always red), or by scale degree (the key note is always red, with do, re, mi)? Try both for a few days if you are unsure.
3. Should the help switch off by default after difficulty 3, or after difficulty 2?
4. Will the app be released beyond you? If so, the trademark and patent check has to happen before release.

## Rough build size

About a week for one developer, with tests. Scale degree mode adds about a day.

- Seven colours in three themes, added to the contrast tests.
- The chip band in the lane slot, with the fade during the count-in.
- The Settings › Display rows, the colour key and the "Show/Hide note help" link.
- The clean-score band on results.
- The chip and swatches in Match a note, and the swatches in the picker.
- One line per system in the screen reader description.
- Copy, and new screenshot checks.

## Mockups to look at

- Comparison: `mockups/png/compare-desktop-light.png`, `mockups/png/compare-desktop-dark.png`
- Palette: `mockups/png/palette-desktop-light.png`
- Option B read-through: `mockups/png/b-scan-desktop-light.png`, `mockups/png/b-scan-desktop-dark.png`
- Option B mid-try: `mockups/png/b-take-desktop-light.png`, `mockups/png/b-take-desktop-dark.png`
- The fade from read-through to bar 1: `mockups/png/b-fade-desktop-light.png`
