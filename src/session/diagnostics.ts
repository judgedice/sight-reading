/**
 * Diagnostics per try (round 2 detection, docs/redesign/round2/03-detection.md).
 *
 * At the end of every try the session keeps a compact trace, so a reported problem ("it heard one note as three") can
 * be exported, replayed (`tools/diagnostics/replay.ts`) and turned into a test:
 * - settings, excerpt, device and route, the calibration used and the count-in recheck;
 * - the DSP and follow configs as the worker got them (without the shared `Configs`, which the replay loads);
 * - the app's own playback: the voice reference tones, the count-in and the take's clicks;
 * - pitch, clarity and level per analysis frame decimated to about 50 Hz (from the worker);
 * - every detected note with its onset, offset and kind, and whether the follower ignored it (before the music or one
 *   of the app's own tones);
 * - the follower events as they arrived (clock and level events left out), stamped with the session clock;
 * - the final verdicts (judgments, extras, displaced runs), the score and the measurement gate results.
 * No audio by default. With the opt-in "include microphone audio" setting (device-local, off by default) the try's
 * analysed low band (16 kHz mono, as the detector hears it) is kept too, as 16-bit PCM in base64. This is the one
 * exception to the no-stored-audio rule (PLAN 9): local, explicit, never automatic, and only for the export.
 *
 * Storage: device-local `kv` keys under `diag:` (never in the backup export, kept on import): the traces of the last
 * DIAG_KEEP tries, with audio on at most the last DIAG_AUDIO_KEEP of them. A trace without audio is about 50 to
 * 150 KB of JSON for a 30 s try.
 */
import type { AudioRouteInfo, ClickSpec, KeyValue, WorkerTrace } from '../core/platform.ts';
import type {
  AttemptRecord,
  Calibration,
  DetectedNote,
  DspConfig,
  ExpectedNote,
  FollowConfig,
  FollowerEvent,
  JsonValue,
  OwnSound,
  ResolvedTolerance,
} from '../core/types.ts';

export const DIAG_KEEP = 20;
export const DIAG_AUDIO_KEEP = 5;
export const KV_DIAG_PREFIX = 'diag:';
export const KV_DIAG_INDEX = 'diag:index';
export const KV_DIAG_SETTINGS = 'diag:settings';
const tryKey = (attemptId: string): string => `diag:try:${attemptId}`;

export const TRACE_FORMAT = 'sightread-try-trace';
export const DIAGNOSTICS_FORMAT = 'sightread-diagnostics';

/** The device-local diagnostics setting. */
export interface DiagnosticsSettings {
  /** Keep the try's microphone audio (16 kHz mono) for the export. Off by default. */
  includeAudio: boolean;
}

/** `FollowConfig` without the shared configs and the instrument object (the replay rebuilds both). */
export type TracedFollowConfig = Omit<FollowConfig, 'cfg' | 'instrument'> & { instrumentId: string };
/** `DspConfig` with the click template as plain numbers. */
export type TracedDspConfig = Omit<DspConfig, 'clickTemplate'> & { clickTemplate: number[] | null };

/** One try's trace. Plain JSON. */
export interface TryTrace {
  format: typeof TRACE_FORMAT;
  version: 1;
  attemptId: string;
  createdAt: string;
  /** Wall time the try started (Start playing), ISO 8601 UTC; absent on traces from before round 2. */
  startedAt?: string;
  appVersion: string;
  configVersion: string;
  coreVersion: string;
  excerpt: { excerptId: string; instrumentId: string; level: number; bpm: number; writtenKey: string; concertKey: string; clef: string };
  settings: AttemptRecord['settingsResolved'];
  endReason: AttemptRecord['endReason'];
  voidReason: string | null;
  device: { route: AudioRouteInfo; audioEnv: AttemptRecord['audioEnv'] };
  calibration: { used: Omit<Calibration, 'templates'> | null; record: AttemptRecord['calibration'] };
  configs: { dsp: TracedDspConfig | null; follow: TracedFollowConfig | null };
  /** The app's own sounds (output clock): reference tones, count-in clicks, and how many take clicks followed. */
  playback: { t0: number; reference: OwnSound[]; countIn: { t: number; accent: boolean }[]; takeClicks: number };
  frames: WorkerTrace['frames'] | null;
  detected: (DetectedNote & { ignored: boolean })[];
  /** Follower events with the session clock when they arrived. */
  events: { at: number; event: FollowerEvent }[];
  verdicts: {
    judgments: AttemptRecord['judgments'];
    extras: AttemptRecord['extras'];
    displaced: AttemptRecord['displaced'];
    score: { score: number; grade: string; ranked: boolean; rankedReasons: string[]; patterns: string[] } | null;
  };
  gates: { gateFailures: string[]; droppedBlocks: number; maxQueueMs: number };
  /** Only with `includeAudio`: the analysed low band, 16-bit PCM little-endian in base64. */
  audio?: { rate: number; startT: number; encoding: 'pcm16le-base64'; samples: number; data: string };
}

/** The exported file: one or more traces. */
export interface DiagnosticsFile {
  format: typeof DIAGNOSTICS_FORMAT;
  version: 1;
  exportedAt: string;
  tries: TryTrace[];
}

const r = (x: number, d = 4): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

/** What the session hands over at the end of a try. */
export interface TraceInput {
  record: AttemptRecord;
  /** Wall time the try started, ISO 8601 UTC. */
  startedAt?: string;
  route: AudioRouteInfo;
  used: Calibration | null;
  dsp: DspConfig | null;
  follow: FollowConfig | null;
  t0: number;
  reference: readonly OwnSound[];
  clicks: readonly ClickSpec[];
  worker: WorkerTrace | null;
  events: readonly { at: number; event: FollowerEvent }[];
  ignored: (d: DetectedNote) => boolean;
}

/** Builds a try's trace (no audio unless the worker kept it). */
export function buildTryTrace(x: TraceInput): TryTrace {
  const rec = x.record;
  const { templates: _t, ...used } = x.used ?? ({ templates: {} } as unknown as Calibration);
  const follow: TracedFollowConfig | null = x.follow
    ? (() => {
        const { cfg: _c, instrument, ...rest } = x.follow as FollowConfig;
        return { ...rest, instrumentId: instrument.id };
      })()
    : null;
  const dsp: TracedDspConfig | null = x.dsp ? { ...x.dsp, clickTemplate: x.dsp.clickTemplate ? Array.from(x.dsp.clickTemplate, (v) => r(v, 6)) : null } : null;
  const countIn = x.clicks.filter((k) => k.countIn).map((k) => ({ t: r(k.t as number), accent: k.accent }));
  const detected = (x.worker?.detected ?? rec.detected).map((d) => ({ ...d, ignored: x.ignored(d) }));
  const trace: TryTrace = {
    format: TRACE_FORMAT,
    version: 1,
    attemptId: rec.id,
    createdAt: rec.createdAt,
    ...(x.startedAt !== undefined ? { startedAt: x.startedAt } : {}),
    appVersion: rec.appVersion,
    configVersion: rec.configVersion,
    coreVersion: rec.coreVersion,
    excerpt: { excerptId: rec.excerptId, instrumentId: rec.instrumentId, level: rec.levelServed, bpm: rec.bpm, writtenKey: JSON.stringify(rec.writtenKey), concertKey: JSON.stringify(rec.concertKey), clef: rec.clef },
    settings: rec.settingsResolved,
    endReason: rec.endReason,
    voidReason: rec.voidReason ?? null,
    device: { route: x.route, audioEnv: rec.audioEnv },
    calibration: { used: x.used ? (used as Omit<Calibration, 'templates'>) : null, record: rec.calibration },
    configs: { dsp, follow },
    playback: { t0: r(x.t0), reference: x.reference.map((o) => ({ ...o, t: r(o.t as number) as OwnSound['t'] })), countIn, takeClicks: x.clicks.length - countIn.length },
    frames: x.worker?.frames ?? null,
    detected,
    events: x.events.filter((e) => e.event.type !== 'clock' && e.event.type !== 'level').map((e) => ({ at: r(e.at), event: e.event })),
    verdicts: {
      judgments: rec.judgments,
      extras: rec.extras,
      displaced: rec.displaced,
      score: rec.score ? { score: rec.score.score, grade: rec.score.grade, ranked: rec.score.ranked, rankedReasons: [...rec.score.rankedReasons], patterns: rec.score.patterns.map((p) => p.id) } : null,
    },
    gates: { gateFailures: [...rec.audioEnv.gateFailures], droppedBlocks: rec.audioEnv.droppedBlocks, maxQueueMs: rec.audioEnv.maxQueueMs },
  };
  const a = x.worker?.audio;
  if (a) trace.audio = { rate: a.rate, startT: r(a.startT, 6), encoding: 'pcm16le-base64', samples: a.samples.length, data: encodePcm16(a.samples) };
  return trace;
}

// ---- audio encoding ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Float samples (-1..1) as 16-bit little-endian PCM in base64 (no DOM or Node APIs: pure packages run bare). */
export function encodePcm16(x: Float32Array): string {
  const bytes = new Uint8Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round((x[i] as number) * 32767)));
    bytes[2 * i] = v & 0xff;
    bytes[2 * i + 1] = (v >> 8) & 0xff;
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] as string;
    out += B64[(n >> 12) & 63] as string;
    out += i + 1 < bytes.length ? (B64[(n >> 6) & 63] as string) : '=';
    out += i + 2 < bytes.length ? (B64[n & 63] as string) : '=';
  }
  return out;
}

/** Inverse of `encodePcm16`. */
export function decodePcm16(s: string, samples: number): Float32Array {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) lut[B64.charCodeAt(i)] = i;
  const bytes = new Uint8Array(samples * 2);
  let k = 0;
  for (let i = 0; i + 3 < s.length + 1 && k < bytes.length; i += 4) {
    const q = [0, 1, 2, 3].map((j) => (i + j < s.length && s[i + j] !== '=' ? (lut[s.charCodeAt(i + j)] as number) : 0));
    const n = ((q[0] as number) << 18) | ((q[1] as number) << 12) | ((q[2] as number) << 6) | (q[3] as number);
    if (k < bytes.length) bytes[k++] = (n >> 16) & 0xff;
    if (k < bytes.length) bytes[k++] = (n >> 8) & 0xff;
    if (k < bytes.length) bytes[k++] = n & 0xff;
  }
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    let v = (bytes[2 * i] as number) | ((bytes[2 * i + 1] as number) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 32767;
  }
  return out;
}

// ---- storage ----------------------------------------------------------------------------------

/** The last DIAG_KEEP traces in device-local kv (newest last in the index). */
export class DiagnosticsStore {
  constructor(private readonly kv: KeyValue) {}

  async settings(): Promise<DiagnosticsSettings> {
    const v = (await this.kv.get(KV_DIAG_SETTINGS)) as { includeAudio?: unknown } | undefined;
    return { includeAudio: v?.includeAudio === true };
  }

  async setSettings(s: DiagnosticsSettings): Promise<void> {
    await this.kv.set(KV_DIAG_SETTINGS, { includeAudio: s.includeAudio === true });
  }

  /** Attempt ids with a stored trace, oldest first. */
  async ids(): Promise<string[]> {
    const v = await this.kv.get(KV_DIAG_INDEX);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  async put(t: TryTrace): Promise<void> {
    const ids = (await this.ids()).filter((id) => id !== t.attemptId);
    ids.push(t.attemptId);
    while (ids.length > DIAG_KEEP) {
      const gone = ids.shift() as string;
      await this.kv.delete(tryKey(gone));
    }
    await this.kv.set(tryKey(t.attemptId), t as unknown as JsonValue);
    // Audio only on the newest DIAG_AUDIO_KEEP traces.
    for (const id of ids.slice(0, Math.max(0, ids.length - DIAG_AUDIO_KEEP))) {
      const old = (await this.kv.get(tryKey(id))) as unknown as TryTrace | undefined;
      if (old?.audio) {
        const { audio: _a, ...rest } = old;
        await this.kv.set(tryKey(id), rest as unknown as JsonValue);
      }
    }
    await this.kv.set(KV_DIAG_INDEX, ids);
  }

  async get(attemptId: string): Promise<TryTrace | null> {
    const v = (await this.kv.get(tryKey(attemptId))) as unknown as TryTrace | undefined;
    return v && v.format === TRACE_FORMAT ? v : null;
  }

  /** Every stored trace, oldest first. */
  async all(): Promise<TryTrace[]> {
    const out: TryTrace[] = [];
    for (const id of await this.ids()) {
      const t = await this.get(id);
      if (t) out.push(t);
    }
    return out;
  }

  async last(): Promise<TryTrace | null> {
    const ids = await this.ids();
    const id = ids[ids.length - 1];
    return id === undefined ? null : this.get(id);
  }
}

/** The export file for some traces. */
export function diagnosticsFile(tries: readonly TryTrace[], exportedAt: string): DiagnosticsFile {
  return { format: DIAGNOSTICS_FORMAT, version: 1, exportedAt, tries: [...tries] };
}

/**
 * `yyyy-mm-dd-hhmm` of a wall time in local time. `tzOffsetMin` is minutes behind UTC as `Date#getTimezoneOffset`
 * gives it (default: the device's offset at that time).
 */
export function localStamp(iso: string, tzOffsetMin?: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError(`not a time: ${iso}`);
  const off = tzOffsetMin ?? new Date(ms).getTimezoneOffset();
  const d = new Date(ms - off * 60_000);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
}

/** File name for one try's export (01-ux.md §15.4): `sightread-try-{yyyy-mm-dd}-{hhmm}.json`, the try's local start time. */
export function diagnosticsFileName(t: Pick<TryTrace, 'createdAt' | 'startedAt'>, tzOffsetMin?: number): string {
  return `sightread-try-${localStamp(t.startedAt ?? t.createdAt, tzOffsetMin)}.json`;
}

/** File name for the recent tries' export: `sightread-tries-{yyyy-mm-dd}-{hhmm}.json`, the local time of the export. */
export function recentDiagnosticsFileName(exportedAt: string, tzOffsetMin?: number): string {
  return `sightread-tries-${localStamp(exportedAt, tzOffsetMin)}.json`;
}

/** Expected notes and tolerances of a traced follow config (for the replay). */
export function tracedScore(f: TracedFollowConfig): { expected: ExpectedNote[]; tolerances: ResolvedTolerance[] } {
  return { expected: f.expected, tolerances: f.tolerances };
}
