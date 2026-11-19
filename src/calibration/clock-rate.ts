/**
 * Clock-rate check (01 §7.8, 05 W3 item 2): how fast the audio context's clock runs against wall time. Any output
 * mode; needs no loopback. An error above `clockRateMaxError` (2%; a 44.1/48 kHz mismatch shows as 8.8%) recreates
 * the context once; failing again is the "Audio setup problem; please reload" state.
 *
 * A measurement can also come back empty ("could not measure", `error: null`): the backend found no steady clock or
 * no self-consistent window. That is reported as such and fails nothing (the take gate treats null as not failing),
 * and it never recreates the context.
 *
 * `AudioBackend` has no recreate member, so the caller passes one (`WebAudioBackend` has `checkClockRate()`, which
 * this uses when present, and a private recreate).
 */
import type { AudioBackend } from '../core/platform.ts';
import type { CalibrationBudget } from './loopback.ts';

/** Sampled window, seconds (01 §7.8 named 1.5 s for the old two-reading method; the fitted window is 2 s). */
export const CLOCK_RATE_SEC = 2;

export interface ClockRateResult {
  /** False only for a measured error above the limit, after the one recreate. */
  ok: boolean;
  /** Fractional error of the last measurement (0.088 = 8.8% fast), or null when the clock could not be measured. */
  error: number | null;
  /** The context was recreated once. */
  recreated: boolean;
  /** 'ok', 'recreated-ok', 'unmeasured' (could not measure; not a failure), or 'failed' (show "Audio setup problem; please reload"). */
  state: 'ok' | 'recreated-ok' | 'unmeasured' | 'failed';
  /**
   * Fraction of render quanta whose input was missing or digitally silent while the clock was sampled: input frames
   * lost on the way in (a capture problem, not a clock problem). Null when not known.
   */
  inputDropFraction?: number | null;
}

/** Structural view of `WebAudioBackend.checkClockRate` (src/platform/web/audio), which calibration may not import. */
interface SelfCheckingBackend {
  checkClockRate(durSec?: number): Promise<{ ok: boolean; error: number | null; recreated: boolean; diagnostics?: { inputDropFraction: number | null } }>;
}

const hasSelfCheck = (a: unknown): a is SelfCheckingBackend =>
  typeof (a as { checkClockRate?: unknown }).checkClockRate === 'function';

export async function runClockRateCheck(
  audio: AudioBackend,
  budget: CalibrationBudget,
  opts: { recreate?: () => Promise<void>; durSec?: number } = {},
): Promise<ClockRateResult> {
  const dur = opts.durSec ?? CLOCK_RATE_SEC;
  const max = budget.clockRateMaxError;
  const done = (error: number | null, recreated: boolean, inputDropFraction: number | null = null): ClockRateResult => {
    const ok = error === null || Math.abs(error) <= max;
    const state: ClockRateResult['state'] = error === null ? 'unmeasured' : ok ? (recreated ? 'recreated-ok' : 'ok') : 'failed';
    return { ok, error, recreated, state, inputDropFraction };
  };
  if (!opts.recreate && hasSelfCheck(audio)) {
    const r = await audio.checkClockRate(dur);
    return done(r.error, r.recreated, r.diagnostics?.inputDropFraction ?? null);
  }
  /** `measureClockRate` reports a non-finite rate when it could not measure. */
  const measure = async (): Promise<number | null> => {
    const r = await audio.measureClockRate(dur);
    const err = r.framesPerSec / r.expected - 1;
    return Number.isFinite(err) ? err : null;
  };
  let err = await measure();
  if (err === null || Math.abs(err) <= max) return done(err, false);
  if (!opts.recreate) return done(err, false);
  await opts.recreate();
  err = await measure();
  return done(err, true);
}
