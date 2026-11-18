// P20 diagnostics export (01 §13.6): settings, detected notes, pitch frames, the event log and the score of one attempt.
// The export is built from a field whitelist, and assertNoAudio rejects any audio-shaped value (typed arrays, buffers,
// audio data URLs, audio-named keys, long number arrays) before the file is produced.
import type { AttemptRecord, AttemptScore, DetectedNote, DisplacedSegment, ExtraNote, NoteJudgment, PitchFrame } from '../../../core/types.ts';
import { attemptTimeline, type TimedEvent } from './reduce.ts';

export const DIAGNOSTICS_FORMAT = 'sightread-diagnostics';

export interface DiagnosticsExport {
  format: typeof DIAGNOSTICS_FORMAT;
  version: 1;
  attemptId: string;
  createdAt: string;
  appVersion: string;
  configVersion: string;
  corpusVersion: string;
  settings: {
    instrumentId: string;
    excerptId: string;
    levelServed: number;
    stretch: boolean;
    placement: boolean;
    bpm: number;
    writtenKey: AttemptRecord['writtenKey'];
    concertKey: AttemptRecord['concertKey'];
    clef: AttemptRecord['clef'];
    transposition: AttemptRecord['transposition'];
    scanSeconds: number;
    listening: boolean;
    settingsResolved: AttemptRecord['settingsResolved'];
    calibration: AttemptRecord['calibration'];
    tuning: AttemptRecord['tuning'];
    audioEnv: AttemptRecord['audioEnv'];
  };
  detected: DetectedNote[];
  judgments: NoteJudgment[];
  extras: ExtraNote[];
  displaced: DisplacedSegment[];
  /** Dev flag data from the attempt, when it was kept (pitch frames only). */
  frames: PitchFrame[];
  score: AttemptScore | null;
  events: TimedEvent[];
}

/**
 * The diagnostics export of one attempt. `events` defaults to the attempt's own timeline; pass a render stream's
 * timeline to export that instead.
 */
export function buildDiagnosticsExport(record: AttemptRecord, events: readonly TimedEvent[] = attemptTimeline(record)): DiagnosticsExport {
  const out: DiagnosticsExport = {
    format: DIAGNOSTICS_FORMAT,
    version: 1,
    attemptId: record.id,
    createdAt: record.createdAt,
    appVersion: record.appVersion,
    configVersion: record.configVersion,
    corpusVersion: record.corpusVersion,
    settings: {
      instrumentId: record.instrumentId,
      excerptId: record.excerptId,
      levelServed: record.levelServed,
      stretch: record.stretch,
      placement: record.placement,
      bpm: record.bpm,
      writtenKey: record.writtenKey,
      concertKey: record.concertKey,
      clef: record.clef,
      transposition: record.transposition,
      scanSeconds: record.scanSeconds,
      listening: record.listening,
      settingsResolved: record.settingsResolved,
      calibration: record.calibration,
      tuning: record.tuning,
      audioEnv: record.audioEnv,
    },
    detected: record.detected,
    judgments: record.judgments,
    extras: record.extras,
    displaced: record.displaced,
    frames: record.debug?.frames ?? [],
    score: record.score,
    events: events.map((e) => ({ atMs: e.atMs, event: e.event })),
  };
  const audio = findAudio(out);
  if (audio.length > 0) throw new Error(`diagnostics export holds audio-shaped data at ${audio.join(', ')}`);
  return out;
}

/** The export as the JSON text the download holds. */
export function diagnosticsJson(record: AttemptRecord, events?: readonly TimedEvent[]): string {
  return JSON.stringify(buildDiagnosticsExport(record, events), null, 2);
}

const AUDIO_KEYS = new Set(['samples', 'pcm', 'wav', 'buffer', 'blob', 'audio', 'audiodata', 'audiobuffer', 'channeldata', 'rawaudio', 'recording']);
const LONG_ARRAY = 2000;

/** Paths of audio-shaped values in `value` (empty = none). */
export function findAudio(value: unknown, path = '$'): string[] {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return [path];
  if (typeof value === 'string') return /^data:audio\//i.test(value) ? [path] : [];
  if (Array.isArray(value)) {
    if (value.length > LONG_ARRAY && value.every((v) => typeof v === 'number')) return [path];
    return value.flatMap((v, i) => findAudio(v, `${path}[${i}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => {
      const here = AUDIO_KEYS.has(k.toLowerCase()) ? [`${path}.${k}`] : [];
      return [...here, ...findAudio(v, `${path}.${k}`)];
    });
  }
  return [];
}
