/**
 * Metronome click scheduler (01 §7.6, 05 W9, W10, 06 §9).
 *
 * The clicks are pre-rendered buffers from `src/core/click-sounds.ts` (Classic, Woodblock and Beep, plus the legacy
 * Tick and Wood the calibration and tests use), the same samples the testkit's click bleed renders. Every click of a
 * take is its own AudioBufferSourceNode, started on the audio clock when the take is scheduled; no main-thread timer
 * runs during a take, so a stalled main thread cannot move a click. No oscillator is used here (lint rule, W10).
 *
 * Levels: a plain beat is the offbeat recipe at `clickGain`; an accented beat is the accent recipe at
 * `clickGain + accentDb`, capped at 0.99. With "Accent the first beat" off (`TakeSchedule.accent` false) every beat
 * is the offbeat recipe at 0 dB.
 *
 * On speakers the accented beat of Classic, Woodblock and Beep is the offbeat recipe at `+accentDb` instead
 * (`setOutputMode`): the take removes click bleed with one low-band template per sound (src/dsp/click.ts), and an
 * accent recipe with a different body below 3 kHz leaves a residual that the onset detector reads as notes (with
 * the accent recipe every sound fails the ship gate in metronome-sounds.gate.test.ts on accented beats; with the
 * louder offbeat Classic passes). Headphone modes have no bleed and play the accent recipe. Tick and Wood are
 * unchanged.
 *
 * Calibration clicks are all at `+accentDb` (5 dB by default); for the new sounds they use the offbeat recipe,
 * because the low-band template they build is the plain click's (src/dsp/click.ts).
 */
import type { ClickSpec, ClickTimbre, ClockSeconds, MetronomeSound, OutputMode, TakeSchedule } from '../../../core/platform.ts';
import { renderClick } from '../../../core/click-sounds.ts';

export { renderClick };

/** Minimum lead from now to the first count-in click, seconds (01 §7.1). */
export const MIN_LEAD_SEC = 0.5;

/** Accent over a plain click on calibration clicks, dB (01 §7.6; the DSP's nominal accent gain). */
export const CALIBRATION_ACCENT_DB = 5;

/**
 * The clicks of a take (pure). Beat `i` sounds at `firstClick + i × beat`; count-in beats come first; accents
 * fall on bar downbeats unless `p.accent` is false. `countInOnly` stops after the count-in. Same rule as
 * `FakeAudioBackend.scheduleTake`.
 */
export function planTakeClicks(p: TakeSchedule, t0: number): ClickSpec[] {
  const accentOn = p.accent ?? true;
  const beatSec = 60 / p.bpm;
  const firstClick = t0 - p.countInBeats * beatSec;
  const total = p.countInBeats + Math.ceil(p.totalBeats);
  const clicks: ClickSpec[] = [];
  for (let i = 0; i < total; i++) {
    const countIn = i < p.countInBeats;
    if (p.mode === 'countInOnly' && !countIn) break;
    clicks.push({ beatIndex: i, accent: accentOn && i % p.beatsPerBar === 0, t: (firstClick + i * beatSec) as ClockSeconds, countIn });
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
  /** Accented beats of the new sounds use the offbeat recipe (speakers, the default) or the accent recipe. */
  private accentRecipeOn = false;
  /** Every click scheduled since construction, in scheduling order (diagnostics and tests). */
  readonly history: { t: number; accent: boolean; timbre: ClickTimbre }[] = [];

  constructor(ctx: ClickContext, out: unknown, opts: MetronomeOptions = {}) {
    this.ctx = ctx;
    this.out = out;
    this.clickGain = opts.clickGain ?? 0.5;
  }

  /**
   * The player's declared output (01 §7.6): on speakers (the default) the new sounds accent by level only; in
   * headphone modes with their accent recipe. Call when the output mode changes; takes scheduled after use it.
   */
  setOutputMode(mode: OutputMode): void {
    this.accentRecipeOn = mode !== 'speakers';
  }

  /** Whether an accented beat of `timbre` plays the accent recipe (else the offbeat recipe at the accent level). */
  accentRecipeFor(timbre: ClickTimbre): boolean {
    return timbre === 'tick' || timbre === 'wood' || this.accentRecipeOn;
  }

  /** Pre-render the buffers of a timbre so scheduling a take only creates source nodes. */
  prepare(timbre: ClickTimbre, accentDb: number): void {
    this.buffer(timbre, false, 0);
    this.buffer(timbre, this.accentRecipeFor(timbre), accentDb);
  }

  /** Schedule every click of a take now (W9). Returns t0 and the click list. */
  scheduleTake(p: TakeSchedule, t0Override?: number): { t0: ClockSeconds; clicks: ClickSpec[] } {
    const t0 = t0Override ?? takeT0(p, this.ctx.currentTime);
    const clicks = planTakeClicks(p, t0);
    this.prepare(p.timbre, p.accentDb);
    const recipe = this.accentRecipeFor(p.timbre);
    for (const c of clicks) this.schedule(c.t, c.accent, p.timbre, c.accent && recipe, c.accent ? p.accentDb : 0);
    return { t0: t0 as ClockSeconds, clicks };
  }

  /**
   * Calibration clicks, all at +`accentDb` over a plain click (recorded as accents). Tick and Wood use their accent
   * burst as before; the new sounds use their offbeat recipe, whose low-band template the take subtracts.
   */
  scheduleClicks(times: readonly number[], timbre: ClickTimbre, accentDb = CALIBRATION_ACCENT_DB): void {
    const legacy = timbre === 'tick' || timbre === 'wood';
    for (const t of times) this.schedule(t, true, timbre, legacy, accentDb);
  }

  /**
   * Previews and lead-ins (`AudioBackend.playClicks`): click i is accented at +`accentDb` when `accents[i]` (with the
   * same recipe rule as a take, so a preview sounds like the take), else the offbeat recipe at 0 dB.
   */
  playClicks(times: readonly number[], sound: MetronomeSound, accents: readonly boolean[], accentDb: number): void {
    const recipe = this.accentRecipeFor(sound);
    times.forEach((t, i) => {
      const a = accents[i] === true;
      this.schedule(t, a, sound, a && recipe, a ? accentDb : 0);
    });
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

  private schedule(t: number, accent: boolean, timbre: ClickTimbre, accentRecipe: boolean, gainDb: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(timbre, accentRecipe, gainDb);
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

  /** The buffer of a recipe (offbeat or accent) at `gainDb` over a plain click, rendered once per key. */
  private buffer(timbre: ClickTimbre, accentRecipe: boolean, gainDb: number): ClickBuffer {
    const key = `${timbre}|${accentRecipe ? 'a' : 'o'}|${gainDb}`;
    let b = this.cache.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate;
      const burst = renderClick(timbre, accentRecipe, sr);
      // Keep the accent below full scale.
      const scale = Math.min(this.clickGain * 10 ** (gainDb / 20), 0.99);
      b = this.ctx.createBuffer(1, burst.length, sr);
      const data = b.getChannelData(0);
      for (let i = 0; i < burst.length; i++) data[i] = (burst[i] as number) * scale;
      this.cache.set(key, b);
    }
    return b;
  }
}
