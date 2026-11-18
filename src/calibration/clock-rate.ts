/**
 * Clock-rate check (01 §7.8, 05 W3 item 2): `measureClockRate(1.5)` counts worklet input frames against wall time.
 * Any output mode; needs no loopback. An error above `clockRateMaxError` (2%; a 44.1/48 kHz mismatch shows as 8.8%)
 * recreates the context once; failing again is the "Audio setup problem; please reload" state.
 *
 * `AudioBackend` has no recreate member, so the caller passes one (`WebAudioBackend` has `checkClockRate()`, which
 * this uses when present, and a private recreate).
 */
import type { AudioBackend } from '../core/platform.ts';
import type { CalibrationBudget } from './loopback.ts';

/** Measurement length, seconds (01 §7.8). */
export const CLOCK_RATE_SEC = 1.5;

export interface ClockRateResult {
  ok: boolean;
  /** Fractional error of the last measurement (0.088 = 8.8% fast). */
  error: number;
  /** The context was recreated once. */
  recreated: boolean;
  /** 'ok', 'recreated-ok', or 'failed' (show "Audio setup problem; please reload"). */
  state: 'ok' | 'recreated-ok' | 'failed';
}

/** Structural view of `WebAudioBackend.checkClockRate` (src/platform/web/audio), which calibration may not import. */
interface SelfCheckingBackend {
  checkClockRate(durSec?: number): Promise<{ ok: boolean; error: number; recreated: boolean }>;
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
  const done = (ok: boolean, error: number, recreated: boolean): ClockRateResult => ({
    ok,
    error,
    recreated,
    state: ok ? (recreated ? 'recreated-ok' : 'ok') : 'failed',
  });
  if (!opts.recreate && hasSelfCheck(audio)) {
    const r = await audio.checkClockRate(dur);
    return done(r.ok, r.error, r.recreated);
  }
  const measure = async (): Promise<number> => {
    const r = await audio.measureClockRate(dur);
    return r.framesPerSec / r.expected - 1;
  };
  let err = await measure();
  if (Math.abs(err) <= max) return done(true, err, false);
  if (!opts.recreate) return done(false, err, false);
  await opts.recreate();
  err = await measure();
  return done(Math.abs(err) <= max, err, true);
}
