/**
 * Predicate subjects and fixture harness helpers (01 §14 items 9 to 11).
 *
 * Follow fixtures (`fixtures/follow/*.json`) are run like this, by P10a/P10b and by the fixture self-test:
 *
 *   const follower = new LiveFollower(followConfigFor(fx, instrument, cfg, resolveTolerances(...)));
 *   const events = runFollowStream(fx.stream, follower);              // onDsp / onClock / end, in stream order
 *   assertPredicates(liveSubject(events, fx.expected.length), fx.expectLive);
 *   const final = finalAlign(config, finalDetected(fx.stream), liveOutcomeOf(events));
 *   assertPredicates(finalSubject(final), fx.expectFinal);
 *
 * Live subject: `{ events, judgments, missed, ghosts, noteStarts, status, ends }`
 *  - `events`: every FollowerEvent in emission order.
 *  - `judgments[i]`: the latest `judgment` event for expectedIdx i, or null if none was emitted (dense, length N).
 *  - `missed`: sorted expectedIdx values from `missed` events.
 *  - `ghosts`: the latest ghost per detectedId, sorted by detectedId.
 *  - `noteStarts`: `note-start` events in order; `status`: status events in order; `ends`: `end` events.
 * Final subject: the FinalAlignment with judgments sorted by expectedIdx.
 * Grade subject: `{ score, patterns, tolerances }` (GradeFixture.expect).
 */
import type {
  AttemptScore,
  DetectedNote,
  DspEvent,
  EndReason,
  ExpectedNote,
  FinalAlignment,
  FollowConfig,
  FollowerEvent,
  FollowFixture,
  FollowStreamItem,
  GhostNote,
  Instrument,
  Configs,
  LiveJudgment,
  PatternResult,
  RenderStreamLine,
  ResolvedTolerance,
  ClockSeconds,
} from '../../core/types.ts';

export interface StreamFollower {
  onDsp(ev: DspEvent): FollowerEvent[];
  onClock(inputT: ClockSeconds): FollowerEvent[];
  end(inputT: ClockSeconds, reason: EndReason): FollowerEvent[];
}

/** Feed a fixture stream to a follower in order and collect its events. */
export function runFollowStream(stream: readonly FollowStreamItem[], f: StreamFollower): FollowerEvent[] {
  const out: FollowerEvent[] = [];
  for (const it of stream) {
    if (it.kind === 'dsp') out.push(...f.onDsp(it.event));
    else if (it.kind === 'clock') out.push(...f.onClock(it.t));
    else out.push(...f.end(it.t, it.end));
  }
  return out;
}

/** The last reported state of every detected note in the stream (what `finalAlign` receives), by id. */
export function finalDetected(stream: readonly FollowStreamItem[]): DetectedNote[] {
  const last = new Map<number, DetectedNote>();
  for (const it of stream) {
    if (it.kind !== 'dsp') continue;
    const ev = it.event;
    if (ev.type === 'note-on' || ev.type === 'note-update' || ev.type === 'note-off') last.set(ev.note.id, ev.note);
  }
  return [...last.values()].sort((a, b) => a.id - b.id);
}

export function followConfigFor(fx: FollowFixture, instrument: Instrument, cfg: Configs, tolerances: ResolvedTolerance[]): FollowConfig {
  return {
    expected: fx.expected,
    tolerances,
    t0: fx.t0,
    latencyCompensationSec: fx.latencyCompensationSec,
    bpm: fx.bpm,
    beatsPerBar: beatsPerBarOf(fx.expected),
    instrument,
    cfg,
    voiceReferenceCents: fx.voiceReferenceCents,
    analysisRate: FIXTURE_ANALYSIS_RATE,
    writtenKey: fx.writtenKey,
  };
}

/** Follow fixture streams are timed at the nominal 16 kHz analysis rate (fixtures/follow/gen/perform.ts). */
export const FIXTURE_ANALYSIS_RATE = 16000;

/** Beats per bar recovered from expected notes (bar 1 starts at beat 0). */
export function beatsPerBarOf(expected: readonly ExpectedNote[]): number {
  for (const e of expected) if (e.bar >= 2) return (e.onsetBeat - (e.beatInBar - 1)) / (e.bar - 1);
  throw new Error('need a note in bar 2 or later to recover beats per bar');
}

export interface LiveSubject {
  events: FollowerEvent[];
  judgments: (LiveJudgment | null)[];
  missed: number[];
  ghosts: GhostNote[];
  noteStarts: Extract<FollowerEvent, { type: 'note-start' }>[];
  status: Extract<FollowerEvent, { type: 'status' }>[];
  ends: Extract<FollowerEvent, { type: 'end' }>[];
}

export function liveSubject(events: readonly FollowerEvent[], nExpected: number): LiveSubject {
  const judgments: (LiveJudgment | null)[] = new Array<LiveJudgment | null>(nExpected).fill(null);
  const missed = new Set<number>();
  const ghosts = new Map<number, GhostNote>();
  const s: LiveSubject = { events: [...events], judgments, missed: [], ghosts: [], noteStarts: [], status: [], ends: [] };
  for (const ev of events) {
    if (ev.type === 'judgment') judgments[ev.judgment.expectedIdx] = ev.judgment;
    else if (ev.type === 'missed') missed.add(ev.expectedIdx);
    else if (ev.type === 'ghost') ghosts.set(ev.ghost.detectedId, ev.ghost);
    else if (ev.type === 'note-start') s.noteStarts.push(ev);
    else if (ev.type === 'status') s.status.push(ev);
    else if (ev.type === 'end') s.ends.push(ev);
  }
  s.missed = [...missed].sort((a, b) => a - b);
  s.ghosts = [...ghosts.values()].sort((a, b) => a.detectedId - b.detectedId);
  return s;
}

export function finalSubject(a: FinalAlignment): FinalAlignment {
  return { ...a, judgments: [...a.judgments].sort((x, y) => x.expectedIdx - y.expectedIdx) };
}

export interface GradeSubject {
  score: AttemptScore;
  patterns: PatternResult[];
  tolerances: ResolvedTolerance[];
}
export const gradeSubject = (score: AttemptScore, patterns: PatternResult[], tolerances: ResolvedTolerance[]): GradeSubject => ({ score, patterns, tolerances });

// ------------------------------------------------------------------------------------------------
// Render streams (01 §14 item 11): reduction and invariants
// ------------------------------------------------------------------------------------------------

export interface OverlayState {
  /** Latest live judgment per expectedIdx. */
  judgments: Map<number, LiveJudgment>;
  missed: Set<number>;
  ghosts: Map<number, GhostNote>;
  status: FollowerEvent[];
  final: FinalAlignment | null;
}

/** Last-write-wins reduction of a follower event stream, keyed as 01 §9.9 promises (expectedIdx, detectedId). */
export function reduceOverlay(events: readonly FollowerEvent[]): OverlayState {
  const st: OverlayState = { judgments: new Map(), missed: new Set(), ghosts: new Map(), status: [], final: null };
  for (const ev of events) {
    if (ev.type === 'judgment') st.judgments.set(ev.judgment.expectedIdx, ev.judgment);
    else if (ev.type === 'missed') st.missed.add(ev.expectedIdx);
    else if (ev.type === 'ghost') st.ghosts.set(ev.ghost.detectedId, ev.ghost);
    else if (ev.type === 'status') st.status.push(ev);
    else if (ev.type === 'final') st.final = ev.alignment;
  }
  return st;
}

/**
 * Structural contract of a render stream or a live event list: returns the violations (empty = ok).
 *  - render lines: a header first, then events with non-decreasing atMs, ending in `end` then `final`;
 *  - per detected note: `note-start` precedes its ghosts and its `note-end`, and appears once;
 *  - per expected note: the timing verdict never changes after the first matched judgment (timing is
 *    final at onset, 02 §4.8); no judgment follows a `missed`; `missed` at most once;
 *  - idempotence: re-sending every judgment and ghost event reduces to the same state;
 *  - the final alignment has one judgment per expected note, and every live-missed note is missed in it unless
 *    the final judgment says `rejudged: true`.
 */
export function streamViolations(lines: readonly RenderStreamLine[] | null, events: readonly FollowerEvent[], nExpected: number): string[] {
  const v: string[] = [];
  if (lines) {
    if (lines[0]?.kind !== 'header') v.push('first line is not the header');
    let prev = -Infinity;
    for (const [k, l] of lines.entries()) {
      if (l.kind !== 'event') {
        if (k > 0) v.push('header after the first line');
        continue;
      }
      if (l.atMs < prev) v.push(`atMs decreases at ${l.atMs}`);
      prev = l.atMs;
    }
    const n = events.length;
    if (events[n - 1]?.type !== 'final') v.push('stream does not end in final');
    if (events[n - 2]?.type !== 'end') v.push('final is not preceded by end');
  }
  const started = new Set<number>();
  const ended = new Set<number>();
  const firstTiming = new Map<number, string>();
  const missed = new Set<number>();
  for (const ev of events) {
    if (ev.type === 'note-start') {
      if (started.has(ev.detectedId)) v.push(`note-start twice for detected ${ev.detectedId}`);
      started.add(ev.detectedId);
    } else if (ev.type === 'note-end') {
      if (!started.has(ev.detectedId)) v.push(`note-end before note-start for detected ${ev.detectedId}`);
      ended.add(ev.detectedId);
    } else if (ev.type === 'ghost') {
      if (!started.has(ev.ghost.detectedId)) v.push(`ghost before note-start for detected ${ev.ghost.detectedId}`);
    } else if (ev.type === 'judgment') {
      const j = ev.judgment;
      if (missed.has(j.expectedIdx)) v.push(`judgment after missed for expected ${j.expectedIdx}`);
      if (j.status === 'matched') {
        const key = String(j.timing);
        const f = firstTiming.get(j.expectedIdx);
        if (f === undefined) firstTiming.set(j.expectedIdx, key);
        else if (f !== key) v.push(`timing changed for expected ${j.expectedIdx}: ${f} -> ${key}`);
      }
    } else if (ev.type === 'missed') {
      if (missed.has(ev.expectedIdx)) v.push(`missed twice for expected ${ev.expectedIdx}`);
      missed.add(ev.expectedIdx);
    }
  }
  const once = reduceOverlay(events);
  const twice = reduceOverlay(events.flatMap((e): FollowerEvent[] => (e.type === 'judgment' || e.type === 'ghost' ? [e, e] : [e])));
  const ser = (s: OverlayState): string => JSON.stringify([[...s.judgments.entries()], [...s.missed].sort(), [...s.ghosts.entries()]]);
  if (ser(once) !== ser(twice)) v.push('re-sending judgment and ghost events changes the reduced state');
  const fin = once.final;
  if (lines && fin) {
    if (fin.judgments.length !== nExpected) v.push(`final has ${fin.judgments.length} judgments, expected ${nExpected}`);
    for (const j of fin.judgments) if (missed.has(j.expectedIdx) && j.status !== 'missed' && !j.rejudged) v.push(`expected ${j.expectedIdx} missed live, matched in final without rejudged`);
  }
  return v;
}
