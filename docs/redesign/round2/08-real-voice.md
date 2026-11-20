# Round 2: the first real voice

Role: detection engineer (pitch tracking, note segmentation, score following).
Input: two tries exported by the owner from the round 2 build: an untrained baritone, a Mac's built-in mic and speakers, difficulty 1, the same 8-bar excerpt twice. Try 1 at 64 bpm (trace only), try 2 at 72 bpm (trace and 29 s of 16 kHz audio).
Scope: `src/follow`, `src/testkit/untrained`, `grading.detection.oneNote` and its schema, `tools/diagnostics`, `fixtures/real-voice`. No change in the detector (`src/dsp` has one test helper updated), the app, the screens or the session. The audio stays out of the repository.

## Summary

1. The replay tool reproduces both tries. From the trace, try 1 gives the stored verdict for all 16 written notes and the same 11 extras. From the audio, try 2 gives the stored verdicts, the same extra and the same displaced run. Before this fix the audio replay never finished: the worker's end timer had no clock to fire it.
2. One sung note is now one note on this voice. Try 1: 29 detected notes for 16 written (1.81 per note) became 16 (1.00), and its 11 extras became 4. Each of the 4 is a note sung where nothing was written. Try 2: 23 became 18 (1.44 to 1.13), and its one extra, the late last note, stays. The first note of try 1 is on time and in tune (it was 256 ms late with the scoop as an extra). The C4 of try 2's bar 2 now starts where the sound starts (-55 ms; it was +121 ms).
3. Real errors stay. Every wrong pitch the app gave in either try is still a wrong pitch. That is 9 notes in try 1 and the flat second half of try 2 (notes 9 to 14, 218 to 444 c flat). Bar 3 of try 2 is still reported as sung one beat late.
4. The late last note of try 2 stays "missed" plus an extra. The spec's match window for that note is 417 ms, and it came about 0.65 s late (section 4).
5. The untrained-voice model now sings the same things: long scoops, overshoots, glitches an octave or more down, dips under the next note and steep tails. On the old code the model's gate fails (1.229 detected per note, 0.201 extra ghosts drawn and 0.056 final extras per written note). On the new code it passes (1.010, 0.039, 0.009). `pnpm gates`: 194 of 195, as before. The one failure is still voice room F1 (PLAN R54), which moved from 0.8926 to 0.9014.

## 1. Reproducing the tries

`pnpm exec tsx tools/diagnostics/replay.ts <file>`:

- Try 1 (no audio): from the trace, through the live follower and the final alignment. Every stored verdict is reproduced, along with the same 11 extras.
- Try 2 (audio): through the DSP worker core. Before the fix the replay stopped with "the DSP worker did not finish". The block start times are summed in floating point and stop a hair short of the end time, and the stub timer never fired the worker's end wait. The replay now fires that timer once 'end' is in, as the real worker's timer would. After the fix the 27 detected notes, all 16 verdicts, the extra and the displaced run equal the stored ones.

Other replay changes:

- The one-note tolerances are re-resolved from the current config. The trace carries its build's row.
- The table lists the notes the alignment used (after joining) and counts both.
- Displaced runs are printed.

The overseer's findings, checked:

- Reference tones and count-in: correctly ignored in both tries. Try 1's notes 1 to 8 are ignored: the four reference tones, then four notes hummed during the count-in. Try 2's notes 1 to 4 are ignored too.
- Pitch: right. The tracker's frames agree with the notes. Section 2 shows the frames for each case.
- Latency: the count-in clicks of try 2 arrive 100.5 to 101 ms after they were scheduled. The app assumed 80 ms (reported, uncalibrated), so every onset reads about 21 ms late. That is inside every timing tolerance here; calibrating would remove it.

## 2. What the real voice does that the model did not

| Real voice (frames from the traces) | Untrained model before | What the detector did |
| --- | --- | --- |
| Slow scoop with a wobble: try 1's first C4 rose from 57.5 to 59.4, fell back to 58.4 and reached 60.2 after 300 ms | Scoops of 60 to 200 ms, smooth | Split after the 250 ms scoop window. The settled half was matched 256 ms late and the scoop was an extra |
| Overshoot: try 2's C4 started at 60.3, rose to 60.95 and settled at 60.0 after 260 ms | None (a few scoops from above, smooth) | Split. The note was matched to the settled half, 121 ms late |
| Glitch inside a held note: 11.4 semitones down for 160 ms (try 1, 18.88 s) and 14.7 down for 160 ms (21.13 s). Level and clarity stay steady (0.98) | Creak at onsets only, mild | Each glitch made a note, and the held note was cut in three |
| Dip under the next note: before a rising step the pitch fell 150 to 200 c for 60 to 90 ms (try 2, D3 to E3 and E3 to F3) | None | A 90 ms fragment between two notes |
| Tails that fall 200 c or more while still loud (try 1: 115, 52 and 62 ms tails; try 2: a 137 ms tail, a 120 ms bump up) | Falls 40 to 200 c as the level dies 25 dB | The round 2 release rule needs the confirming frames 12 dB below the peak. These were not, so they split off as fragments |
| A split with halves 38 c apart: try 1's second C4 scooped slowly, and the change was measured against the scoop's frames | Not seen | Two notes at C4; the second was an extra for 895 ms |
| A held A3 drifting 93 c flat over 300 ms (try 2, 7.35 s) | Drift of up to about 20 c | Two notes. This is kept: neither piece is the written pitch (section 3) |

On the glitch: neither the pitch tracker's octave hysteresis nor `altOctaveClarity` can stop these at the source without costing every instrument. The hysteresis folds only jumps of 12 ± 0.5 semitones and believes them after 4 frames (32 ms). These were 11.4 and 14.7 semitones and lasted 160 ms. Holding a jump back for 200 ms would delay every real octave leap's note-on by 200 ms. The 1024-window latency p95 is 76.2 ms against a 79 ms limit, so nothing that delays a note-on fits. `altOctaveClarity` (the NSDF an octave up) was high on both glitch notes (0.72 and 0.66) and at or below 0.3 on almost every sung note. It is useful evidence. The fix below does not need it, and with no audio of try 1 a tracker change could not be tested on the real glitch.

## 3. What changed

### The final pass: `src/follow/consolidate.ts`

The segmenter decides live, frame by frame, and cannot take back a note it has started without delaying every note-on. So the pieces are joined again on the finished note list. This happens inside `playerNotes`, which the DSP worker calls before the final alignment and before the try is stored, so the stored try, the results, the gates and the replay all see the joined notes. Every rule needs two notes that meet at a pitch change: the second starts where the first ended, with `onsetCause` 'pitch-change'. A breath, a re-articulation or a rest between two notes always keeps them apart.

1. Glitch: a note shorter than `glitchMs` that lies `glitchSemitones` or more from every neighbour it meets is not a note, provided one of those neighbours is longer than a glitch. Its time goes to the note it interrupts. The same applies to an excursion that comes back: a note shorter than a long scoop, `mergeCents` or more away, between two notes within `mergeCents` of each other.
2. Fragment: a note shorter than `fragmentMs` that meets a neighbour joins the neighbour nearer in pitch.
3. Long scoop: a note shorter than `longScoopMs` that runs into a longer note within `scoopMaxCents` is that note's scoop. The joined note starts where the sound starts and has the settled pitch. A scoop comes from below, or from above when the note settles on the written pitch (an overshoot).
4. Same note: two notes that meet within `mergeCents` (80 c, the change threshold) are one note. The longer piece gives the pitch.

Written notes keep real notes apart. The written onsets play the same role as in the round 2 scoop rule, and the follower also knows the written pitches.

- Rules 3 and 4 never join two notes that start nearest different written notes when the second is inside its written note's match window. That is the singer moving on to the next written note, sung legato.
- A short note that sings the written note nearest it is never absorbed into a neighbour that does not.
- A fragment that starts within the good-timing tolerance of the next written note is that note's attack. It never joins the note before it.
- A glitch or an excursion is bridged across the next written onset unless the return sings that next written note.

The joined note keeps the first piece's id, which is the one the live follower matched. The pass is idempotent. It is off for profiles without a `oneNote` row, and for a row stored before these tolerances existed, so an old trace replays as it was sung.

### Live: `src/follow/continuation.ts` and `live-follower.ts`

The same rules apply live, read at each piece's note-on. A piece that meets the matched note's last piece, and that the final pass would join, continues the note. It is not matched, not drawn as an extra and not put in the displacement window. The note's judgment is finished when its last piece ends, with the pitch of its longest piece; a glitch never gives the pitch. A far piece that lasts past `glitchMs` turns out to be a note of its own and is drawn as usual. A wrong pitch is not shown live until the note is older than a long scoop (350 ms at difficulties 1 to 3), so a scoop is never a red flash. At difficulties 1 to 3 the screen already holds played notes and extras for the results (PLAN R61).

### Configuration

The new columns sit next to the round 2 rows in `grading.detection.oneNote`, with the schema regenerated from `OneNoteBand` in `src/core/types.ts`:

| Difficulty | glitchMs | glitchSemitones | fragmentMs | longScoopMs | scoopMaxCents | mergeCents |
| --- | --- | --- | --- | --- | --- | --- |
| 1 to 3 | 200 | 10 | 150 | 350 | 300 | 80 |
| 4 to 6 | 170 | 10 | 120 | 300 | 300 | 80 |
| 7 to 10 | 140 | 10 | 90 | 250 | 300 | 80 |

Each length is also capped by the written rhythm around the note, so a fast written note is never short enough to be absorbed. The caps are fractions of the shortest neighbouring inter-onset interval, in the same rows: `fragmentIoiFrac` 0.3, `glitchIoiFrac` 0.75 and `scoopIoiFrac` 0.75 at every difficulty.

### The model: `src/testkit/untrained/voice.ts`

The new phenomena are drawn from a second random stream, so every draw of the round 2 model is unchanged. Over the 40 gate takes (1052 notes) they give:

- 109 long scoops (220 to 400 ms from 80 to 250 c below, most with a wobble);
- 54 overshoots (70 to 110 c up, settling over 200 to 320 ms);
- 61 glitches in held notes, 80 to 180 ms with a steady level: 23 period doublings that read an octave down, and 38 creaks 11 to 15 semitones down, kept above the voice's lowest detected pitch so they stay voiced as the real ones did;
- 99 dips of 100 to 220 c under the next note;
- 35 steep tails that fall 180 to 320 c while dropping only 10 to 14 dB.

## 4. The late last note (try 2)

02 §4.1: `W_i = max(tBad_i, min(max(250 ms, 0.5 beat), 0.5 × min(IOI_prev, IOI_next)))`, and "a score note not matched by expected onset + W_i is missed". For the last C4 at 72 bpm, half a beat is 417 ms. Half the 833 ms interval from the G3 before it is also 417 ms, and it has no next note. So W is 417 ms. The C4 started about 0.65 s after its written onset, past the window, so the spec says missed. The sung C4 is unmatched and longer than 100 ms, so it is an extra. Nothing else competes for it, and it is a half note, but the spec's window does not depend on either. The verdict is left as it is. Whether a last note, or a long note with nothing near it, should get a wider window is a question for the spec owner. No rule was invented here.

## 5. Numbers

### The two tries (replayed with the current build)

| | Try 1 before | Try 1 after | Try 2 before | Try 2 after |
| --- | --- | --- | --- | --- |
| Player's detected notes (16 written) | 29 | 16 | 23 | 18 |
| Detected per written note | 1.81 | 1.00 | 1.44 | 1.13 |
| Extras | 11 | 4 | 1 | 1 |
| Extras from scoops, splits, fragments or glitches | 7 | 0 | 0 | 0 |
| First note | late, +256 ms | on time, -29 ms, in tune | on time | on time |
| Wrong-pitch verdicts | 9 | 9 | 6 | 6 |
| Missed | 4 | 4 | 3 | 3 |
| Displaced runs | 0 | 0 | 1 (notes 5 to 7) | 1 (notes 5 to 7) |
| Live mark later changed in the results (`rejudged`) | 3 | 2 | 6 | 4 |

Try 2's two notes above one per written note are both in the beat-late bar 3. First, an A3 held for 150 ms that glides up into the late B3; it sings the written A3, so it is kept. Second, the held A3 that drifts 93 c flat. Neither is reported as an extra.

### Gates (`pnpm gates`, 1771 takes)

Before (commit df37a77) and after, same seed:

- Verdict: 194 of 195 before and after, 0 blocking failures. The one failure is voice room F1 (PLAN R54): 0.8926 (777/123/64) before, 0.9014 (768/95/73) after.
- Voice clean: unchanged, F1 0.9964, agreement 99.2%, false missed 0.38%, false extras 0.00 per take, live≠final 2.29%.
- Voice device: unchanged, F1 0.9952, agreement 99.3%, false missed 0.38%, live≠final 2.29%.
- Voice room (reported, gated on F1 only): agreement 94.8% to 94.4%, false missed 3.78% to 3.78%, false extras 0.15 to 0.12 per take, live≠final 6.51% to 5.14%, pitch class 99.21% to 99.08%.
- Every other instrument and condition, latency (512: p95 59.5 ms; 1024: p95 76.2 ms), displacement and tip rows: unchanged. The worker's per-block cost line (not a gate) read 0.71 ms against 0.29 ms because other browser tests shared the machine during the run; `src/follow/budget.test.ts` (fastest of 7 per hop) passes.

### Untrained voice (40 takes, 1052 written notes)

| Model and code | Detected / note | Extra ghosts / note (live) | Final extras / note | Shown wrong pitch live | False wrong pitch | False missed | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Round 2 model, round 2 code (the committed report) | 1.010 | 0.015 | 0.000 | 1.71% | 0.48% | 0.86% | pass |
| Round 2 model, this code | 0.993 | 0.005 | 0.000 | 0.76% | 0.48% | 0.86% | pass |
| Real-voice model, round 2 code | 1.229 | 0.201 | 0.056 | 14.54% | 1.43% | 0.86% | fail |
| Real-voice model, this code (now in `pnpm gates`) | 1.010 | 0.039 | 0.009 | 2.19% | 1.33% | 1.05% | pass |

On the round 2 model the final verdicts are the same note for note. Only the live view improved.

## 6. For the owner: what each try shows

Both tries are the same eight bars: C4, A3 B3, G3 C4 B3 A3 G3, then E3 G3 B3 A3 F3 G3 G3 C4, in 3/4.

### Try 1 (64 bpm)

**What you sang.** You started well. The first C4 slid up from below and settled in tune, and G3 and the second C4 were right. Many of the other notes were a whole tone to a minor third below the written ones: the A3 and B3 of bar 1 and the A3 and G3 of bar 3. In the second half you lost the line. You sang the E3 about a beat early, a C4 in the middle of that long E3, then notes up around E♭4 and D4 where the music goes down to F3 and G3. The last C4 came about a second late.

**Where the app was wrong.** Your first note was marked late, because the app took the slide into it as a separate note. Your second C4 and the last long notes were each cut into several pieces. In two places your voice cracked down for a split second, and the app read each crack as a low note. That gave 11 extra notes, 7 of which were pieces of notes you sang once. Now each sung note counts once: the first note is on time and in tune, and only the 4 notes you really sang where nothing was written are extras.

**Where it was you.** The wrong pitches are real, and they are all still marked: 9 notes, mostly sung a step to a third low, or in the wrong place in the second half.

### Try 2 (72 bpm)

**What you sang.** The first bar and a half was good: C4, A3 and B3 on time and in tune (the A3 a little flat), G3 and C4 too. In bar 3 you held the C4 too long. B3, A3 and G3 then came about a beat late but at the right pitches, and the app reports them as a run sung a beat late. You were back on time for E3. From the G3 after it (note 9) to the second-to-last G3 you sang about a minor third flat, two to four and a half semitones under the written notes. The last C4 was back in tune, but about two thirds of a second late.

**Where the app was wrong.** Only small things. Your C4 in bar 2 went a little sharp before it settled, and the app started that note late (+121 ms). It now starts where your sound starts. A few short dips between notes were counted as tiny notes. They were never marked, and now they are not counted either.

**Where it was you.** The flat stretch (notes 9 to 14) is still marked wrong pitch, and it should be. The last C4 is marked missed, with your C4 as an extra, because it came after the end of the window the grading rules give that note (417 ms at this tempo). That is the spec's rule, and it has not been changed here. Your setup also hears the clicks about 21 ms later than the app assumes. Calibrating (Settings, or the "Not calibrated" pill) takes that off every note.

## 7. Tests

- `fixtures/real-voice/real-voice.test.ts`, on the two traces. The fixtures are derived and anonymised: the trace only, with no audio, no names, no device or settings, and the excerpt id replaced. The tests check:
  - replayed with the stored row, each trace gives its stored verdicts exactly;
  - with the current config: detected per written note before and after; no extras from scoops or glitches; try 1's first note on time and in tune;
  - try 2's first eight notes: none wrong pitch, and the ones sung in time in tune;
  - try 2's bar 3 is reported as sung a beat late;
  - the flat second half is still wrong pitch;
  - try 2's last note is missed and its C4 is an extra;
  - the joining is idempotent.
- `src/follow/consolidate.test.ts`: each rule and each protection, final and live. Live, a scoop draws no ghost and shows no red; a glitch never gives the pitch; a far piece that lasts is still drawn.
- `src/testkit/untrained/untrained.test.ts`: the new phenomena are drawn, and a take with scoops and both kinds of glitch has one note per written note and no extras.
- `tools/diagnostics/replay.test.ts` (unchanged) still passes: the synthetic try replays the same from its audio and from its trace.

## 8. Left open, and what real data would help most

- The voice room row lost 9 true onsets (777 to 768) while it dropped 28 false ones. In a reverberant room the joining sometimes merges a real short note into its neighbour. That row is gated on F1 only, and F1 improved; it is worth a look with a real room recording.
- Same-pitch repeats joined by a shallow syllable dip are still sometimes merged by the segmenter (03-detection, "Left open").
- The live view decides at each note-on, without the final pass's knowledge of how long each piece lasts. It agreed with the results on 14 of 16 notes in try 1 and 12 of 16 in try 2.
- Most useful next: tries with audio. One more of this excerpt with audio, and calibrated, would show try 1's glitches in the frames, and whether a tracker-level fix (`altOctaveClarity` or a voice-only hysteresis) is worth its latency. A different excerpt with a written octave leap and a written same-pitch repeat would test the protections against real legato. A try in a more reverberant room would show what the model's room condition is missing. A try with headphones would tell the singer's own timing apart from what the speakers add.

## Files

- Config and types: `config/grading-config.json` (`detection.oneNote`: nine new columns), `schemas/grading-config.schema.json`, `src/core/types.ts` (`OneNoteBand`).
- Follower: `src/follow/consolidate.ts` (new), `src/follow/continuation.ts` (new), `src/follow/live-follower.ts`, `src/follow/own-playback.ts` (`playerNotes` joins).
- Testkit: `src/testkit/untrained/voice.ts`, `src/testkit/untrained/run.ts`.
- Tools: `tools/diagnostics/replay.ts`.
- Fixtures and tests: `fixtures/real-voice/real-voice-try-1.json`, `fixtures/real-voice/real-voice-try-2.json`, `fixtures/real-voice/real-voice.test.ts`, `src/follow/consolidate.test.ts`, `src/testkit/untrained/untrained.test.ts`, `src/dsp/one-note.test.ts` (the model's new fields in its helper).
