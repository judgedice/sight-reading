/**
 * The sanity tone (calibration, `AudioBackend.playTone`): a sine with 10 ms raised-cosine fades at both ends, rendered
 * once into a mono buffer. Pure; shared by the web and native backends so both play the same samples.
 */
export function renderTone(hz: number, durSec: number, sampleRate: number, peak: number): Float32Array {
  const sr = sampleRate;
  const n = Math.max(1, Math.round(durSec * sr));
  const fade = Math.min(Math.round(0.01 * sr), Math.floor(n / 2));
  const d = new Float32Array(n);
  const w = (2 * Math.PI * hz) / sr;
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    else if (i >= n - fade) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / fade);
    d[i] = peak * env * Math.sin(w * i);
  }
  return d;
}
