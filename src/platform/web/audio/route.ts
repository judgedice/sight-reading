/**
 * Route identity (01 §5.2, §7.8; 05 W5, W7, W8). `routeKey = hash(normalised inputLabel | outputMode | sampleRate | uaFamily)`;
 * the label itself is never stored, only its hash and the coarse `inputKind` (05 §5.2: nothing identifies the
 * person or the device).
 */
import { bluetoothLabelMatches, handsFreeSignature } from '../../../core/bluetooth-evidence.ts';
import type { AppliedProcessing, AudioRouteInfo, OsFamily, OutputMode } from '../../../core/platform.ts';

/** FNV-1a, 32-bit, as 8 hex digits. Not cryptographic; it only needs to be stable. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Chrome (macOS, Windows, ChromeOS) names the system default input "Default - <device>" and the communications
 * device "Communications - <device>". The prefix changes when the player changes the system default, though the
 * microphone is the same. Hashing it made a calibration made under one label not apply under another (round 2,
 * cause 5), so it is stripped before hashing. Only these two prefixes, once, at the start.
 */
const VIRTUAL_PREFIXES = ['Default - ', 'Communications - '] as const;

export function normalizeInputLabel(label: string): string {
  const t = label.trim();
  for (const p of VIRTUAL_PREFIXES) if (t.slice(0, p.length).toLowerCase() === p.toLowerCase()) return t.slice(p.length).trim();
  return t;
}

/** The key as before round 2: the label hashed as the browser reported it. Kept so stored calibrations stay readable. */
export function legacyRouteKeyOf(inputLabel: string, outputMode: OutputMode, sampleRate: number, uaFamily: OsFamily): string {
  return `r-${fnv1a(`${inputLabel}|${outputMode}|${sampleRate}|${uaFamily}`)}`;
}

export function routeKeyOf(inputLabel: string, outputMode: OutputMode, sampleRate: number, uaFamily: OsFamily): string {
  return legacyRouteKeyOf(normalizeInputLabel(inputLabel), outputMode, sampleRate, uaFamily);
}

/**
 * Every key a calibration for this route may have been stored under, current key first: the normalised key, then
 * the keys the old code produced for the plain label and for each prefixed form of it. A calibration stored under
 * any of them is this route's (see `adoptLegacyCalibrations` in app/compose/calibration-services.ts).
 */
export function routeKeyAliasesOf(inputLabel: string, outputMode: OutputMode, sampleRate: number, uaFamily: OsFamily): string[] {
  const plain = normalizeInputLabel(inputLabel);
  const keys = [routeKeyOf(inputLabel, outputMode, sampleRate, uaFamily)];
  for (const l of [plain, ...VIRTUAL_PREFIXES.map((p) => p + plain)]) {
    const k = legacyRouteKeyOf(l, outputMode, sampleRate, uaFamily);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/**
 * Coarse input class from the track label (W8). `bluetooth` only on positive evidence (core/bluetooth-evidence.ts):
 * a Bluetooth label, or the hands-free signature (an 8 or 16 kHz track after the label changed). Never from latency.
 */
export function inputKindOf(label: string, o: { trackSampleRate?: number | null; labelChanged?: boolean } = {}): AudioRouteInfo['inputKind'] {
  if (bluetoothLabelMatches(label) || handsFreeSignature(o.trackSampleRate, o.labelChanged ?? false)) return 'bluetooth';
  if (/usb|interface|scarlett|focusrite|audient|motu|presonus|zoom|rode|shure|yeti/i.test(label)) return 'usb-interface';
  if (/headphone|wired|line in|external|lightning|earpods/i.test(label)) return 'wired';
  if (/built-?in|internal|macbook|iphone|ipad|microphone array|default|fake/i.test(label)) return 'built-in';
  return 'unknown';
}

/** The subset of `MediaTrackSettings` read here. */
export interface TrackSettingsLike {
  echoCancellation?: boolean | string;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
  deviceId?: string;
}

const flag = (v: boolean | string | undefined): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v !== 'none' && v !== 'false';
  return null;
};

/** `getSettings()` readback (W5); a constraint the browser does not report is null. */
export function appliedProcessingOf(s: TrackSettingsLike): AppliedProcessing {
  return {
    echoCancellation: flag(s.echoCancellation),
    noiseSuppression: flag(s.noiseSuppression),
    autoGainControl: flag(s.autoGainControl),
  };
}
