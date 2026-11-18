/** Small robust statistics shared by the calibration analyses (01 §7.7, §7.8). Pure. */

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] as number) : 0.5 * ((a[m - 1] as number) + (a[m] as number));
}

/** Median absolute deviation from the median (unscaled, as 01 §7.8's "MAD ≤ 3 ms" reads). */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Power ratio to dB with a floor, so silence never gives -Infinity. */
export const powerDb = (p: number, floorDb = -140): number => (p > 0 ? Math.max(floorDb, 10 * Math.log10(p)) : floorDb);

/** q-quantile (0..1) by linear interpolation. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((p, r) => p - r);
  const pos = Math.min(1, Math.max(0, q)) * (a.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < a.length ? (a[i] as number) * (1 - f) + (a[i + 1] as number) * f : (a[i] as number);
}
