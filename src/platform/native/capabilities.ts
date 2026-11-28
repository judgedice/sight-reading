/**
 * Capabilities of the native shell (PLAN R83 and R85). The OS family comes from the browser-side detection the
 * composition root already did (`readBrowserCapabilities`); this maps it to the platform kind and fixes what the
 * shell decides itself: no service worker, and reported output latency only where the engine's trust is A or B.
 */
import type { PlatformCapabilities, PlatformKind } from '../../core/platform.ts';
import type { OsFamily } from '../../core/types.ts';
import type { LatencyReport } from './audio/ipc.ts';

/** `'ios'` for iPhone and iPad, `'android'`, else `'desktop'` (macOS, Windows, Linux). */
export function platformKindOf(os: OsFamily): PlatformKind {
  if (os === 'ios' || os === 'ipados') return 'ios';
  if (os === 'android') return 'android';
  return 'desktop';
}

/** Reported latency is usable (never ranked on its own, R86) unless the engine could not trust it. */
export function outputLatencyReportedFor(trust: LatencyReport['trust'] | null): boolean {
  return trust !== null && trust !== 'C';
}

/**
 * The shell's capabilities. `trust` is null until the engine has opened (the first `unlock`); the backend then
 * updates `outputLatencyReported` on the same object.
 */
export function nativeCapabilities(base: Pick<PlatformCapabilities, 'osFamily' | 'displayMode' | 'wakeLock' | 'persistentStorage'>, trust: LatencyReport['trust'] | null = null): PlatformCapabilities {
  return {
    platform: platformKindOf(base.osFamily),
    outputLatencyReported: outputLatencyReportedFor(trust),
    wakeLock: base.wakeLock,
    serviceWorker: false,
    persistentStorage: base.persistentStorage,
    osFamily: base.osFamily,
    displayMode: base.displayMode,
  };
}
