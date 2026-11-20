# Note colour systems: research

Status: research only. No app code, config or design tokens were changed. The proposal for how the app shows colour comes next, in a separate file.

## What this covers

The owner asked for a colour for each note, and for a common palette that synesthesia publishers and music teachers already use. This note lists the systems in common use, what each one maps, how it treats sharps, flats and octaves, and what it means for the app.

## How much to trust this

Almost nothing here is verified against the page itself. In this session most hosts did not resolve (en.wikipedia.org, drakemusicscotland.org, www.nature.com and web.pdx.edu all failed), so the pages could not be loaded. What is below comes from search-result snippets, and it is marked as such.

- Colour values are approximate. Where a value came from memory and not from a source, it says so.
- No published hex value for any system was confirmed. The hex codes in the tables are best matches for proposal work, not a palette to copy.
- Anyone who needs an exact palette must check the official chart or the publisher's own material first.

To be clear: the app should not use an exact third-party palette without a licence check. The trademark notes below are a starting point, not legal advice.

## What the app already uses

From `docs/redesign/06-design-spec.md` (section 3 and section 7) and the README:

- Correct: teal-green `#1F7A5C` light, `#5CC9A7` dark.
- Error (slip, wrong or early/late): vermilion `#C23A12` light, `#FF7A52` dark.
- Ghost (what was played): violet `#6C3FC4` light, `#BBA4FF` dark.
- Brass is the "now" accent. Ink is the default note colour. Range-full notes are grey (`#8C877D` light, `#8E8981` dark).

Pitch colour must not be confused with these. Several common systems use red, green and purple for notes, which is the main conflict (see the fit section below).

## Systems

### 1. Boomwhackers and Chroma-Notes

- **Who uses it:** the most widespread system in primary and secondary music classrooms. Boomwhackers are sold with Chroma-Notes colour stickers, and xylophones and glockenspiels are often labelled to match.
- **Basis:** pitch class. The colour belongs to the note name, and the octave is shown by tube length, not colour.
- **Colours (as set out in the brief, with the source status):**

| Note | Colour as described in the brief | Approximate hex (best match, unverified) | Status |
|---|---|---|---|
| C | red | `#E03C31` | Brief; search snippets do not contradict |
| C♯/D♭ | (no single source) | `#E8602C` (red-orange blend) | Approximate |
| D | orange | `#F7941D` | Brief |
| D♯/E♭ | (no single source) | `#F5C518` (orange-yellow blend) | Approximate |
| E | yellow | `#FFE01B` | Brief |
| F | light green | `#8DC63F` | Brief |
| F♯/G♭ | (no single source) | `#4DA64A` (green blend) | Approximate |
| G | dark green or teal | `#1E7B3C` | Brief says dark green or teal. A search snippet recalled blue. This conflicts and needs checking. |
| G♯/A♭ | (no single source) | `#3A7FA0` (blue-green blend) | Approximate |
| A | purple | `#7B3F98` | Brief |
| A♯/B♭ | (no single source) | `#A04A8C` (purple-pink blend) | Approximate |
| B | pink | `#E06C9F` | Brief |

- **Sharps and flats:** the chromatic notes have their own colours, usually a blend of the neighbours. The exact chromatic shades are not confirmed here.
- **Basis for octave:** not shown by colour. The tube length gives the octave.
- **Trademark and licence:** "Boomwhackers" and "Chroma-Notes" are trademarks. A Finale manual snippet says they are licensed to, and owned by, Whacky Music, Inc. A later snippet names a different rights holder, so ownership may have changed. Do not use the names or the exact product palette in the app without checking this.
- **Recognition among learners today:** highest. It is the default colour system in many classrooms.
- **Verified:** no. Sources are snippets from the Finale manual (and its PDX mirror), and retailer listings.

### 2. Figurenotes

- **Who uses it:** Drake Music Scotland, with a colour-and-shape notation aimed mainly at beginners and young learners. Used in some UK and Finnish schools.
- **Basis:** pitch class for colour, and octave for shape. A snippet says the colour pattern repeats across four keyboard octaves and the shape changes by octave.
- **Colours:** not confirmed. One snippet says each note name has its own colour, with all Cs red and Ds brown. This is the only colour value found, and it is unverified.
- **Octave:** shown by shape. Middle C is a red circle per a snippet.
- **Duration:** shown by shape. A tail means the note sustains, and squashed shapes take half a beat each (snippet).
- **Trademark and licence:** not checked. The site is the publisher's, and the material is likely copyrighted.
- **Recognition among learners today:** moderate. Common in UK primary schools and in some special-needs settings.
- **Verified:** no.

### 3. Scriabin's key colours

- **Who uses it:** the composer's own system, from about 1910 (Prometheus). Cited by many synesthesia writers. Not a teaching system.
- **Basis:** key, not pitch class. Keys go round the circle of fifths, and the colour of a key is the colour of its tonic.
- **Colours:** partial, from snippets. Approximate values are marked.

| Note | Colour from snippets | Approximate hex (unverified) |
|---|---|---|
| C | red | `#D8232A` |
| C♯/D♭ | violet or purple | `#7C3A96` |
| D | yellow | `#F2D32B` |
| D♯/E♭ | flesh, glint of steel (snippet); red-purple in a Rachmaninoff anecdote | `#B45A6A` |
| E | sky blue or pale blue | `#8EC7F0` |
| F | deep red | `#A3142B` |
| F♯/G♭ | bright blue or violet (snippets differ) | `#2F6FD0` |
| G | orange | `#F28C1F` |
| G♯/A♭ | not found | not given |
| A | green | `#3DA845` |
| A♯/B♭ | not found | not given |
| B | blue | `#2B5BBA` |

- **Sharps and flats:** the enharmonic values differ by source. C♭/B is pearly blue in one snippet.
- **Octave:** not shown.
- **Trademark and licence:** none. Scriabin's work is public domain.
- **Recognition among learners today:** low for teaching, high for general cultural awareness.
- **Verified:** no. Wikipedia could not be loaded, so the snippet's table lacks a citation.

### 4. Newton's seven-colour scale

- **Who uses it:** historical. Newton (Opticks, 1704) paired the seven rainbow colours with the seven notes of the diatonic scale. He treated violet as a recurrence of red, as notes recur at the octave.
- **Basis:** the seven diatonic degrees, not the twelve pitch classes.
- **Colours (approximate, from memory, unverified):** C red, D orange, E yellow, F green, G blue, A indigo, B violet. Sharps and flats are not defined in the original.
- **Note:** later writers (Castel, Rimington and others) gave different pairings, and synesthetic evidence does not favour one scheme over another (snippet).
- **Trademark and licence:** none.
- **Recognition among learners today:** low. Mainly known in the history of colour music.
- **Verified:** no. The Scientist article was seen only as a search link.

### 5. Rimsky-Korsakov's key colours

- **Who uses it:** the composer's own system, reported by Rachmaninoff's memoir and in Peacock (1985), as quoted in a snippet.
- **Basis:** key.
- **Colours:** not found in full. Snippets say he perceived F♯ as an indefinite grey-green, that D major was golden-brown in one anecdote, and that he favoured blue for E-flat major.
- **Trademark and licence:** none.
- **Recognition among learners today:** very low. Mainly cited in writing about synesthesia.
- **Verified:** no.

### 6. Rainbow or ROYGBIV piano stickers

- **Who uses it:** not confirmed as a named convention. Piano-key stickers exist, and a retailer sells clef-coloured stickers.
- **Basis:** often pitch class, with the rainbow order running up the scale.
- **Colours:** no verified mapping. A common reading is a seven-colour rainbow over the white keys, with black keys shaded. Not verified.
- **Trademark and licence:** none known.
- **Recognition among learners today:** unknown, probably moderate for piano teachers.
- **Verified:** no convention was found.

### 7. Suzuki-style, handbell and glockenspiel colour sets

- **Who uses it:** handbell and tone-chime makers (a US supplier lists 8-note handbells with colour coding, in options called "Kidsplay" and "Chroma-Note"). Chroma-Notes stickers are also sold for xylophones and glockenspiels. No Suzuki-specific note-colour standard was found.
- **Basis:** pitch class, following the Chroma-Notes scheme in most cases.
- **Colours:** no separate verified mapping. Assume they follow Chroma-Notes unless a chart says otherwise.
- **Trademark and licence:** the Chroma-Notes question above applies.
- **Recognition among learners today:** moderate, as an extension of Chroma-Notes.
- **Verified:** no.

### 8. Colour-coded notation publishers (Color Me Mozart, Prodigies, Musical Colors)

- **Who uses it:** the names are real product names that were searched for. No product page or colour chart was found.
- **Colours:** not found. Do not assume any mapping.
- **Trademark and licence:** unknown.
- **Recognition among learners today:** unknown.
- **Verified:** no. These need a direct check of the publishers' sites.

### 9. Patents on colour notation

Several patents cover colour notation methods. They are relevant to licence risk, because a specific colour-to-note scheme could be claimed:

- US 7,148,414 (colored music notation system and method of colorizing).
- US 6,831,220 (multi-coloured notation and instruments).
- US 2019/0304328 A1 (colored music notation method and apparatus).
- US 6,127,616 (varying colours and shades of notation).

One patent describes a five-colour system (red, orange, yellow, green and blue) for the 88 piano keys, because the authors found the seven-colour rainbow hard to tell apart. Its details were not checked. These should be reviewed by someone who knows patent law before any scheme is copied.

## Research on synesthetes

- **No common mapping:** colour-note pairings vary widely between people. A 2017 Scientific Reports study (snippet) says pitch class-colour synesthesia is distinct from the pitch-height-to-brightness association, and it is the first detailed experimental study of pitch class-colour synesthesia. The authors note that the view that these associations are idiosyncratic had rarely been tested.
- **Weak shared tendency:** higher pitch tends to be seen as lighter or brighter, even by non-synesthetes. Marks (1974 or 1975; citations differ) is cited for this (snippet).
- **Consistency:** Ward, Huckstep and Tsakanikos (2006) found that synesthetes were consistent in their colour choices over time, but similar pitch associations also appeared in non-synesthetes. Consistency testing is a hallmark of synaesthesia, and it varies by type (snippet).
- **Learning effect:** a 1991 study by Rogers (cited in a snippet) found that elementary students who learned with colour-coded notation sight-read plain notation worse than students who did not. This matters for the app: colour must not replace the written note, and the app must still work for a reader who is not using colour.
- **Colour vision:** about 1 in 12 men has some colour vision deficiency. Red and green are the main pair at risk, and the Chroma-Notes palette puts red (C) against green (F and G).

## Ranking by recognition among learners today

1. **Boomwhackers / Chroma-Notes.** The default in many classrooms. Widely recognised. Approximate colours above.
2. **Figurenotes.** Colour plus shape, used in UK primary schools. Colour values not confirmed. Its shape-for-octave idea is useful even without its colours.
3. **Handbell and chime colour sets, and colour stickers for xylophone and glockenspiel.** Mostly follow Chroma-Notes, so not separate.
4. **Rainbow piano stickers.** Common in piano teaching, but no verified convention.
5. **Scriabin's key colours.** Widely cited in writing about synesthesia, rarely used for teaching.
6. **Newton's seven-colour scale.** Historical, and well known in the history of colour music.
7. **Rimsky-Korsakov's key colours.** Historical and anecdotal, with few details recorded.
8. **Colour-coded publishers (Color Me Mozart, Prodigies, Musical Colors).** Existence confirmed only by name. No colours found.

## Fit with the app

- **Red, green and purple clash with feedback.** The Chroma-Notes palette uses red for C, green for F and G, and purple for A. The app uses vermilion for slips, teal-green for correct and violet for what was played. A pitch colour in those hues would be confused with feedback.
- **Red and green are a colour-vision risk.** Red (C) next to green (F, G) is a common problem for the 1 in 12 men with deficiency.
- **Dark and light themes.** The Chroma-Notes palette is bright and saturated. It would need a separate dark-theme tone, and the note would need a shape or label, not colour alone.
- **Licence.** Exact Chroma-Notes colours and names should not be copied without checking ownership. Scriabin, Newton and Rimsky-Korsakov are public domain.

## Comparison table

| System | Basis | Octave shown by | Sharps and flats | Colours (approximate unless noted) | Who uses it | Licence or trademark | Rank |
|---|---|---|---|---|---|---|---|
| Boomwhackers / Chroma-Notes | Pitch class | Tube length | Blended shades | C red, D orange, E yellow, F light green, G dark green or teal (conflict: blue), A purple, B pink | Classrooms | Trademark (Whacky Music, Inc. per Finale manual; ownership may have changed) | 1 |
| Figurenotes | Pitch class (colour) and octave (shape) | Shape | Not confirmed | Partial: C red, D brown (one snippet) | UK and Finnish schools, beginners | Publisher material, copyright likely | 2 |
| Handbell / chime / stickers | Pitch class | Not shown | Not confirmed | Assumed Chroma-Notes | Music classes, handbell groups | Shares Chroma-Notes question | 3 |
| Rainbow piano stickers | Pitch class | Not shown | Not confirmed | No verified mapping | Piano teaching | None known | 4 |
| Scriabin | Key (circle of fifths) | Not shown | Enharmonics differ | C red, D yellow, G orange, A green, B blue, F deep red, E sky blue (partial) | Synesthesia writing, concerts | Public domain | 5 |
| Newton | Diatonic degree | Not shown | Not in original | C red, D orange, E yellow, F green, G blue, A indigo, B violet (memory) | History of colour music | Public domain | 6 |
| Rimsky-Korsakov | Key | Not shown | Not known | F♯ grey-green, D golden-brown, E♭ blue (anecdotes) | Synesthesia writing | Public domain | 7 |
| Color Me Mozart, Prodigies, Musical Colors | Unknown | Unknown | Unknown | Not found | Teachers (unverified) | Unknown | 8 |

## Sources

Status key: "snippet" means the search result showed the text, but the page itself was not loaded. "Unverified" means nothing was read from the source. No page was fully loaded in this session.

1. Finale manual, Boomwhackers and Chroma-Notes. https://usermanuals.finalemusic.com/FinaleWin/Content/Finale/Boomwhackers_Tuned_Percussion_Tubes.htm. Snippet. Unverified.
2. PDX mirror of the Finale page. https://web.pdx.edu/~jnewton/assignments/043ft_finale_tutorials/finale_tutorials/Finale/Boomwhackers_Tuned_Percussion_Tubes.htm. Snippet. Unverified. Host did not resolve when fetched.
3. Gear4music Boomwhackers classroom pack. https://gear4music.com/Drums-and-Percussion/Boomwhackers-Tuned-Percussion-Tubes-Chromatics-Set-5/MUK. Retailer listing, snippet. Unverified.
4. TTS Boomwhacker stickers. https://www.tts-group.co.uk/boomwhacker-stickers/1004487.html. Retailer listing, snippet. Unverified.
5. Thomann Chroma-Notes stick-ons. https://www.thomann.co.uk/boomwhackers_chroma_notes_stick_ons.htm. Retailer listing, snippet. Unverified.
6. Hope Education, Boomwhackers C to high C set. https://www.hope-education.co.uk/product/fe00061016. Retailer listing, snippet. Unverified.
7. Drake Music Scotland, Figurenotes. https://drakemusicscotland.org/learn/figurenotes/. Snippet. Unverified. Host did not resolve when fetched.
8. Wikipedia, Clavier à lumières (Scriabin key colours). https://en.wikipedia.org/wiki/Clavier_%C3%A0_lumi%C3%A8res. Snippet. Unverified. Host did not resolve when fetched. The snippet says its chromatic table is flagged as needing a citation.
9. Wikipedia, Colored music notation. https://en.wikipedia.org/wiki/Colored_music_notation. Snippet. Unverified. Host did not resolve when fetched.
10. Scientific Reports 2017, pitch class-colour synaesthesia. https://www.nature.com/articles/s41598-017-18150-y. Snippet. Unverified. Host did not resolve when fetched.
11. Rhythmic Light, hue to pitch. https://rhythmiclight.com/hue-to-pitch. Snippet. Unverified.
12. The Scientist, Newton's colour theory. https://www.the-scientist.com/newtons-color-theory-ca-1665-31931. Snippet. Unverified.
13. Ward, Huckstep and Tsakanikos (2006), sound-colour synaesthesia (cited in search results). https://web-archive.southampton.ac.uk/cogprints.org/6268/1/Cortex_sound-colour_Synaesthesia.pdf. Snippet. Title and authors match the cited study, but the content was not read. Unverified.
14. Marks (1974 or 1975), pitch and brightness (cited, not read). No URL. Unverified.
15. Rogers (1991), colour-coded notation and sight-reading (cited, not read). No URL. Unverified.
16. Patent US 7,148,414. https://patents.google.com/patent/US7148414. Snippet. Unverified. Review by a patent specialist before copying any scheme.
17. Patent US 6,831,220. https://patents.google.com/patent/US6831220. Snippet. Unverified.
18. Patent US 2019/0304328 A1. https://patents.google.com/patent/US20190304328A1/en. Snippet. Unverified.
19. Patent US 6,127,616. https://patents.google.com/patent/US6127616. Snippet. Unverified.
20. US hand-bell and chime supplier listing (Kidsplay and Chroma-Note options). Snippet. Unverified. Retailer name not recorded.

Hosts that did not resolve in this session and so could not be read: en.wikipedia.org, drakemusicscotland.org, www.nature.com, web.pdx.edu. The session's network settings would need to allow them for a full check.
