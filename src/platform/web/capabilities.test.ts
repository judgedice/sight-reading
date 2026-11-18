import { describe, expect, it } from 'vitest';
import type { PlatformCapabilities } from '../../core/platform.ts';
import { detectCapabilities, engineOf, osFamilyOf, type NavigatorLike, type WindowLike } from './capabilities.ts';

const UA = {
  iphone17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iphone18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphone26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.96 Mobile/15E148 Safari/604.1',
  ipadChromeDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.96 Version/18.5 Safari/605.1.15',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0',
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
} as const;

const wakeLock = { request: async () => ({}) };
const withWakeAndWorker = { wakeLock, serviceWorker: {} };

interface Stub {
  name: string;
  nav: NavigatorLike;
  win?: WindowLike;
  persisted?: boolean;
  expect: PlatformCapabilities;
}

const tab = (matches = false): WindowLike => ({ matchMedia: () => ({ matches }), isSecureContext: true });
const standalone: WindowLike = { matchMedia: () => ({ matches: true }), isSecureContext: true };

const webkitPhone = (displayMode: 'browser' | 'standalone' = 'browser'): PlatformCapabilities => ({
  platform: 'web',
  outputLatencyReported: false,
  wakeLock: true,
  serviceWorker: true,
  persistentStorage: 'best-effort',
  osFamily: 'ios',
  displayMode,
});

// Each stub is one environment; every expected field is spelled out, so a regression shows in the diff.
const stubs: Stub[] = [
  {
    name: 'iOS 17 Safari tab',
    nav: { userAgent: UA.iphone17, maxTouchPoints: 5, ...withWakeAndWorker, standalone: false },
    win: tab(),
    expect: webkitPhone(),
  },
  {
    name: 'iOS 17 home-screen app (navigator.standalone)',
    nav: { userAgent: UA.iphone17, maxTouchPoints: 5, ...withWakeAndWorker, standalone: true },
    win: tab(),
    expect: webkitPhone('standalone'),
  },
  {
    name: 'iOS 18 Safari tab',
    nav: { userAgent: UA.iphone18, maxTouchPoints: 5, ...withWakeAndWorker },
    win: tab(),
    expect: webkitPhone(),
  },
  {
    name: 'iOS 18 home-screen app (display-mode media query)',
    nav: { userAgent: UA.iphone18, maxTouchPoints: 5, ...withWakeAndWorker },
    win: standalone,
    expect: webkitPhone('standalone'),
  },
  {
    name: 'iOS 26 Safari tab',
    nav: { userAgent: UA.iphone26, maxTouchPoints: 5, ...withWakeAndWorker },
    win: tab(),
    expect: webkitPhone(),
  },
  {
    name: 'iOS 26 home-screen app with storage granted',
    nav: { userAgent: UA.iphone26, maxTouchPoints: 5, ...withWakeAndWorker, standalone: true },
    win: tab(),
    persisted: true,
    expect: { ...webkitPhone('standalone'), persistentStorage: 'granted' },
  },
  {
    name: 'iPadOS desktop-mode UA with touch points',
    nav: { userAgent: UA.ipadDesktopMode, maxTouchPoints: 5, ...withWakeAndWorker },
    win: tab(),
    expect: { ...webkitPhone(), osFamily: 'ipados' },
  },
  {
    name: 'Chrome on iOS (CriOS, WebKit underneath)',
    nav: { userAgent: UA.chromeIos, maxTouchPoints: 5, ...withWakeAndWorker },
    win: tab(),
    expect: webkitPhone(),
  },
  {
    name: 'Chrome on iPadOS in desktop mode (Macintosh UA with touch points)',
    nav: { userAgent: UA.ipadChromeDesktopMode, maxTouchPoints: 5, ...withWakeAndWorker },
    win: tab(),
    expect: { ...webkitPhone(), osFamily: 'ipados' },
  },
  {
    name: 'Safari on macOS',
    nav: { userAgent: UA.safariMac, maxTouchPoints: 0, ...withWakeAndWorker },
    win: tab(),
    expect: {
      platform: 'web',
      outputLatencyReported: false,
      wakeLock: true,
      serviceWorker: true,
      persistentStorage: 'best-effort',
      osFamily: 'macos',
      displayMode: 'browser',
    },
  },
  {
    name: 'Chrome on macOS',
    nav: { userAgent: UA.chromeMac, maxTouchPoints: 0, ...withWakeAndWorker },
    win: tab(),
    expect: {
      platform: 'web',
      outputLatencyReported: true,
      wakeLock: true,
      serviceWorker: true,
      persistentStorage: 'best-effort',
      osFamily: 'macos',
      displayMode: 'browser',
    },
  },
  {
    name: 'Chrome Android',
    nav: { userAgent: UA.chromeAndroid, maxTouchPoints: 5, ...withWakeAndWorker },
    win: tab(),
    expect: {
      platform: 'web',
      outputLatencyReported: true,
      wakeLock: true,
      serviceWorker: true,
      persistentStorage: 'best-effort',
      osFamily: 'android',
      displayMode: 'browser',
    },
  },
  {
    name: 'Firefox desktop on Windows (Gecko, output latency not reported)',
    nav: { userAgent: UA.firefoxWindows, maxTouchPoints: 0, ...withWakeAndWorker },
    win: tab(),
    expect: {
      platform: 'web',
      outputLatencyReported: false,
      wakeLock: true,
      serviceWorker: true,
      persistentStorage: 'best-effort',
      osFamily: 'windows',
      displayMode: 'browser',
    },
  },
  {
    name: 'Firefox desktop on Linux',
    nav: { userAgent: UA.firefoxLinux, maxTouchPoints: 0, ...withWakeAndWorker },
    win: tab(),
    expect: {
      platform: 'web',
      outputLatencyReported: false,
      wakeLock: true,
      serviceWorker: true,
      persistentStorage: 'best-effort',
      osFamily: 'linux',
      displayMode: 'browser',
    },
  },
  {
    name: 'Chrome on Windows, installed as a PWA',
    nav: { userAgent: UA.chromeWindows, maxTouchPoints: 0, ...withWakeAndWorker },
    win: standalone,
    expect: {
      platform: 'web',
      outputLatencyReported: true,
      wakeLock: true,
      serviceWorker: true,
      persistentStorage: 'best-effort',
      osFamily: 'windows',
      displayMode: 'standalone',
    },
  },
];

describe('detectCapabilities: environment table (IOS1)', () => {
  it.each(stubs.map((s) => [s.name, s] as const))('%s', (_name, s) => {
    expect(detectCapabilities(s.nav, s.win, s.persisted)).toEqual(s.expect);
  });

  it('has at least 10 environment stubs', () => {
    expect(stubs.length).toBeGreaterThanOrEqual(10);
  });

  it('outputLatencyReported is false for every WebKit stub', () => {
    const webkit = stubs.filter((s) => engineOf(s.nav.userAgent, osFamilyOf(s.nav.userAgent, s.nav.maxTouchPoints ?? 0)) === 'webkit');
    expect(webkit.length).toBeGreaterThanOrEqual(6);
    for (const s of webkit) {
      expect(detectCapabilities(s.nav, s.win, s.persisted).outputLatencyReported, s.name).toBe(false);
    }
  });
});

describe('detectCapabilities: individual rules', () => {
  const plain = (nav: Partial<NavigatorLike>, win?: WindowLike) =>
    detectCapabilities({ userAgent: UA.chromeWindows, ...nav }, win ?? tab());

  it('wakeLock needs request(), not just the property', () => {
    expect(plain({ wakeLock: undefined }).wakeLock).toBe(false);
    expect(plain({ wakeLock: wakeLock }).wakeLock).toBe(true);
  });

  it('serviceWorker needs the API and a secure context', () => {
    expect(plain({ serviceWorker: undefined }).serviceWorker).toBe(false);
    expect(plain({ serviceWorker: {} }, { isSecureContext: false }).serviceWorker).toBe(false);
    expect(plain({ serviceWorker: {} }, { isSecureContext: true }).serviceWorker).toBe(true);
    expect(plain({ serviceWorker: {} }, {}).serviceWorker).toBe(true);
  });

  it('persistentStorage is granted only when the caller reports a persisted grant', () => {
    expect(detectCapabilities({ userAgent: UA.chromeWindows }, {}, false).persistentStorage).toBe('best-effort');
    expect(detectCapabilities({ userAgent: UA.chromeWindows }, {}, true).persistentStorage).toBe('granted');
  });

  it('displayMode is standalone from navigator.standalone or the display-mode query', () => {
    expect(plain({ standalone: true }, tab()).displayMode).toBe('standalone');
    expect(plain({}, standalone).displayMode).toBe('standalone');
    expect(plain({}, tab()).displayMode).toBe('browser');
  });

  it('platform is always web in this build', () => {
    expect(plain({ userAgent: UA.iphone18 }).platform).toBe('web');
  });

  it('iPadOS needs a Macintosh UA plus touch points; a touchless Mac stays macos', () => {
    expect(osFamilyOf(UA.safariMac, 0)).toBe('macos');
    expect(osFamilyOf(UA.safariMac, 5)).toBe('ipados');
  });

  it('a missing navigator.userAgent reads as an unknown browser with nothing reported', () => {
    const caps = detectCapabilities({ userAgent: '' }, {});
    expect(caps.osFamily).toBe('other');
    expect(caps.outputLatencyReported).toBe(false);
  });
});
