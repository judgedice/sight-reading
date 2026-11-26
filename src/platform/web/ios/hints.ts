/**
 * iOS sheet and hint triggers (05 IOS5; W13 install coach mark, W11 Auto-Lock hint, W8 Bluetooth banner) and the
 * "iOS: beta" label rule (05 IOS8, section 8.1 item 8).
 *
 * Every function here is pure: it takes the facts and returns whether to show, or which copy keys to show.
 * Strings are returned as en.json keys (04 copy), never as text. The UI decides when to render them.
 */
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { OsFamily, SessionState } from '../../../core/types.ts';
import gradingJson from '../../../../config/grading-config.json';
import { BLUETOOTH_LABEL_RE, bluetoothLabelMatches, delayMatters } from '../../../core/bluetooth-evidence.ts';

/** en.json keys used by the triggers. Each is checked against en.json by the tests. */
export const HINT_COPY = {
  betaLabel: 'app.beta',
  installCoach: 'install.coach',
  autoLock: 'scan.wakeLockHint',
  bluetoothBanner: 'banner.bluetooth',
  airpodsHint: 'calibrate.warn.airpods',
} as const;

export type HintCopyKey = (typeof HINT_COPY)[keyof typeof HINT_COPY];

/** Input label patterns that mean a Bluetooth or hands-free route (W8; core/bluetooth-evidence.ts). */
export { BLUETOOTH_LABEL_RE, bluetoothLabelMatches };

/**
 * Gate (g): round-trip latency above this makes takes unranked. Read from config, not hard-coded (W8). It is not
 * Bluetooth evidence (round 3): it gets the neutral delay message, never the Bluetooth banner.
 */
export const HIGH_RTL_MS: number = gradingJson.ranked.maxRtlMs;

const IOS_FAMILY: ReadonlySet<OsFamily> = new Set<OsFamily>(['ios', 'ipados']);

export function isIosFamily(osFamily: OsFamily): boolean {
  return IOS_FAMILY.has(osFamily);
}

/** "iOS: beta" on the calibration screen and in About (IOS8). Null on every other platform. */
export function iosBetaLabelKey(osFamily: OsFamily): typeof HINT_COPY.betaLabel | null {
  return isIosFamily(osFamily) ? HINT_COPY.betaLabel : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Install coach mark (W13)
// ---------------------------------------------------------------------------------------------------------------

export interface InstallCoachInput {
  /** Only `osFamily` and `displayMode` are read. */
  capabilities: Pick<PlatformCapabilities, 'osFamily' | 'displayMode'>;
  /** The screen the sheet would appear on. The sheet waits for a results screen. */
  session: SessionState;
  /** Graded (not void) attempts the player has, including the one just finished. */
  gradedAttempts: number;
  /** `settings.shown.installCoach`: the sheet was shown before. */
  alreadyShown: boolean;
  /** A rank-up card is on this results visit. The sheet never stacks with it; it waits for the next results screen. */
  rankUpInThisVisit: boolean;
}

/**
 * Shows only on iOS or iPadOS in browser (tab) mode, once, on a results screen after the first graded take, and
 * never in the same results visit as the rank-up card. Never in standalone (home-screen) mode.
 */
export function shouldShowInstallCoach(i: InstallCoachInput): boolean {
  if (!isIosFamily(i.capabilities.osFamily)) return false;
  if (i.capabilities.displayMode !== 'browser') return false;
  if (i.alreadyShown) return false;
  if (i.gradedAttempts < 1) return false;
  if (i.session !== 'results') return false;
  return !i.rankUpInThisVisit;
}

// ---------------------------------------------------------------------------------------------------------------
// Auto-Lock hint (W11)
// ---------------------------------------------------------------------------------------------------------------

export interface AutoLockHintInput {
  /** The keep-awake controller's `autoLockHintRaised()`: a wake-lock request was rejected this session. */
  wakeLockRejected: boolean;
  /** Current session state. The hint never shows while a take is running. */
  session: SessionState;
  /** The hint already showed in this session (it is shown at most once per session, W11). */
  alreadyShownThisSession: boolean;
}

export function shouldShowAutoLockHint(i: AutoLockHintInput): boolean {
  if (!i.wakeLockRejected) return false;
  if (i.alreadyShownThisSession) return false;
  return i.session !== 'count-in' && i.session !== 'performing';
}

// ---------------------------------------------------------------------------------------------------------------
// Bluetooth banner (W8)
// ---------------------------------------------------------------------------------------------------------------

export interface BluetoothBannerInput {
  /** The input device label, if the browser reports one. */
  inputLabel: string | null | undefined;
  osFamily: OsFamily;
}

export interface BluetoothBanner {
  show: boolean;
  /** Copy keys to render, in order. Empty when `show` is false. */
  copyKeys: HintCopyKey[];
}

/** RTL above the gate (g) threshold: the neutral delay message, not a Bluetooth flag. Null (not measured) is never high. */
export function rtlIsHigh(rtlMs: number | null): boolean {
  return delayMatters(rtlMs, HIGH_RTL_MS);
}

/**
 * Banner only when the label names a Bluetooth device (positive evidence; never from latency). On iOS the AirPods
 * hint is added, which says AirPods microphones reduce accuracy and the iPhone mic works better.
 */
export function bluetoothBanner(i: BluetoothBannerInput): BluetoothBanner {
  if (!bluetoothLabelMatches(i.inputLabel)) return { show: false, copyKeys: [] };
  const copyKeys: HintCopyKey[] = [HINT_COPY.bluetoothBanner];
  if (isIosFamily(i.osFamily)) copyKeys.push(HINT_COPY.airpodsHint);
  return { show: true, copyKeys };
}
