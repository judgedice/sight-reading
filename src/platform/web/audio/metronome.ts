/**
 * Metronome click scheduler (01 §7.6, 05 W9, W10).
 *
 * Two pre-rendered, noise-based timbres with no tonal content below 1 kHz: Tick (12 ms burst band-limited to
 * 5.5 to 9 kHz, 2 ms attack, exponential decay; accent 18 ms) and Wood (8 ms, 1.5 to 4 kHz). The burst is the
 * same deterministic band-limited noise as the testkit's `clickBurst`, so synthetic bleed matches what the
 * speakers play. Every click of a take is its own AudioBufferSourceNode, started on the audio clock when the take
 * is scheduled; no main-thread timer runs during a take, so a stalled main thread cannot move a click.
 * No oscillator is used here (lint rule, W10).
 */
import type { ClickSpec, ClickTimbre, ClockSeconds, TakeSchedule } from '../../../core/platform.ts';
import { createRng } from '../../../core/rng.ts';

/** Minimum lead from now to the first count-in click, seconds (01 §7.1). */
export const MIN_LEAD_SEC = 0.5;

/** Unscaled click burst, peak-normalised to 1. Bit-identical to the testkit's `clickBurst` below Nyquist. */
export function renderClick(timbre: ClickTimbre, accent: boolean, sampleRate: number): Float32Array {
  const band: [number, number] = timbre === 'tick' ? [5500, 9000] : [1500, 4000];
  const lenSec = timbre === 'tick' ? (accent ? 0.018 : 0.012) : 0.008;
  const attackSec = timbre === 'tick' ? 0.002 : 0.001;
  const n = Math.max(1, Math.round(lenSec * sampleRate));
  const rng = createRng(timbre === 'tick' ? 0x71c4 : 0x300d);
  const nyquistGuard = 0.475 * sampleRate;
  const partials: { w: number; ph: number }[] = [];
  for (let k = 0; k < 40; k++) {
    const f = band[0] + rng.next() * (band[1] - band[0]);
    const ph = rng.next() * 2 * Math.PI;
    // Low capture rates (16 kHz HFP routes) cannot carry the top of the Tick band; drop what would alias.
    if (f < nyquistGuard) partials.push({ w: (2 * Math.PI * f) / sampleRate, ph });
  }
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = (t < attackSec ? t / attackSec : 1) * Math.exp((-5 * t) / lenSec);
    let s = 0;
    for (const p of partials) s += Math.sin(p.w * i + p.ph);
    const v = s * env;
    out[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (out[i] as number) / peak;
  return out;
}

/**
 * The clicks of a take (pure). Beat `i` sounds at `firstClick + i × beat`; count-in beats come first; accents
 * fall on bar downbeats. `countInOnly` stops after the count-in. Same rule as `FakeAudioBackend.scheduleTake`.
 */
export function planTakeClicks(p: TakeSchedule, t0: number): ClickSpec[] {
  const beatSec = 60 / p.bpm;
  const firstClick = t0 - p.countInBeats * beatSec;
  const total = p.countInBeats + Math.ceil(p.totalBeats);
  const clicks: ClickSpec[] = [];
  for (let i = 0; i < total; i++) {
    const countIn = i < p.countInBeats;
    if (p.mode === 'countInOnly' && !countIn) break;
    clicks.push({ beatIndex: i, accent: i % p.beatsPerBar === 0, t: (firstClick + i * beatSec) as ClockSeconds, countIn });
  }
  return clicks;
}

/** `t0` (bar 1 beat 1) for a take scheduled at `now` (01 §7.1): now + max(leadSec, 0.5) + count-in. */
export function takeT0(p: TakeSchedule, now: number): number {
  return now + Math.max(MIN_LEAD_SEC, p.leadSec) + (p.countInBeats * 60) / p.bpm;
}

// ---- Web Audio scheduling -----------------------------------------------------------------------

/** The AudioBuffer surface the metronome uses. */
export interface ClickBuffer {
  getChannelData(channel: number): Float32Array;
}

/** The AudioBufferSourceNode surface the metronome uses. */
export interface ClickSource {
  buffer: ClickBuffer | null;
  connect(dest: unknown): unknown;
  disconnect(): void;
  start(when: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

/** The AudioContext surface the metronome uses. */
export interface ClickContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  createBuffer(channels: number, length: number, sampleRate: number): ClickBuffer;
  createBufferSource(): ClickSource;
}

export interface ScheduledClick {
  t: number;
  accent: boolean;
  timbre: ClickTimbre;
  source: ClickSource;
}

export interface MetronomeOptions {
  /** Linear gain of a normal click (default 0.5, about −6 dBFS peak). */
  clickGain?: number;
}

/** Schedules click buffers on one context's clock. One instance per AudioContext. */
export class Metronome {
  private readonly ctx: ClickContext;
  private readonly out: unknown;
  private readonly clickGain: number;
  private readonly cache = new Map<string, ClickBuffer>();
  private live = new Set<ScheduledClick>();
  /** Every click scheduled since construction, in scheduling order (diagnostics and tests). */
  readonly history: { t: number; accent: boolean; timbre: ClickTimbre }[] = [];

  constructor(ctx: ClickContext, out: unknown, opts: MetronomeOptions = {}) {
    this.ctx = ctx;
    this.out = out;
    this.clickGain = opts.clickGain ?? 0.5;
  }

  /** Pre-render the buffers of a timbre so scheduling a take only creates source nodes. */
  prepare(timbre: ClickTimbre, accentDb: number): void {
    this.buffer(timbre, false, 0);
    this.buffer(timbre, true, accentDb);
  }

  /** Schedule every click of a take now (W9). Returns t0 and the click list. */
  scheduleTake(p: TakeSchedule, t0Override?: number): { t0: ClockSeconds; clicks: ClickSpec[] } {
    const t0 = t0Override ?? takeT0(p, this.ctx.currentTime);
    const clicks = planTakeClicks(p, t0);
    this.prepare(p.timbre, p.accentDb);
    for (const c of clicks) this.schedule(c.t, c.accent, p.timbre, p.accentDb);
    return { t0: t0 as ClockSeconds, clicks };
  }

  /** Calibration clicks: accented clicks at the given times. */
  scheduleClicks(times: readonly number[], timbre: ClickTimbre, accentDb = 5): void {
    this.prepare(timbre, accentDb);
    for (const t of times) this.schedule(t, true, timbre, accentDb);
  }

  /** Stop and drop every click that has not finished. */
  cancel(): void {
    for (const c of this.live) {
      c.source.onended = null;
      try {
        c.source.stop();
      } catch {
        // Already stopped.
      }
      c.source.disconnect();
    }
    this.live.clear();
  }

  /** Clicks still scheduled or sounding. */
  pending(): readonly ScheduledClick[] {
    return [...this.live];
  }

  private schedule(t: number, accent: boolean, timbre: ClickTimbre, accentDb: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(timbre, accent, accentDb);
    src.connect(this.out);
    const entry: ScheduledClick = { t, accent, timbre, source: src };
    src.onended = () => {
      src.disconnect();
      this.live.delete(entry);
    };
    src.start(t);
    this.live.add(entry);
    this.history.push({ t, accent, timbre });
  }

  private buffer(timbre: ClickTimbre, accent: boolean, accentDb: number): ClickBuffer {
    const key = `${timbre}|${accent ? accentDb : 'n'}`;
    let b = this.cache.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate;
      const burst = renderClick(timbre, accent, sr);
      const g = this.clickGain * (accent ? 10 ** (accentDb / 20) : 1);
      // Keep the accent below full scale.
      const scale = Math.min(g, 0.99);
      b = this.ctx.createBuffer(1, burst.length, sr);
      const data = b.getChannelData(0);
      for (let i = 0; i < burst.length; i++) data[i] = (burst[i] as number) * scale;
      this.cache.set(key, b);
    }
    return b;
  }
}
