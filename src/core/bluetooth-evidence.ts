/**
 * When the app may say "Bluetooth" (round 3, Bluetooth false positive; docs/BUILD-NOTES.md). Only positive evidence
 * counts: the player said so, the input label names a Bluetooth device, or the hands-free signature (an 8 or 16 kHz
 * microphone track that appeared when the input label changed). Latency never counts: a MacBook's built-in speakers
 * and microphone measure 40 to 100 ms round trip in Chrome, and a long delay has a neutral message of its own.
 * It lives in core so the calibration card (app/), the session gates and the web backend share one rule.
 */

/** Label words that name a Bluetooth or hands-free route. "Headset" alone is not one: wired and USB headsets use it. */
export const BLUETOOTH_LABEL_RE = /airpods|bluetooth|beats|hands[- ]?free|\bhfp\b/i;

/** "BT" as a word, upper case only, so it is not read inside other words or model names. */
const BT_WORD_RE = /(^|[^A-Za-z0-9])BT([^A-Za-z0-9]|$)/;

/** Microphone track rates of the Bluetooth hands-free profile (HFP narrowband and wideband). */
export const HANDS_FREE_TRACK_RATES: readonly number[] = [8000, 16000];

export function bluetoothLabelMatches(label: string | null | undefined): boolean {
  return typeof label === 'string' && (BLUETOOTH_LABEL_RE.test(label) || BT_WORD_RE.test(label));
}

/**
 * The hands-free signature: the microphone track runs at 8 or 16 kHz and the input label changed during the session
 * (a headset that switched to its hands-free microphone). A low rate alone is not enough: some USB microphones run
 * at 16 kHz.
 */
export function handsFreeSignature(trackSampleRate: number | null | undefined, labelChanged: boolean): boolean {
  return labelChanged && typeof trackSampleRate === 'number' && HANDS_FREE_TRACK_RATES.includes(trackSampleRate);
}

/**
 * Round trip above which the delay matters: takes are unranked above `grading.ranked.maxRtlMs` (gate (g), 120 ms),
 * so the player is told. Below it the measured delay is subtracted from every note and needs no warning. Only a
 * measurement that calibration accepted counts; a rejected run's delay is not trusted.
 */
export function delayMatters(rtlMs: number | null, maxRtlMs: number): boolean {
  return rtlMs !== null && Number.isFinite(rtlMs) && rtlMs > maxRtlMs;
}
