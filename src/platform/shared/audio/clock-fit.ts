/**
 * Clock-rate fit (01 §7.8): how fast the audio context's clock runs against wall time, from (wall, context time)
 * pairs that were each taken at one instant by a single party, never from the arrival time of a message.
 *
 * Sources, in order of preference (`WebAudioBackend.measureClock`):
 * - `output-timestamp`: `AudioContext.getOutputTimestamp()`, whose `contextTime` and `performanceTime` the browser
 *   reports as one coherent pair. Read on the main thread, but a late read only moves the pair along the line.
 * - `worklet`: the capture worklet stamps `currentFrame` with `Date.now()` in the first render quantum of each
 *   render burst (the device callback), and sends the latest stamp on request.
 *
 * A window is split into `subWindows` equal stretches of wall time, each fitted by least squares. The window is
 * consistent only when every stretch agrees with their median within `agreeTol`: a render stall (device start-up,
 * a glitch) is a step in the line, not a slope, and shows up as one stretch that disagrees. An inconsistent window
 * is never used as a measurement.
 */

export interface ClockSample {
  /** Wall time, ms (one clock per series: `performance.now()` or the worklet's `Date.now()`). */
  wallMs: number;
  /** Context time of the same instant, seconds. */
  ctxSec: number;
}

export interface ClockFitOptions {
  /** Equal stretches of wall time fitted separately (default 4). */
  subWindows?: number;
  /** Largest allowed difference between a stretch's error and the median, fraction (default 0.004). */
  agreeTol?: number;
  /** Fewest samples in each stretch (default 4). */
  minPerSub?: number;
  /** Intended window length, ms; the samples must span at least `minCoverage` of it. */
  windowMs: number;
  /** Default 0.8. */
  minCoverage?: number;
}

export interface ClockFit {
  /** Fractional error of the whole window's least-squares slope (0.088 = 8.8% fast). */
  error: number;
  consistent: boolean;
  /** Why the window is not consistent. */
  reason: 'ok' | 'too-few-samples' | 'short-span' | 'disagree';
  /** Fractional error of each stretch. */
  subErrors: number[];
  n: number;
  spanMs: number;
  /** Largest distance of a sample from the whole window's line, ms. */
  maxResidMs: number;
}

export const CLOCK_FIT_DEFAULTS = { subWindows: 4, agreeTol: 0.004, minPerSub: 4, minCoverage: 0.8 } as const;

/** Least-squares slope of ctxSec against wall seconds, and the largest residual in ms. */
function lsq(s: readonly ClockSample[]): { slope: number; maxResidMs: number } {
  const n = s.length;
  let mx = 0;
  let my = 0;
  for (const p of s) {
    mx += p.wallMs / 1000;
    my += p.ctxSec;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (const p of s) {
    const dx = p.wallMs / 1000 - mx;
    sxy += dx * (p.ctxSec - my);
    sxx += dx * dx;
  }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  let r = 0;
  for (const p of s) r = Math.max(r, Math.abs(p.ctxSec - my - slope * (p.wallMs / 1000 - mx)));
  return { slope, maxResidMs: r * 1000 };
}

export function median(xs: readonly number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] as number) : ((a[m - 1] as number) + (a[m] as number)) / 2;
}

/** Sorted by wall time, with repeated wall or context readings (an unchanged snapshot) dropped. */
export function cleanSamples(samples: readonly ClockSample[]): ClockSample[] {
  const s = samples.filter((p) => Number.isFinite(p.wallMs) && Number.isFinite(p.ctxSec)).sort((a, b) => a.wallMs - b.wallMs);
  const out: ClockSample[] = [];
  for (const p of s) {
    const last = out[out.length - 1];
    if (last && (p.wallMs <= last.wallMs || p.ctxSec <= last.ctxSec)) continue;
    out.push(p);
  }
  return out;
}

export function fitClockWindow(samples: readonly ClockSample[], o: ClockFitOptions): ClockFit {
  const k = o.subWindows ?? CLOCK_FIT_DEFAULTS.subWindows;
  const tol = o.agreeTol ?? CLOCK_FIT_DEFAULTS.agreeTol;
  const minPer = o.minPerSub ?? CLOCK_FIT_DEFAULTS.minPerSub;
  const cov = o.minCoverage ?? CLOCK_FIT_DEFAULTS.minCoverage;
  const s = cleanSamples(samples);
  const n = s.length;
  const first = s[0];
  const last = s[n - 1];
  const spanMs = first && last ? last.wallMs - first.wallMs : 0;
  const bad = (reason: ClockFit['reason'], error = NaN, maxResidMs = NaN, subErrors: number[] = []): ClockFit => ({ error, consistent: false, reason, subErrors, n, spanMs, maxResidMs });
  if (n < k * minPer || !first) return bad('too-few-samples');
  const whole = lsq(s);
  const error = whole.slope - 1;
  if (spanMs < cov * o.windowMs) return bad('short-span', error, whole.maxResidMs);
  const subErrors: number[] = [];
  for (let i = 0; i < k; i++) {
    const lo = first.wallMs + (spanMs * i) / k;
    const hi = first.wallMs + (spanMs * (i + 1)) / k;
    const part = s.filter((p) => p.wallMs >= lo && (i === k - 1 ? p.wallMs <= hi : p.wallMs < hi));
    if (part.length < minPer) return bad('too-few-samples', error, whole.maxResidMs, subErrors);
    subErrors.push(lsq(part).slope - 1);
  }
  const med = median(subErrors);
  const agree = subErrors.every((e) => Math.abs(e - med) <= tol) && Math.abs(error - med) <= tol;
  if (!agree) return bad('disagree', error, whole.maxResidMs, subErrors);
  return { error, consistent: true, reason: 'ok', subErrors, n, spanMs, maxResidMs: whole.maxResidMs };
}
