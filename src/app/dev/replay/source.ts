// P20 replay input (01 §13.6): an attempt export (`sightread-export`), a single attempt record, or a render stream
// (`fixtures/render/*.events.jsonl`: a header line, then one `{kind:'event', atMs, event}` per line).
import type { AttemptRecord } from '../../../core/types.ts';
import { attemptTimeline, type TimedEvent } from './reduce.ts';

export class ReplayParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayParseError';
  }
}

export interface RenderHeader {
  excerptId: string;
  instrumentId: string;
  bpm: number;
  level: number;
  description: string;
}

export type ReplaySource =
  | { kind: 'render'; label: string; header: RenderHeader; timeline: TimedEvent[] }
  | { kind: 'attempt'; label: string; record: AttemptRecord; timeline: TimedEvent[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses one file's text into replay sources (an export file gives one source per attempt). Throws ReplayParseError. */
export function parseReplaySource(name: string, text: string): ReplaySource[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) throw new ReplayParseError(`${name} is empty.`);
  let whole: unknown = undefined;
  let wholeOk = false;
  try {
    whole = JSON.parse(text);
    wholeOk = true;
  } catch {
    wholeOk = false;
  }
  if (wholeOk && isObj(whole) && whole['kind'] !== 'header') return fromJson(name, whole);
  return fromJsonl(name, lines);
}

function fromJson(name: string, obj: Obj): ReplaySource[] {
  if (obj['format'] === 'sightread-export') {
    if (obj['version'] !== 1) throw new ReplayParseError(`${name}: unsupported export version ${String(obj['version'])}.`);
    const attempts = obj['attempts'];
    if (!Array.isArray(attempts)) throw new ReplayParseError(`${name}: the export has no attempts list.`);
    return attempts.map((r, i) => attemptSource(`${name} #${i + 1}`, asAttempt(name, r)));
  }
  if (obj['schemaVersion'] === 1 && Array.isArray(obj['judgments']) && Array.isArray(obj['detected'])) {
    return [attemptSource(name, asAttempt(name, obj))];
  }
  throw new ReplayParseError(`${name} is neither an attempt export nor a render stream.`);
}

function asAttempt(name: string, v: unknown): AttemptRecord {
  if (!isObj(v) || typeof v['id'] !== 'string' || !Array.isArray(v['judgments']) || !Array.isArray(v['extras']) || !Array.isArray(v['displaced']) || !Array.isArray(v['detected']) || typeof v['endReason'] !== 'string') {
    throw new ReplayParseError(`${name}: an attempt record is missing its id, detected, judgments, extras, displaced or endReason.`);
  }
  return v as unknown as AttemptRecord;
}

function attemptSource(label: string, record: AttemptRecord): ReplaySource {
  return { kind: 'attempt', label, record, timeline: attemptTimeline(record) };
}

function fromJsonl(name: string, lines: readonly string[]): ReplaySource[] {
  const parsed: unknown[] = lines.map((line, i) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new ReplayParseError(`${name}: line ${i + 1} is not JSON.`);
    }
  });
  const head = parsed[0];
  if (!isObj(head) || head['kind'] !== 'header' || head['schemaVersion'] !== 1) {
    throw new ReplayParseError(`${name}: the first line must be a schemaVersion 1 header.`);
  }
  const header: RenderHeader = {
    excerptId: String(head['excerptId'] ?? ''),
    instrumentId: String(head['instrumentId'] ?? ''),
    bpm: Number(head['bpm'] ?? 0),
    level: Number(head['level'] ?? 0),
    description: String(head['description'] ?? ''),
  };
  const timeline: TimedEvent[] = [];
  for (const [i, line] of parsed.slice(1).entries()) {
    const at = i + 2;
    if (!isObj(line) || line['kind'] !== 'event' || typeof line['atMs'] !== 'number' || !Number.isFinite(line['atMs'])) {
      const isHeader = isObj(line) && line['kind'] === 'header';
      throw new ReplayParseError(isHeader ? `${name}: header on line ${at}.` : `${name}: line ${at} is not a timed event.`);
    }
    const ev = line['event'];
    if (!isObj(ev) || typeof ev['type'] !== 'string') throw new ReplayParseError(`${name}: line ${at} has no event type.`);
    timeline.push({ atMs: line['atMs'], event: ev as unknown as TimedEvent['event'] });
  }
  return [{ kind: 'render', label: name, header, timeline }];
}

/** Where each point sits on the pitch trace: a render stream's detected notes, or an attempt's detected notes. */
export interface PitchPoint {
  id: number;
  x: number;
  midi: number;
}

export function pitchPoints(src: ReplaySource): { points: PitchPoint[]; xLabel: string } {
  if (src.kind === 'attempt') {
    return { xLabel: 'onset (s)', points: src.record.detected.map((d) => ({ id: d.id, x: d.onset, midi: d.midi })) };
  }
  const points: PitchPoint[] = [];
  for (const { event } of src.timeline) {
    if (event.type === 'note-start') points.push({ id: event.detectedId, x: event.scoreBeat, midi: event.provisionalConcertMidi });
  }
  return { xLabel: 'score beat', points };
}
