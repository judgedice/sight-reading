# Round 3: pitch steadiness on the live pitch screens

Role: senior musician (voice teacher) and sound designer with DSP experience.
Input: the owner's report on the first-run pitch step ("it's bouncing all around because of my voice, I should be able to set some kind of wave tolerance"), and three diagnostics exports from the owner (untrained baritone, a Mac's built-in mic and speakers, difficulty 1). Try 1: the 8-bar excerpt at 64 bpm, trace only. Try 2: the same excerpt at 72 bpm, trace and 29 s of 16 kHz audio. Scale try: the five-note scale in C at 66 bpm, trace and 23 s of audio. The audio stays outside the repository. Only derived statistics appear here.
Scope: this is a spec. Nothing in `src/`, `config/`, `design/` or `e2e/` was changed. The analysis scripts are outside the repository.

## Summary

1. **Which screens.** Two screens show a live pitch needle, and both are the same component: "Match a note" (`#/match`) and onboarding step 5, "Sing one note" (`MatchStep`, which reuses `MatchPanel`). The calibration "Pitch check" plays a machine tone and shows no live pitch. The tuning note for winds, brass and strings reads a 3 s capture and shows no needle. During a try, the live sharp and flat marks are not a needle, and they are already median-based (section 1.4).
2. **What the needle does now.** It shows a 40 ms mean of the raw frames, 50 times a second, with no hysteresis or dead band. A 100 ms CSS ease follows it, and that is the only smoothing. The decision "in tune" is made fresh on every 20 ms frame: each 40 ms mean must sit within ±30 c. A hit needs 800 ms of such frames with no break. So the needle and the big words follow every wobble. On his voice, the words ("A little low. Go up." / "Hold it…" / "A little high. Go down.") change a median of 2.7 and a p90 of 8.6 times a second during a held note.
3. **How his voice moves** (44 sung notes, three tries):
   - Wobble: median 43 c peak-to-peak, which is about ±22 c. The p90 is 75 c and the widest is 104 c.
   - Rate: median 3.3 Hz (IQR 2.2 to 4.5), with no stable rate from note to note.
   - Drift: up to 44 c across a held part.
   - Approach: 59% of notes start more than 30 c off (median size 78 c, p90 187 c), and they settle in a median of 164 ms (p90 371 ms).
   - Glitches: two octave-plus glitches of 140 to 190 ms, both in try 1.
   - Dropouts inside notes: 8 to 48 ms.

   That is a normal untrained voice. Most beginners would be "on the note" by a teacher's standard if the centre of the wobble is judged.
4. **The real bug is the judging rule on Match a note, not only the needle.** On 3 s holds built from his own held notes, at exactly his own centre, the current rule gives a hit on only 9 of 21 notes. It shows "in tune" only 83% of the time even when he is dead centre. It also shows "in tune" 14% of the time when he is truly more than 40 c off, because the wobble sweeps through the band. The rule is stricter than the try grading, which judges the steady median of a note against 30 c (full credit) and 45 c (in tune) at difficulties 1 to 3.
5. **Proposal.** A display filter, then a centre-based in-tune decision:
   - The filter: gate, tail gate, octave-glitch guard, a running median over about one wobble cycle, an exponential smoother, a detent, and short-dropout hold.
   - The decision: a median over 300 to 400 ms, symmetric hysteresis around the same 30 c band, and a fast exit for big moves.
   - On his voice (Balanced): fast needle movement falls from 11.8 to 5.1 c RMS, and the words stop flickering (0 changes a second during a hold). Hits at his centre go from 9 of 21 to 21 of 21. "In tune" shown while truly more than 40 c off falls from 14.3% to 4.3% of such time. No hit is given when he is 45 c or more off, apart from 1 of 21 notes whose own drift carried it into the band.
6. **One setting**, Settings › Display › "Pitch needle": **Steady / Balanced / Quick**. It changes only how the needle moves and how fast it settles. Default: Steady for voices, Balanced for instruments. No separate "how close counts" control. The 30 c band stays where the grading config puts it, and nothing here reaches the ranked tries.
7. **The setup pitch step** should stay skippable. It is a voice-specific microphone and pitch-matching check, and it stores nothing. Add a "Continue" once a steady voice has been heard for 1 s, so a beginner who cannot match yet is not stuck behind "Skip".

## 1. What the live readouts do now

### 1.1 Screens

| Screen | Live pitch? | What it shows |
| --- | --- | --- |
| Match a note, `#/match` (`src/app/screens/match/MatchScreen.tsx`, `MatchPanel.tsx`, `Needle.tsx`) | Yes | ±50 c needle, green band, big state line, "You: E3, 34 cents low" line |
| Onboarding step 5, "Sing one note" / "Play one note" (`src/app/screens/onboarding/MatchStep.tsx`) | Yes, the same panel without the range chips | As above. It never moves on by itself: Continue appears after a hit, and Skip is in the step header (`OnboardingScreen.tsx` line 198) |
| Calibration "Pitch check" (`src/calibration/tone.ts`) | No | The app's own 8 c sanity tone through the loopback; pass or fail |
| Tuning note (winds, brass and strings only, `PracticeSession.captureTuningNote`) | No | A 3 s capture and one offset; not voice |
| Try (Perform screen) | No needle | Live marks per note: sharp or flat after `live.provisionalMs` (80 ms) of steady pitch, entered at red + 10 c and left at red (`rules/live-verdict.ts`, R19). That rule already uses the segmenter's steady median |
| Perform screen mic meter | Level only | Bars from `levelDb` |

### 1.2 The chain on Match a note

1. The `PitchAnalyzer` runs at 16 kHz, with a 1024 window and a 128 hop for baritone. That is one frame per 8 ms. Clarity threshold 0.8. The octave hysteresis folds only 12 ± 0.5 semitone jumps, believed after 4 frames.
2. `PitchModeTracker` in the worker (`src/platform/web/audio/dsp-worker-core.ts`), with `MATCH_NOTE` in `src/session/match-note.ts`:
   - It posts every 20 ms (`stepSec`).
   - The pitch is the **mean of the voiced frames of the last 40 ms** (`smoothSec`). That is about 5 frames, a boxcar that barely touches 3 to 5 Hz.
   - `steady` means voiced for 150 ms without a break, with max minus min ≤ 120 c over the last 150 ms (`steadySpreadCents.vibrato`).
   - Gate at -65 dBFS. Any unvoiced frame resets the run.
3. The reducer (`src/app/screens/match/model.ts`):
   - On each steady frame: `needle = clamp(dev, ±50)`, where for a voice `dev` is folded to the nearest octave of the target.
   - The phase is `in-band` if |dev| ≤ 30, otherwise `flat` or `sharp`, **decided on that one frame**.
   - A non-steady frame breaks the hold, and the needle keeps its last value.
   - Hit: in band for 800 ms (`HIT_HOLD_MS`) with no break.
   - "Higher. Try E3" after 2 s beyond 3 semitones. "Not heard" after 6 s with no steady frame.
4. The screen: the needle's `left` has `transition: left var(--dur-fast) var(--ease-out)`, which is 100 ms, `cubic-bezier(0.2,0,0,1)`, and 0 ms under reduced motion. The reducer's timers tick every 100 ms. The "You" line re-renders at 50 Hz with whole cents.

So the value shown is a near-raw frame pitch (a 40 ms mean). It is not a median or a note-level estimate. Hysteresis: none. Dead band: none. Smoothing: 40 ms boxcar plus a 100 ms CSS ease, and none at all under reduced motion.

### 1.3 Tolerance in cents

Match a note always uses the difficulty 1 band (`matchBandCents`): `grading.intonation.bands`, `goodCents` for the voice group at levels 1 to 3, which is **±30 c**. Instruments use the continuous group: ±25 c. The band does not change with the player's difficulty.

For comparison, the try grading for voice (`config/grading-config.json`, 02 §4.2 and §4.3) judges the **steady median of the whole note**:

| Difficulty | Full credit (good) | Still in tune (red) |
| --- | --- | --- |
| 1 to 3 | 30 c | 45 c |
| 4 to 6 | 25 c | 40 c |
| 7 to 10 | 20 c | 35 c |

Notes with less than 180 ms of steady pitch are not intonation-graded for voice.

### 1.4 Finding

The try grading is wobble-tolerant by construction, because it judges a median. Match a note is not: it asks every 40 ms slice of the note to be within 30 c for 800 ms. A ±22 c wobble around a centre 10 c flat breaks that on most cycles. The warm-up is stricter than the graded try, and it says "A little low", "Hold it…" and "A little high" in turn while the singer is doing what a teacher would call holding the note.

## 2. How his held notes move

Method:

- The production `PitchAnalyzer` and `PitchModeTracker` were run on the two audio exports. That gives 8 ms frames, and the tracker output matched the app's own frames within 0.08 c with 100% agreement on `steady`.
- Try 1 uses its 24 ms trace frames.
- Notes are voiced runs split where a 72 ms median moves more than 70 c for 150 ms. The reference tones were masked out. 44 notes of at least 0.4 s are included; 32 of them have a held part of 0.25 s or more after settling and before the tail.
- "Settled pitch" is the median of the second half of the note.

| Measure | Median | IQR | p90 | Range |
| --- | --- | --- | --- | --- |
| Note length (ms) | 764 | 576 to 976 | 1198 | 408 to 1696 |
| First 40 ms against settled pitch (c, signed) | -13 | -66 to +15 | +58 | -304 to +167 |
| Size of the approach, when over 30 c (c) | 78 | 51 to 131 | 187 | 32 to 304 |
| Largest excursion before settling (c) | 73 | 50 to 145 | 175 | 0 to 462 |
| Time to settle: 72 ms median within 35 c for 150 ms (ms) | 164 | 48 to 306 | 371 | 0 to 592 |
| Wobble peak-to-peak, 5th to 95th percentile of the detrended held part (c) | 43 | 35 to 53 | 75 | 22 to 104 |
| Wobble RMS (c) | 14.5 | 11.3 to 17.7 | 23.5 | 7 to 35 |
| Dominant wobble rate (Hz) | 3.3 | 2.2 to 4.5 | 5.4 | 1.5 to 6.9 |
| Zero-crossing rate of the wobble (Hz) | 3.9 | 3.0 to 4.9 | 5.7 | 2.5 to 6.5 |
| Drift across the held part, absolute (c) | 12 | 7 to 32 | 38 | 0 to 44 |
| Frame-to-frame jitter at 8 ms (c RMS) | 3.9 | 3.0 to 5.0 | 7.0 | 1.6 to 10.6 |
| Settled pitch against the nearest semitone, absolute (c) | 21 | 9 to 31 | 37 | 1 to 45 |

Direction of approach: 18 of 43 notes come from below (a scoop), 8 from above (an overshoot), and 17 start within 30 c.

Glitches: two in try 1, inside held notes, at steady level:

- 11.6 semitones down for about 140 ms;
- 14.7 semitones down for about 190 ms, with two short dropouts inside it.

None in try 2 or the scale try. These are the same events 08-real-voice §2 found. The count-in clicks also read as about 68.1 (G♯4) for 3 frames at -45 dB during a try. That cannot happen on Match a note, which plays no clicks.

Dropouts inside notes: 24 in total, 8 to 48 ms each. Between notes, breaths are 150 ms or more.

Level: held parts sit at -31 dBFS (median; -46 to -19). The deepest dip below the running peak inside a held part has a median of 5 dB, a p10 of 9.7 dB, and a worst case of 16 dB. Tails fall 12 to 34 dB, often with the pitch moving 100 to 200 c, or straight into the next note.

Caveats:

- These were notes in a melody at 64 to 72 bpm, not long holds. The median held part is 570 ms, which is about two wobble cycles. That is too short to call each note's wobble regular or irregular from its spectrum: a perfect sinusoid over 0.57 s scores only 0.52 on the regularity measure used, against his median of 0.4. The evidence of irregularity is the spread of rates between notes (1.5 to 6.9 Hz) and the gap between dominant and zero-crossing rates.
- On Match a note he will hold longer. Expect more drift, not less.

### 2.1 Against a trained voice

- **Trained classical vibrato:** rate 5.5 to 7 Hz (a mean of about 6 Hz is the usual figure in Prame's and Sundberg's measurements), regular from note to note. Extent about ±50 to ±100 c in opera; choral and popular styles use ±20 to ±40 c.
- **Untrained voices:** the "vibrato" is not a vibrato. It is a slower (2 to 4 Hz), irregular wobble from unsteady breath and laryngeal control, plus slow drift and scoops into the note. His voice fits exactly: a narrower extent than an opera singer (±22 c typical), a slower and irregular rate, and drift of the same size as the wobble.
- **What listeners hear:** the pitch of a note with vibrato is heard close to the mean of the excursion, not the peaks (Shonle and Horan; d'Alessandro and Castellengo). That is the physical reason to judge the centre, and it is how the try grading already works.
- **Pitch matching in untrained adults:** typical errors are a few tens of cents. A minority are "poor-pitch" singers, with errors over 100 c (Pfordresher and Brown; Dalla Bella and colleagues). He is in the typical group on this evidence: his settled pitch sits a median of 21 c from the nearest semitone.

### 2.2 What a teacher accepts as "on the note" for a beginner

- **Centre within about ±25 to 30 c of the target**, judged over the held part (about half a second or more), not moment to moment. This matches the existing difficulty 1 band (30 c good, 45 c still in tune). Keep it.
- **Wobble up to about ±50 c around that centre is acceptable** at this stage. It is a breath-support issue for later, never a wrong note.
- **A scoop or overshoot of up to about 250 ms** is accepted. Point it out gently later ("start on the note"), but do not fail the note for it.
- **Slow drift of more than about 30 c should be shown.** It is the most useful thing a beginner can learn to hear ("you're sagging").
- **Never call an octave glitch or a crack a wrong note.** It is not musical information.

## 3. The display smoothing

Two things are separated:

- **A. Display smoothing**: how the needle and the words move. It is a property of the screen only.
- **B. The in-tune decision on Match a note**: when the screen says "in tune" and counts a hit. Match a note is a warm-up with no score, XP, rank or history (R67), so this is screen logic, not grading.

The band (30 c voice, 25 c instruments) is unchanged by every recommendation. **Nothing here touches the try's segmenter, follower, live marks or grader.** The steadiness setting must not be passed into `DspConfig` or `FollowConfig` (test T15).

### 3.1 The algorithm

The filter runs per analyser frame (8 ms) and posts every 20 ms. Pitches are in cents. Times are measured from the first voiced frame of the current run ("age").

1. **Gate.** A frame is voiced if the analyser gives a pitch (clarity ≥ the instrument's threshold, 0.8 for voice) and its level is ≥ -65 dBFS (as now).
2. **Tail gate.** A frame more than **12 dB** below the loudest frame of the last 500 ms is treated as a dropout: it is held, not shown. Why 12 dB: dips inside his held parts reach 9.7 dB at p10 and 16 dB at worst, while his tails fall 12 to 34 dB with the pitch moving. 12 dB is also `detection.oneNote.tailDropDb`.
3. **Dropout hold.** For an unvoiced gap ≤ **120 ms**, the needle and the in-tune state are kept, and the hit timer keeps running (bridged). From 120 to 600 ms, the needle dims at its last place, the state and the hit timer reset, and the history clears. After **600 ms** the needle is hidden. Why 120 ms: the in-note dropouts measured were 8 to 48 ms, so this leaves 2.5 times margin, and breaths are 150 ms or more. Today the needle stays at its last place indefinitely and "Not heard" waits 6 s. The 6 s message stays.
4. **Show delay.** No needle until **60 ms** of voiced frames, so a consonant or breath noise never flashes a pitch. Today the delay is 150 ms, from `steady`.
5. **Glitch guard, on unfolded pitch.** If a frame is more than **300 c** from the median of the last 200 ms of accepted frames, it is held and not added for up to **220 ms**. If it is still away after 220 ms, it is a real new pitch: the history restarts there.
   - This must run **before** octave folding. Folded against the target, an 11.6-semitone glitch reads as +40 c and passes any octave check. That is the trap the simulation found.
   - Why 220 ms: his glitches lasted 140 and 190 ms.
   - The cost: a real leap of more than 3 semitones shows 220 ms late. That is fine on a one-note screen, and it never touches the try's note-on latency budget.
6. **Octave fold.** For voice, the result is folded to the nearest octave of the target, as now (R7). Fold the centre once, not each frame.
7. **Centre.** The running median of the accepted frames over `w = clamp(age / 2, 40 ms, centreMs)`. The window grows as the note ages, so the scoop is shown as it happens and the wobble is hidden once the note is held. Why: a median over one full wobble cycle removes a periodic wobble almost completely. His median rate of 3.3 Hz has a 300 ms period.
8. **Smoother.** An exponential smoother with `tau = clamp(age / 3, 10 ms, tauMs)`, computed from the real frame interval, so it is frame-rate independent.
9. **Snap.** If the centre stays more than **80 c** from the smoothed value for **100 ms**, the smoothed value jumps to the centre. A deliberate move to another pitch is shown at once. 80 c is the detector's `changeCents`.
10. **Detent.** The drawn needle moves only when the smoothed value differs from it by `detentC` or more. That stops sub-pixel quiver.
11. **CSS.** The needle's `left` transition drops to 40 ms linear: the filter does the smoothing, and two smoothers in a row add lag. Under reduced motion it is 0 ms, as now.

The in-tune decision (on Match a note):

12. **Judge value.** The median of the accepted frames over `judgeMs`. It needs a full window of the current run, so a note shorter than `judgeMs` is never "in tune".
13. **Symmetric hysteresis around the unchanged band** (`band` = 30 c for voice):
    - enter when |judge| ≤ band - 5 for **100 ms**;
    - leave when |judge| > band + 5 for **150 ms**;
    - **fast exit:** leave at once if the short centre (step 7) is more than 2 × band (60 c) away for **60 ms**.

    Symmetric, not "enter at 30, leave at 40". The asymmetric version kept a note centred at -45 c with a ±40 c wobble shown in tune for 100% of the time in the simulation. Without the fast exit, a 130 c rise after a glitch stayed "in tune" for 200 ms, and a +100 c move at 1.0 s still earned a hit at 1.3 s.
14. **Hit.** In tune for **800 ms** without a break (bridged gaps count), **and** the median of those 800 ms is within the band (≤ 30 c). The second condition is the accuracy guarantee: a hit means the centre of the held note was within 30 c, the same standard as the try's "good" credit at difficulties 1 to 3.
15. **Words.** The state line follows the in-tune state: "Hold it…" while in tune; "A little low" or "A little high" from the sign of the drawn needle otherwise.

### 3.2 Presets

| Parameter | Steady | Balanced | Quick | Same for all |
| --- | --- | --- | --- | --- |
| `centreMs`, the median window when held | 300 | 200 | 60 | |
| `tauMs`, the smoother | 150 | 80 | 30 | |
| `judgeMs`, the in-tune median | 400 | 300 | 200 | |
| `detentC` | 4 | 3 | 1 | |
| gate -65 dBFS, tail 12 dB / 500 ms, hold 120 ms, hide 600 ms, show after 60 ms, jump 300 c / 220 ms, snap 80 c / 100 ms, hysteresis ±5 c, enter 100 ms, leave 150 ms, fast exit 2 × band / 60 ms, hit 800 ms with median ≤ band, minimum centre window 40 ms | | | | ✓ |

Why each window:

- Steady's 300 ms median covers a full cycle of his median 3.3 Hz wobble, and 400 ms judging covers a cycle down to 2.5 Hz.
- Balanced's 200 ms covers a cycle at 5 Hz, which is a trained vibrato and the faster half of his notes.
- Quick's 60 ms median is about one window of the analyser. It shows the wobble, as today, but keeps the glitch guard, the tail gate and the steady words.

### 3.3 Results

Two simulations were run:

- **Synthetic:** clean signals at 8 ms frames.
- **His voice:** the 21 notes of the two audio exports, as sung, and as 3 s holds. A hold is his real onset followed by his real held part, reflected end-to-end to 3 s, which keeps his own wobble and drift. Measured from 0.8 s to 3.0 s.

"Current" is the exact production chain, with the 100 ms CSS ease rendered at 60 fps.

**Movement during a hold** (3 s holds at his own centre, hits disabled so the needle keeps moving):

| | Fast movement, faster than about 1.5 Hz (c RMS, median / p90) | Visible reversals of 3 c or more per s (median / p90) | Words change per s (median / p90) |
| --- | --- | --- | --- |
| His raw pitch | 20.0 / 34.1 | 9.5 | — |
| Current | 11.8 / 18.2 | 5.9 / 9.5 | 2.7 / 8.6 |
| Steady | **2.4 / 5.5** | 1.8 / 3.2 | **0 / 0** |
| Balanced | **5.1 / 11.6** | 2.7 / 5.0 | **0 / 0** |
| Quick | 16.0 / 19.5 | 7.7 / 9.5 | 0 / 2.7 |

On the real notes as sung (not the holds), the words changed 3.9 times a second (median) and 9.9 (p90) on the current screen. Slow drift is kept on purpose: with a -40 c drift over 1 s, the needle reaches -37 c (Steady) and -38 c (Balanced).

**Latency** (ms):

| Case | Current | Steady | Balanced | Quick |
| --- | --- | --- | --- | --- |
| Clean onset, on pitch: needle first shown | 167 | 64 | 64 | 64 |
| +100 c correction mid-note: within 10 c for 200 ms | 67 | 232 | 136 | 40 |
| New note, 300 c step: within 10 c | 200 | 248 | 200 | 128 |
| Scoop from -200 c over 250 ms: within 10 c for 200 ms | 333 | 560 | 456 | 304 |
| His real notes: within 10 c of his settled pitch for 200 ms (median / p90) | 604 / 957, never on 6 of 21 notes | 456 / 976, never on 4 of 21 | 484 / 838, never on 1 of 21 | 508 / 851, never on 11 of 21 |
| Clean onset: time to hit | 984 | 1304 | 1208 | 1104 |
| His 3 s holds at his centre: time to hit (median) | 1260 (only 9 of 21 hit) | 1300 | 1204 | 1244 |

The price of Steady and Balanced is 100 to 200 ms more to settle after a scoop and 120 to 320 ms more to a clean hit. In exchange, his real notes settle earlier than today, because today's needle never stops moving.

**Honesty: does it sit still when he is truly off?** On the 3 s holds, the target was moved so that his true centre sits at a known offset:

| His true offset | Current: shown in tune, hits of 21 | Steady | Balanced | Quick |
| --- | --- | --- | --- | --- |
| 0 c | 83%, 9 | 100%, 21 | 100%, 21 | 95%, 19 |
| ±10 c | 78 to 80%, 4 to 9 | 99%, 21 | 96 to 99%, 20 to 21 | 95 to 98%, 20 |
| ±20 c | 66 to 69%, 3 to 5 | 87 to 97%, 18 to 21 | 90 to 96%, 18 to 20 | 89 to 91%, 15 to 18 |
| ±25 c | 55 to 60%, 0 to 2 | 62 to 74%, 13 to 15 | 63 to 82%, 11 to 16 | 75 to 86%, 12 to 16 |
| ±35 c | 33 to 39%, 0 | 17 to 26%, 3 to 4 | 23 to 33%, 3 to 5 | 20 to 43%, 2 to 7 |
| ±45 c | 17 to 20%, 0 | 2 to 3%, 0 | 3 to 5%, 0 to 1 | 4 to 9%, 0 to 1 |
| ±60 c | 5 to 6%, 0 | 0%, 0 | 0%, 0 | 0 to 1%, 0 |

The few hits at ±35 c and the one at +45 c come from his own drift: inside those notes, an 800 ms stretch really had its median within 30 c. Measured against a local truth instead (a centred 400 ms median of his pitch), pooled over target offsets from -60 to +60 c in 5 c steps:

| | Shown in tune while truly more than 40 c off | Not shown in tune while truly within 20 c |
| --- | --- | --- |
| Current | 14.3% | 23.3% |
| Steady | 3.3% | 3.3% |
| Balanced | 4.3% | 4.1% |
| Quick | 5.0% | 5.1% |

**Glitches on try 1** (24 ms frames): during both real glitches, 11.6 and 14.7 semitones down, the proposed needle did not move (it held at -50 and -4 c), and the state did not change.

### 3.4 What changes what

| Recommendation | Changes the display | Changes the in-tune decision or hit on Match a note | Changes grading of tries |
| --- | --- | --- | --- |
| Gate, tail gate, dropout hold, show delay, glitch guard, centre median, smoother, snap, detent, shorter CSS ease | Yes | No | No |
| Judge median, symmetric hysteresis, fast exit | Yes (the words) | Yes: from "every 40 ms mean within 30 c" to "the centre within 30 c" | No |
| Hit = 800 ms in tune and 800 ms median ≤ band | — | Yes, and it is the accuracy guarantee | No |
| Band of 30 c (voice) / 25 c (instruments) | — | Unchanged | Unchanged |
| The setting (section 4) | Yes | Only the window lengths (200 to 400 ms). The band and the hit test are the same in all presets | No; it is never passed to the try |

Is the hit rule relaxed? Against the old rule, yes: a note centred at -10 c with a ±40 c wobble now counts, and before it did not. Against the standard the app grades by (the try's steady median against 30 c), no: it is now the same standard. A note centred 45 c or more off is still never a hit, and the "shown in tune while off" rate falls from 14% to 3 to 5%.

## 4. The setting

**Settings › Display › "Pitch needle": Steady · Balanced · Quick**

Hint text: *"How the needle in Match a note moves. Steady calms the natural wobble in your voice and shows where your note sits. Quick shows every movement. This does not change how notes are judged."*

| Step | In words | Parameters |
| --- | --- | --- |
| Steady | The needle shows the middle of your note and moves calmly. | Section 3.2, Steady column |
| Balanced | Calm, but quicker to follow you. | Balanced column |
| Quick | Shows every wobble as it happens. | Quick column |

- **Default:** Steady for every voice; Balanced for every instrument. An instrument held with a bow or a breath is steadier than an untrained voice, and its players expect a quicker needle. A string or wind player with a real vibrato (5 to 7 Hz) is already well served by Balanced's 200 ms window.
- **Storage:** `display.pitchSteadiness?: 'steady' | 'balanced' | 'quick'`. Absent means "by instrument family", so an older record reads as the default. It travels in exports, like `display.noteColours`.
- **Where it also appears:** on the Match a note screen and the onboarding step, as a quiet link under the meter: "Needle moving too much? Make it steadier", which opens the same three choices. That answers the owner's request where he had it.
- **Name:** "Pitch needle", not "wave tolerance". "Tolerance" suggests the judging is looser, and it is not.

### 4.1 A separate "how close counts as in tune" control?

Recommendation: **no, not in this build.**

- For a beginner the band is already the teacher's figure (30 c), and the reason he could not hit was the wobble rule, not the band.
- Two controls that both sound like "more forgiving" would be confused.
- Difficulty already sets the try's tolerances, by the lead musician's table.

If the owner wants one later, it should be practice-only, on Match a note only, with three steps derived from the grading table. Relaxed would be the red value (45 c), Normal the current good value (30 c), Strict the difficulty 7 to 10 good value (20 c). It should be labelled "Match a note only".

It may **not** apply to ranked tries. That would conflict with:

- R2 (the lead musician's grading model is the only one);
- the difficulty bands in `grading.intonation.bands` and the floor check;
- R11 (live feedback may not be weakened);
- the comparability of rank and XP between players (R5).

If the owner wants it on tries, it would need a new ruling that makes such a try practice (unranked), like R59's `listened-first`.

No ruling is changed by this spec as written. One spec point changes: 01-ux §3.1's hit rule ("in the band 800 ms in a row"), now read as the centre in the band for 800 ms. That belongs to the UX owner and is flagged here, and a new PLAN entry should record it (proposed R74, section 8).

## 5. The setup pitch step: skippable? What is it for?

It is already skippable ("Skip" in the step header). Keep it skippable.

What it is for, musically:

1. **A microphone check for this voice.** The laptop mic rolls off below about 200 Hz, and a baritone's notes are 98 to 196 Hz. This is the one place the app confirms it can follow his low notes before the first try.
2. **Pitch matching.** Hearing a note and singing it back is the skill under all sight-singing. If he cannot match a single note, a try's red marks mean "cannot match yet", not "cannot read". The step tells both of them which it is.
3. **Range.** The step offers the next voice up when his notes sit above the voice's range.
4. **The rules and the vocabulary:** an octave lower counts; low means go up; what "in tune" looks like.

If it is skipped, the app loses nothing stored: the step records nothing, and Match a note is on Practice permanently. It loses the early warning that the mic cannot hear him (he would find out in the first try, from confusing marks), the voice-range offer, and the first lesson in what the needle means.

Change: show **Continue** once a steady voice has been heard for 1 s, hit or not. After a hit, keep today's line ("We heard you clearly. You're ready."). Without one, say: *"We can hear you. Matching notes gets easier with practice: try Match a note on Practice any time."* A beginner should not have to press "Skip", which reads as failing, to get past a warm-up.

## 6. What a voice teacher would also change

1. **Words before numbers.** Keep "A little low. Go up." Change the "You" line:
   - name the **target** when within 50 c ("You: E3, a little low"), not the nearest note. Today a singer 45 c flat of E3 can read "You: E♭3, 45 cents low", which names a different note and a deviation from the target in one line;
   - show cents only when `display.showCentsMs` is on, rounded to 5 c, and updated at most 4 times a second;
   - add "much too low" past 50 c, before the 3-semitone "Higher. Try E3".
2. **Show the wobble as width, judge the middle.** Behind the needle, draw a faint bar from the 10th to the 90th percentile of the last 400 ms. A singer sees that the voice wavers (honest) and where its middle is (calm). It is the visual answer to "wave tolerance", and it shrinks as his breath support improves, which is real progress he can see.
3. **The settled note on the staff.** After a hit, or when he stops, draw the note he settled on as a grey head beside the target (the heard-note style of R69 and R71), with "You sang: E♭3, a little high". Draw it once per attempt, never per frame.
4. **Name the scoop, gently.** If three notes in a round start more than 100 c low for more than 200 ms, the summary may add: "You tend to slide up into the note. Try to start right on it." This is the most common first correction a teacher gives, and the app already measures it.
5. **Show drift.** Leave slow drift visible in every preset. A steady flat sag is what a beginner most needs to learn to hear.
6. **Hide a dead needle.** Hide the needle after 600 ms of silence, instead of leaving it at its last place until "Not heard" at 6 s.
7. **Never red.** Keep it as now (the meter is a warm-up). Keep green only for the band.

## 7. Test cases

Frames are 8 ms apart at -35 dBFS unless stated, voice, target E3 (52), band 30 c. "c" is cents against the target. Each test runs on Steady (S), Balanced (B) and Quick (Q) unless marked. The expected values come from the reference simulation, and the timing tolerance is ±1 frame of the 20 ms post grid.

| # | Input | Expected |
| --- | --- | --- |
| T1 | 0 c from t = 0 for 3 s | Needle hidden before 60 ms, then 0 ± 1 c. In tune from age = `judgeMs` + 100 ms (S 500, B 400, Q 300 ms). Hit at S 1304, B 1208, Q 1104 ms (± 24 ms) |
| T2 | 40 c × sin(2π·5.5 t) | S and B: needle within ±3 c after 0.6 s; in tune the whole time from entry; hit. Q: needle swings about ±26 c, words stay "Hold it…". **Regression:** the current reducer never hits |
| T3 | Irregular wobble: amplitude 30 c, rate 3 ± 0.8 Hz modulated at 0.4 Hz | S: needle within ±10 c; B: within ±25 c; in tune and a hit on all three |
| T4 | -45 c + 40 c × sin(2π·4 t) | Never in tune, never a hit, on all three. S and B: needle between -50 and -39 c |
| T5 | -38 c + 25 c × sin(2π·4 t) | Never in tune, never a hit (entry needs ≤ 25 c) |
| T6 | -20 c + 45 c × sin(2π·3 t) | S and B: in tune and a hit (a wide wobble on the note counts). S: needle steady at -19 ± 2 c |
| T7a | 0 c, with -1160 c for 160 ms from 1.5 s | Needle unchanged (±1 c), state unchanged, hit timer not reset. The fold trap: the glitch must not read as +40 c |
| T7b | As T7a with -1470 c for 190 ms, including two 16 ms dropouts | As T7a |
| T7c | 0 c, then +500 c from 1.5 s, held | Held until 1.72 s (220 ms), then the needle follows; in-tune state reset |
| T8a | 0 c with a 100 ms dropout at 1.5 s | Needle and state held, hit timer continues |
| T8b | 300 ms dropout | Needle dimmed at its last place; state and hit timer reset; resumes on return |
| T8c | 700 ms dropout | Needle hidden after 600 ms |
| T9 | 0 c; in the last 300 ms the pitch falls 250 c while the level falls 25 dB | S: the needle does not move; B: within 8 c. (Q may follow.) |
| T10 | 0 c, then +100 c from 1.0 s | In tune left by 1.06 to 1.10 s (fast exit). No hit, because the hit would have completed at 1.3 s with the note already moved |
| T11 | 0 c until 0.5 s, then a linear drift to -40 c at 1.5 s, held | Needle reaches -37 c (S) / -38 c (B). In tune left within 500 ms of the truth crossing -35 c |
| T12 | Scoop: -200 c rising linearly to 0 c over 250 ms, then 0 c | The needle shows the rise. Within 10 c by S 560, B 456, Q 304 ms. Not in tune before age = `judgeMs` |
| T13 | Exactly -1200 c, held | Needle 0, phase "octave lower", hit (as now, R7) |
| T14 | Instrument (no fold), +1200 c with a clean tone | "Wrong octave" as now, never a hit |
| T15 | Any try with each preset | Identical `DspConfig`, `FollowConfig`, follower events and grade: the setting is not an input to the try |
| T16 | `fixtures/real-voice/` traces (anonymised, already in the repo): every held note of at least 0.8 s, target moved to its own median ± δ | Balanced: δ = 0 hits on at least 90% of notes; δ = ±45 c gives no hit except where the note's own 800 ms median is within 30 c; words change at most once a second in a hold |

T1 to T14 test the filter (`src/dsp`) and the reducer (`src/app/screens/match`) separately. The filter tests assert the posted `settledMidi`, `judgeMidi` and `holdMidi`. The reducer tests assert the needle, the phase and the hit from those values.

## 8. Build list

1. `src/dsp/pitch-steadiness.ts` (new, pure; `dsp` imports only `core`): steps 1 to 10 and 12 of section 3.1, with `STEADINESS_PRESETS`. It outputs every 20 ms: `settledMidi` (unfolded), `judgeMidi` (null until a full window), `holdMidi` (the 800 ms median), `voicedMs`, `gap: 'none' | 'bridged' | 'dim' | 'hidden'`, and `centreMidi` for the fast exit. Tests: `src/dsp/pitch-steadiness.test.ts`, T1 to T13 filter side.
2. `src/core/platform.ts`: `PitchModeConfig.steadiness`, which replaces `smoothSec` and keeps the `steady` flag for "Not heard"; `PitchModeFrame` gains the fields above.
3. `src/platform/web/audio/dsp-worker-core.ts`: `PitchModeTracker` runs the filter per analyser frame and posts every 20 ms. Extend its existing tests.
4. `src/session/match-note.ts`: the preset by family and setting goes into `pitchModeConfigFor`; `MatchFrame` gets the new fields; extend `match-note.test.ts`.
5. `src/app/screens/match/model.ts`: the needle from `settledMidi`, folded, with the detent; in-tune from `judgeMidi` with symmetric ±5 c hysteresis, 100 and 150 ms dwells, and the fast exit at 2 × band for 60 ms; hit when in tune for 800 ms and |hold median| ≤ band; bridged gaps keep the hit timer; hide the needle on `hidden`. Tests: `model.test.ts` (reducer side of T1 to T14, plus T16).
6. `src/app/screens/match/view.ts`, `Needle.tsx`, `match.css`, `MatchPanel.tsx`:
   - the "You" line names the target within 50 c, rounds to 5 c, shows cents only with `showCentsMs`, and updates at most 4 Hz;
   - the needle transition becomes 40 ms linear;
   - optional wobble-width bar (section 6.2);
   - the "Make it steadier" link.
7. Settings:
   - `src/core/types.ts`: `display.pitchSteadiness?`;
   - `src/store/defaults.ts`, `src/store/settings-read.ts`: absent means by family;
   - `schemas/app-settings.schema.json`;
   - `src/app/screens/settings/sections.tsx`: Display row, a segmented control;
   - `src/ui/copy/en.json`: the label, the three options, the hint, the link;
   - `src/app/compose/app-services.ts`: pass the setting to `MatchNoteService`;
   - `settings.test.tsx`.
8. `src/app/screens/onboarding/MatchStep.tsx` and `flow.ts`: Continue after 1 s of steady voice, the no-hit line, and onboarding tests.
9. `fixtures/real-voice/real-voice.test.ts` or a new test beside the reducer: T16 on the existing anonymised traces. Do not add audio.
10. `e2e/`, for the e2e owner: a Match a note run with the fake backend singing an untrained held note (`src/testkit/untrained/voice.ts` can draw one). It reaches a hit on Steady and does not hit at -45 c.
11. `docs/PLAN.md`: a proposed ruling, R74 ("The pitch needle has a steadiness setting, Steady / Balanced / Quick, display only. Match a note judges the centre of the held note within the difficulty 1 band. Tries are unchanged."), for the owner to confirm. Also amend 01-ux §3.1's hit rule.

## 9. Open questions

1. **Default for voices: Steady or Balanced?** Recommendation: Steady. It is the calmest on his voice (2.4 c fast movement, words never flicker), and its cost is about 100 ms more to settle after a scoop than Balanced.
2. **The wobble-width bar (section 6.2):** build it now or later? Recommendation: now, on Steady and Balanced only. It is what makes calm honest.
3. **Should Match a note's band follow the player's difficulty** (25 c at 4 to 6, 20 c at 7 to 10) instead of always difficulty 1? Recommendation: keep difficulty 1 for the onboarding step. On Practice › Match a note, follow the current difficulty, so the warm-up matches the tries.
4. **A practice-only "how close counts" control:** recommendation, not now (section 4.1).
5. **Real long holds:** the wobble figures come from melody notes of about 0.8 s. One export of Match a note with audio, holding three notes for 3 s each, would confirm the drift figures and the Steady windows. Diagnostics export does not cover Match a note today; adding a trace there would be a small, separate task.
