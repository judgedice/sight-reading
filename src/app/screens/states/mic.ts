/** Microphone permission cases (04 section 9.2). Detection uses `getUserMedia` errors only. */
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { CopyKey } from '../../../ui/copy/copy.ts';

export type MicProblem = 'denied' | 'no-device' | 'busy' | 'insecure';

/** Per-browser unblock instructions for the denied card. */
export type MicBrowser = 'chrome' | 'safari-mac' | 'ios-safari' | 'ios-home-screen' | 'firefox';

/** Maps a `getUserMedia` rejection (or a missing secure context) to a case. Unknown errors read as no device. */
export function classifyMicError(err: unknown, secureContext = true): MicProblem {
  if (!secureContext) return 'insecure';
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'no-device';
  }
}

/**
 * Which instructions to show. The user agent is never read here (01 section 4.3): the capability flags and the
 * display mode tell iOS tab from iOS home-screen app and Safari macOS from Blink; Firefox needs a hint from the
 * composition root, which may sniff.
 */
export function pickMicBrowser(caps: Pick<PlatformCapabilities, 'osFamily' | 'displayMode' | 'outputLatencyReported'>, hint?: 'firefox'): MicBrowser {
  if (caps.osFamily === 'ios' || caps.osFamily === 'ipados') return caps.displayMode === 'standalone' ? 'ios-home-screen' : 'ios-safari';
  if (hint === 'firefox') return 'firefox';
  if (caps.osFamily === 'macos' && !caps.outputLatencyReported) return 'safari-mac';
  return 'chrome';
}

const DENIED_STEPS: Record<MicBrowser, CopyKey> = {
  chrome: 'permission.denied.chrome',
  'safari-mac': 'permission.denied.safariMac',
  'ios-safari': 'permission.denied.iosSafari',
  'ios-home-screen': 'permission.denied.iosHomeScreen',
  firefox: 'permission.denied.firefox',
};

export const deniedStepsKey = (b: MicBrowser): CopyKey => DENIED_STEPS[b];

/** The body line of a non-denied case. */
export function micProblemKey(p: Exclude<MicProblem, 'denied'>): CopyKey {
  return p === 'no-device' ? 'permission.noDevice' : p === 'busy' ? 'permission.busy' : 'permission.insecure';
}
