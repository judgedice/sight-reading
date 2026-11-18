// P20 replay core (01 §13.6): a follower event timeline reduced to the overlay state the notation shows, and an attempt
// record turned back into the same kind of timeline so that the replay can be checked against the stored results.
// Pure: no DOM, no React.
import type { AttemptRecord, FinalAlignment, FollowerEvent, GhostNote, LiveJudgment, NoteJudgment } from '../../../core/types.ts';

/** One follower event with its render-stream time (null for an attempt, which has no timing). */
export interface TimedEvent {
  atMs: number | null;
  event: FollowerEvent;
}

type EndEvent = Extract<FollowerEvent, { type: 'end' }>;

export interface ReplayState {
  /** Latest live judgment per expected note (events are idempotent per expectedIdx). */
  judgments: Map<number, LiveJudgment>;
  missed: Set<number>;
  /** Latest ghost per detected note. */
  ghosts: Map<number, GhostNote>;
  /** Detected notes that have started. */
  started: Set<number>;
  end: EndEvent | null;
  final: FinalAlignment | null;
  /** Events applied. */
  applied: number;
  /** Structural problems in the timeline (empty when it is well formed). */
  problems: string[];
}

/** Reduces the events in order. Re-sending a judgment, ghost or missed event leaves the same state. */
export function replayTimeline(timeline: readonly TimedEvent[]): ReplayState {
  const st: ReplayState = {
    judgments: new Map(),
    missed: new Set(),
    ghosts: new Map(),
    started: new Set(),
    end: null,
    final: null,
    applied: 0,
    problems: [],
  };
  let prevAt = Number.NEGATIVE_INFINITY;
  for (const [i, { atMs, event }] of timeline.entries()) {
    if (atMs !== null) {
      if (atMs < prevAt) st.problems.push(`atMs decreases at event ${i}`);
      prevAt = atMs;
    }
    st.applied += 1;
    switch (event.type) {
      case 'note-start':
        if (st.started.has(event.detectedId)) st.problems.push(`note-start twice for detected ${event.detectedId}`);
        st.started.add(event.detectedId);
        break;
      case 'note-end':
        if (!st.started.has(event.detectedId)) st.problems.push(`note-end before note-start for detected ${event.detectedId}`);
        break;
      case 'ghost':
        if (!st.started.has(event.ghost.detectedId)) st.problems.push(`ghost before note-start for detected ${event.ghost.detectedId}`);
        st.ghosts.set(event.ghost.detectedId, event.ghost);
        break;
      case 'judgment':
        if (st.missed.has(event.judgment.expectedIdx)) st.problems.push(`judgment after missed for expected ${event.judgment.expectedIdx}`);
        st.judgments.set(event.judgment.expectedIdx, event.judgment);
        break;
      case 'missed':
        st.missed.add(event.expectedIdx);
        break;
      case 'end':
        if (st.final) st.problems.push('end after final');
        st.end = event;
        break;
      case 'final':
        if (st.final) st.problems.push('second final');
        st.final = event.alignment;
        break;
      default:
        break;
    }
  }
  const last = timeline.length - 1;
  const finalAt = timeline.findIndex((t) => t.event.type === 'final');
  if (finalAt === -1) st.problems.push('no final event');
  else if (finalAt !== last) st.problems.push('events after final');
  if (st.final && st.end === null) st.problems.push('final without end');
  return st;
}

/** The live form of a stored judgment: the fields a judgment event carries (no credit, not rejudged). */
export function liveOf(j: NoteJudgment): LiveJudgment {
  const live: Record<string, unknown> = { ...j, provisional: false };
  delete live['credit'];
  delete live['rejudged'];
  return live as unknown as LiveJudgment;
}

/**
 * The timeline an attempt record stands for: one judgment or missed event per expected note, the end, and the final
 * alignment exactly as stored. Ghosts are not rebuilt (they need the written spelling of the take's key).
 */
export function attemptTimeline(record: AttemptRecord): TimedEvent[] {
  const events: FollowerEvent[] = [];
  for (const j of record.judgments) {
    if (j.status === 'missed') events.push({ type: 'missed', expectedIdx: j.expectedIdx });
    else events.push({ type: 'judgment', judgment: liveOf(j) });
  }
  events.push(record.voidReason ? { type: 'end', reason: record.endReason, voidReason: record.voidReason } : { type: 'end', reason: record.endReason });
  events.push({ type: 'final', alignment: { judgments: record.judgments, extras: record.extras, displaced: record.displaced } });
  return events.map((event) => ({ atMs: null, event }));
}

/**
 * Replays an attempt export and compares the result with the stored judgments and final alignment. Returns the
 * differences (empty = the replay reproduces the results).
 */
export function checkAttemptReplay(record: AttemptRecord): string[] {
  const st = replayTimeline(attemptTimeline(record));
  const problems = [...st.problems];
  if (st.judgments.size + st.missed.size !== record.judgments.length) {
    problems.push(`replay has ${st.judgments.size + st.missed.size} notes, the record has ${record.judgments.length}`);
  }
  for (const j of record.judgments) {
    if (j.status === 'missed') {
      if (!st.missed.has(j.expectedIdx)) problems.push(`expected ${j.expectedIdx} is not missed in the replay`);
      continue;
    }
    const got = st.judgments.get(j.expectedIdx);
    if (!got) problems.push(`expected ${j.expectedIdx} has no judgment in the replay`);
    else if (JSON.stringify(got) !== JSON.stringify(liveOf(j))) problems.push(`expected ${j.expectedIdx} differs from the stored judgment`);
  }
  const stored = { judgments: record.judgments, extras: record.extras, displaced: record.displaced };
  if (st.final && JSON.stringify(st.final) !== JSON.stringify(stored)) problems.push('final alignment differs from the stored one');
  return problems;
}
