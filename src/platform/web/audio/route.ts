/**
 * Route identity (01 §5.2, §7.8; 05 W5, W7, W8). `routeKey = hash(inputLabel | outputMode | sampleRate | uaFamily)`;
 * the label itself is never stored, only its hash and the coarse `inputKind` (05 §5.2: nothing identifies the
 * person or the device).
 */
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

export function routeKeyOf(inputLabel: string, outputMode: OutputMode, sampleRate: number, uaFamily: OsFamily): string {
  return `r-${fnv1a(`${inputLabel}|${outputMode}|${sampleRate}|${uaFamily}`)}`;
}

/** Coarse input class from the track label (W8 uses the Bluetooth pattern). */
export function inputKindOf(label: string): AudioRouteInfo['inputKind'] {
  if (/airpods|bluetooth|beats|headset|hands-free|hfp/i.test(label)) return 'bluetooth';
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
