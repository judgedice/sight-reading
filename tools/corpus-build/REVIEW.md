# Agent review of the corpus (job C8r)

Spec: `docs/spec/03-score-corpus.md` section 6.12; PLAN rulings 29 and 48. This file is the reviewer's brief and the
operator's procedure. Prompt version: **rubric-v1**. Variants: **rubric-v1-a** (answer file `-A`) and **rubric-v1-b**
(answer file `-B`).

## What is reviewed

Ruling 48: the agent review runs on levels 1 to 3 only. Every window at L1 to L3 that survived the rules (R0) and the
statistical outliers (R1) is queued. Nothing at L1 to L3 ships without two accepting verdicts. Other items that need the
veto (x2 variants, quartet inner and cello parts, one outlier flag or interest near its threshold, above L3) stay
excluded in v1.

The queue is split into packets of about 40 items, `tools/corpus-build/build/review/packet-NN.json`
(`schemas/review-packet.schema.json`). Each packet holds about 36 real windows and blind controls: 4 negatives (a
window moved back one bar, a window moved one beat later, a pitch-shuffled window, an accompaniment part) and 4
positives (real windows that end in a perfect authentic cadence). They look like every other item. The reviewer is
not told which items are controls.

## Procedure (operator)

```
cd tools/corpus-build
python -m corpus_build review-export     # writes build/review/packet-NN.json and build/review-key/ (do not show the key)
# for each packet, two independent review runs: variant A and variant B (fresh context each, strongest model tier)
python -m corpus_build review-ingest     # checks the answers, scores the controls, updates review/verdicts.jsonl and review/batches.jsonl
python -m corpus_build review            # applies the cache: build/review/candidates.jsonl for the emitter
```

1. Give the reviewer this file's "Brief" section, the text of **one** variant prompt, and **one** packet file. Nothing
   else: not `build/review-key/`, not other packets, not the pipeline's records, not the other variant's answers.
2. Run variant A and variant B on every packet as separate, independent runs (a new conversation each, so one run
   never sees the other's answers). Use the strongest model tier for L1 to L3 (03 6.12).
3. The reviewer writes `build/review/packet-NN.verdict-A.json` (variant A) or `build/review/packet-NN.verdict-B.json`
   (variant B) in the format below.
4. `review-ingest` scores each packet's controls per variant. A packet's verdicts count only if its negatives are
   rejected at least 90% of the time (with 4 negatives: all 4) and its positives accepted at least 75% (at least 3 of 4).
5. A packet that fails for one variant may be re-run once with that variant: write
   `packet-NN.verdict-A.retry.json` (or `-B.retry.json`) and ingest again. If the retry also fails, the packet's items
   stay excluded; that is conservative, and the report counts them.
6. Commit `review/verdicts.jsonl` and `review/batches.jsonl`. CI only reads them and never calls a model. Packet and
   answer files live in the git-ignored `build/`; only the committed cache matters for the build.

Ingest before re-exporting: an export after a change renumbers the packets, and answer files for an old packet are
refused (`packetHash` mismatch). Items that already carry a decision for both variants are not exported again; only new
content hashes need review.

## Answer format (both variants)

`packet-NN.verdict-A.json` and `packet-NN.verdict-B.json` (`schemas/review-packet-verdict.schema.json`):

```json
{
  "packetId": "packet-01",
  "packetHash": "sha256:<copied from the packet>",
  "promptVersion": "rubric-v1",
  "promptVariant": "rubric-v1-a",
  "model": "<model id>",
  "verdicts": [
    {
      "itemId": "item-01",
      "completePhrase": true,
      "conclusiveEnd": true,
      "accompanimentLike": false,
      "idiomaticForWinds": true,
      "levelPlausible": true,
      "verdict": "accept",
      "reasons": []
    }
  ]
}
```

- One entry per item of the packet, every `itemId` exactly once. `promptVariant` is `rubric-v1-a` in a `-A` file and
  `rubric-v1-b` in a `-B` file. Copy `packetId`, `packetHash` and `promptVersion` from the packet.
- The five checks are booleans: `completePhrase`, `conclusiveEnd`, `accompanimentLike`, `idiomaticForWinds`,
  `levelPlausible`.
- `verdict` is `accept` only if `completePhrase` and `conclusiveEnd` are true, `accompanimentLike` is false and
  `levelPlausible` is true. `idiomaticForWinds` false does not by itself force a reject (the corpus also serves voice,
  strings and piano), but say why in `reasons`. Ingest turns an `accept` that fails one of the four required checks
  into a `reject` and warns.
- `reasons`: short phrases, at least one for a reject, for example "ends on the leading note", "bars 7-8 are a pedal
  figure", "begins mid-phrase (bar 1 continues the previous phrase)", "dotted rhythms and a 7th leap are above level 2".

`review-ingest` maps each item to its window's content hash and writes one `ReviewVerdict` line per real item and
variant to `review/verdicts.jsonl` (`schemas/review-verdict.schema.json` at the repo root; `pass` is 1 for variant A
and 2 for variant B), and one record per packet and variant to `review/batches.jsonl` (the content hashes it held, the
control scores, the attempt and whether it passed). An item ships only if both variants accept it and both of those
verdicts come from packet runs whose controls passed.

## Brief (give this to the reviewer with one variant prompt)

You are reviewing excerpts for a sight-reading trainer. Each item is an 8 to 12 bar single melodic line cut from
public-domain art songs and string quartets. The player reads it once and plays it on their instrument (flute,
clarinet, saxophone, trumpet, violin, cello, voice or piano, one line) while a metronome runs. The app transposes it to
suit the instrument, so the written key does not matter for your judgement. Judge each item from the packet alone.
Do not look for other files, and do not try to identify the piece.

Each item gives: `key` (written key and signature), `meter`, `bars` (full bars; a `pickup` is extra), `tempo` (the
source marking if any, and the tempo range the app serves at this level, in beats per minute of the metronome beat),
`taggedLevel` (1 to 10; 1 is the easiest), `featureLevels` (the level each feature calls for; the tagged level is
their maximum: `rhythm`, `interval`, `leaps`, `span`, `mode`, `chromatic`, `meter`, `double` accidentals, `density`),
`source` (collection, part, source measures, and whether note values were doubled from the source), `range`, and
`notes` bar by bar: spelled pitch (C4 is middle C) and note value; "~tied to next" ties the note into the next one.

Levels 1 to 3, for reference (`config/levels.json`; meters 2/4, 3/4 and 4/4 only):
- L1: major keys; whole, half, dotted half and quarter notes and rests; at most a 4th between notes (larger leaps only
  within the tonic triad, up to an octave), at most 2 leaps per 4 bars, a range of at most an octave, no accidentals.
- L2: adds minor keys (natural or harmonic), pairs of eighths and a one-beat pickup; intervals up to a 5th, up to 4
  leaps per 4 bars.
- L3: adds dotted quarter and eighth, eighth rests, ties over the barline and longer pickups; larger leaps within the
  tonic or dominant triad; up to 6 leaps per 4 bars, a range of up to a 10th, one chromatic note per 4 bars; a half
  cadence may end the excerpt.

Answer every item. Answer in the JSON format of the answer file, nothing else. Be strict: when you are unsure whether
an excerpt is a complete musical thought with a convincing ending, reject it. A rejected good excerpt costs little;
an accepted bad one is served to learners.

### Variant A prompt: rubric-v1-a (checklist)

For each item, answer these questions in order, then decide.

1. `completePhrase`: Does the excerpt start where a phrase starts (a downbeat or a short pickup after the previous
   phrase has ended) and contain only whole phrases? Look at bar 1: does it sound like a beginning, or like the middle
   of a line? Look for phrase ends inside the excerpt (a long note or rest on a strong beat): does the music after the
   last one form a complete phrase too? Answer false if the excerpt begins or ends mid-phrase, or if the barlines seem
   to fall in the wrong places (phrase ends landing on weak beats throughout).
2. `conclusiveEnd`: Does the last bar end on a cadence: the tonic (or the third of the tonic chord) reached by step or
   from the dominant, on a strong beat, held or followed by a rest? At L3 a clear half cadence (the dominant, held, at
   the end of a full phrase) also counts. Answer false if the last note is a passing note, a leading note, a pickup
   into another phrase, or a short note on a weak beat.
3. `accompanimentLike`: Does the line read as accompaniment rather than melody: repeated chord tones or broken-chord
   patterns, an alternating pedal note, long held notes that only fill harmony, or a bass line moving in 4ths and 5ths
   under someone else's tune? Answer true if so.
4. `idiomaticForWinds`: Could a wind player play it as written at the served tempo: places to breathe at least every
   four bars or so, no long runs of wide leaps, nothing that only works on a bowed or keyboard instrument? Answer false
   if not.
5. `levelPlausible`: Given the reference above, do the rhythms, intervals, range and accidentals fit `taggedLevel`?
   Answer false if a learner at that level would find it clearly harder than the level (or, at L1, if it uses note
   values or leaps the level excludes).
6. `verdict`: accept only if 1 and 2 are true, 3 is false and 5 is true. Otherwise reject, with the failing checks as
   short `reasons`.

### Variant B prompt: rubric-v1-b (sing it through)

Read each item as a musician would: hear it in your head at the served tempo, from the first note to the last, before
you answer anything. Then write down what you heard, as answers to these questions.

- Would a listener who heard only this excerpt feel that it began at a natural starting point and stopped because the
  music finished, not because it was cut off? That is `completePhrase` (it begins at a beginning and holds whole
  phrases) and `conclusiveEnd` (the final note feels like arrival: a cadence on the tonic, or at L3 a clear half close).
  Sing the last two bars twice. If you want to go on to the next note, the end is not conclusive.
- Is this the tune, or the part that accompanies the tune? A line that circles a chord, repeats one figure, alternates
  with a pedal note or holds notes while nothing happens is `accompanimentLike`.
- Picture a flute or clarinet student playing it: is it `idiomaticForWinds` (breathable, with phrase-length lines and
  no awkward leaping figuration)?
- Picture a student at `taggedLevel` (see the reference above) reading it for the first time: is the difficulty about
  right, not clearly harder? That is `levelPlausible`.

Decide: `accept` only if it begins and ends like real music, is a melody, and suits the level (`completePhrase`,
`conclusiveEnd`, `levelPlausible` true, `accompanimentLike` false). Otherwise `reject`. In `reasons`, say in a few words
what you heard that made you reject it (for example "stops on the 7th degree", "the first bar is the end of a previous
phrase", "an oom-pah figure throughout").

## Files

| Path | What |
| --- | --- |
| `config/review.yaml` | prompt version and variants, queue levels, packet make-up, control thresholds, the positive-control rule |
| `config/filters.yaml` `outliers` | R1 tail share, metrics and reject counts |
| `corpus_build/review_outliers.py` | R1: tails by robust z-score, `levelConfidence`, the Krumhansl-Schmuckler key check |
| `corpus_build/review_items.py` | content hash, the readable item, the negative controls |
| `corpus_build/review.py` | the `review`, `review-export` and `review-ingest` stages |
| `schemas/review-packet.schema.json` | a packet |
| `schemas/review-packet-verdict.schema.json` | an answer file |
| `review/verdicts.jsonl` | committed verdict cache (ReviewVerdict lines) |
| `review/batches.jsonl` | committed control results per packet and variant |
| `build/review/packet-NN.json` | packets (git-ignored) |
| `build/review-key/` | which item is which (git-ignored; never shown to a reviewer) |
