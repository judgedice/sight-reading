/**
 * What the live follower last showed for each expected note, for `NoteJudgment.rejudged` (01 §9.7: "marks every
 * note whose final state or ghost kind differs from live").
 *
 * Two sources:
 *  - `liveOutcomeOf(events)`: the follower's own event stream (what the session holds at take end);
 *  - `replayLive(c, detected)`: `FollowApi.finalAlign` receives only the detected notes, so it rebuilds the live
 *    view by running the product `LiveFollower` over the DSP events those notes imply. Each note's `note-on` is
 *    posted one pitch confirmation (W/2 + 3 hops, 01 §9.3, §10) after its onset with the note's confirming median,
 *    its `note-off` 3 hops after its offset with its final state, and a clock precedes every event so missed
 *    deadlines fire in time order; the take ends by the R14 rule. The greedy matcher, the displacement detector and the note-off judgment read
 *    only those fields (`provisionalMidi`, onset, clarity at note-on; the full note at note-off), so the replay
 *    reproduces the live judgments of the stream the notes came from. It does not depend on the update cadence.
 */
import type { ClockSeconds, DetectedNote, FollowConfig, FollowerEvent, LiveJudgment, TimingVerdict } from '../core/types.ts';
import { LiveFollower } from './live-follower.ts';

/** The live state of one expected note at take end. */
export interface LiveNoteOutcome {
  status: 'matched' | 'missed';
  detectedId: number | null;
  timing: TimingVerdict | null;
  pitch: LiveJudgment['pitch'];
  marginal: boolean;
}

/** Live outcome per expectedIdx; an expected note the follower never resolved (still pending) is absent. */
export type LiveOutcome = Map<number, LiveNoteOutcome>;

/** Nominal analysis rate (01 §7.2) and hop (01 §5.6), as the live follower uses them. */
const ANALYSIS_RATE = 16000;
const HOP_SAMPLES = 128;
const CONFIRM_HOPS = 3;
const OFF_LAG_HOPS = 3;

/** Last judgment or `missed` per expected note, from a follower event stream. */
export function liveOutcomeOf(events: readonly FollowerEvent[]): LiveOutcome {
  const out: LiveOutcome = new Map();
  for (const ev of events) {
    if (ev.type === 'judgment') {
      const j = ev.judgment;
      out.set(j.expectedIdx, { status: j.status, detectedId: j.detectedId, timing: j.timing, pitch: j.pitch, marginal: j.marginal });
    } else if (ev.type === 'missed') {
      out.set(ev.expectedIdx, { status: 'missed', detectedId: null, timing: null, pitch: null, marginal: false });
    }
  }
  return out;
}

type Ev = { t: number; order: number; seq: number; note: DetectedNote; kind: 'note-on' | 'note-off' };

/** Rebuild the live outcome from the detected notes alone (see the module comment). */
export function replayLive(c: FollowConfig, detected: readonly DetectedNote[]): LiveOutcome {
  const hopSec = HOP_SAMPLES / ANALYSIS_RATE;
  const confirmSec = (c.instrument.detection.windowSamples / 2 + CONFIRM_HOPS * HOP_SAMPLES) / ANALYSIS_RATE;
  const evs: Ev[] = [];
  let seq = 0;
  for (const d of detected) {
    const on = d.onset + confirmSec;
    evs.push({ t: on, order: 1, seq: seq++, note: d, kind: 'note-on' });
    if (d.offset !== null) evs.push({ t: Math.max(d.offset + OFF_LAG_HOPS * hopSec, on + hopSec), order: 0, seq: seq++, note: d, kind: 'note-off' });
  }
  // Time order; at equal times a note-off precedes a note-on (a legato boundary ends one note as the next starts).
  evs.sort((a, b) => a.t - b.t || a.order - b.order || a.seq - b.seq);
  const f = new LiveFollower(c);
  const events: FollowerEvent[] = [];
  let lastT = -Infinity;
  for (const e of evs) {
    lastT = e.t;
    events.push(...f.onClock(e.t as ClockSeconds));
    events.push(...f.onDsp({ type: e.kind, note: e.note }));
  }
  // The take ends by the R14 rule (one beat after the last written note's end) unless notes sound later; a take the
  // player stopped earlier differs only in notes left pending instead of missed, which `rejudged` treats alike.
  const last = c.expected[c.expected.length - 1];
  const endSec = last ? last.onsetSec + last.durSec + (c.cfg.grading.endOfTake.afterLastNoteEndBeats * 60) / c.bpm : 0;
  const endT = Math.max(lastT, c.t0 + c.latencyCompensationSec + endSec);
  events.push(...f.onClock(endT as ClockSeconds), ...f.end(endT as ClockSeconds, { reason: 'complete' }));
  return liveOutcomeOf(events);
}
