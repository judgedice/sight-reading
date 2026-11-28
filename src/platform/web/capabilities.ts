/**
 * `detectCapabilities` (05 §5.1, W6, W11, W12, W13; work package IOS1).
 *
 * The only code allowed to read `navigator.userAgent` (05 §1, eslint restricted properties). The user
 * agent fills `osFamily` (labels, copy, diagnostics) and the engine behind `outputLatencyReported`.
 * Grading and ranking branches read the returned object, never the user agent.
 *
 * Inputs are passed in so the function is testable without a browser. `readBrowserCapabilities` is the
 * one call site that reads the live globals.
 */
import type { PlatformCapabilities } from '../../core/platform.ts';
import type { DisplayMode, OsFamily } from '../../core/types.ts';

/** The subset of `Navigator` the detector reads. A real `Navigator` satisfies it structurally. */
export interface NavigatorLike {
  readonly userAgent: string;
  readonly maxTouchPoints?: number;
  /** Present when the Screen Wake Lock API exists (`navigator.wakeLock.request`). */
  readonly wakeLock?: { request(type: 'screen'): Promise<unknown> } | undefined;
  /** Present when service workers exist. */
  readonly serviceWorker?: unknown;
  /** iOS Safari legacy flag, true for a home-screen app. */
  readonly standalone?: boolean;
}

/** The subset of `Window` the detector reads. */
export interface WindowLike {
  matchMedia?(query: string): { readonly matches: boolean };
  /** Service workers need a secure context; absent means secure. */
  readonly isSecureContext?: boolean;
  /** Injected by the Tauri webview before any page script runs; absent in a browser. */
  readonly __TAURI_INTERNALS__?: unknown;
}

type Engine = 'webkit' | 'blink' | 'gecko' | 'other';

const IOS_OS: ReadonlySet<OsFamily> = new Set<OsFamily>(['ios', 'ipados']);

/** OS family from the user agent, with the iPadOS desktop-mode case (Macintosh UA plus touch points). */
export function osFamilyOf(userAgent: string, maxTouchPoints: number): OsFamily {
  if (/iPhone|iPod/.test(userAgent)) return 'ios';
  if (/iPad/.test(userAgent)) return 'ipados';
  if (/Android/.test(userAgent)) return 'android';
  if (/Macintosh|Mac OS X/.test(userAgent)) return maxTouchPoints > 1 ? 'ipados' : 'macos';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'other';
}

/**
 * Rendering engine. Every browser on iOS and iPadOS is WebKit, whatever its token says (Chrome is
 * `CriOS`, Firefox is `FxiOS`), so the OS check runs first.
 */
export function engineOf(userAgent: string, os: OsFamily): Engine {
  if (IOS_OS.has(os)) return 'webkit';
  if (/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(userAgent)) return 'blink';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'gecko';
  if (/AppleWebKit\//.test(userAgent) && /Safari\//.test(userAgent)) return 'webkit';
  return 'other';
}

function displayModeOf(nav: NavigatorLike, win: WindowLike): DisplayMode {
  if (nav.standalone === true) return 'standalone';
  return win.matchMedia?.('(display-mode: standalone)').matches === true ? 'standalone' : 'browser';
}

/**
 * Fills `PlatformCapabilities` once (05 §5.1, IOS1).
 *
 * - `platform` is `'web'`: this build is the browser app. The native target is a separate build.
 * - `outputLatencyReported` is true only for Blink (Chrome, Edge, Chromium on desktop and Android). It
 *   is false for every WebKit stub, including Safari on macOS and every browser on iOS (05 W6), and
 *   false for Gecko and unknown engines, because their output-latency reporting is not verified.
 * - `persistentStorage` is `'granted'` only when the caller has already awaited
 *   `navigator.storage.persisted()` and passes `storagePersisted: true`. The grant is heuristic on
 *   Safari, so the default is `'best-effort'`.
 * - `serviceWorker` needs the API and a secure context (when the window says so), and is false inside the Tauri
 *   shell (`__TAURI_INTERNALS__` on the window).
 */
export function detectCapabilities(
  nav: NavigatorLike,
  win: WindowLike = {},
  storagePersisted = false,
): PlatformCapabilities {
  const userAgent = nav.userAgent ?? '';
  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  const osFamily = osFamilyOf(userAgent, maxTouchPoints);
  const engine = engineOf(userAgent, osFamily);
  const secure = win.isSecureContext !== false;
  // Inside the Tauri shell the page is served from the app's own asset origin: no service worker there (the shell
  // is bundled, so there is nothing to cache offline).
  const nativeShell = win.__TAURI_INTERNALS__ !== undefined;
  return {
    platform: 'web',
    outputLatencyReported: engine === 'blink',
    wakeLock: typeof nav.wakeLock?.request === 'function',
    serviceWorker: nav.serviceWorker !== undefined && nav.serviceWorker !== null && secure && !nativeShell,
    persistentStorage: storagePersisted ? 'granted' : 'best-effort',
    osFamily,
    displayMode: displayModeOf(nav, win),
  };
}

/**
 * Reads the live `navigator`, `window` and optional storage grant, then calls `detectCapabilities`.
 * Call once at start-up and pass the result through `PlatformServices`. The caller awaits
 * `navigator.storage.persisted()` and passes the boolean, because the detector itself is synchronous.
 */
export function readBrowserCapabilities(storagePersisted = false): PlatformCapabilities {
  const g = globalThis as unknown as { navigator?: NavigatorLike; window?: WindowLike };
  const nav: NavigatorLike = g.navigator ?? { userAgent: '' };
  const win: WindowLike = g.window ?? {};
  return detectCapabilities(nav, win, storagePersisted);
}
