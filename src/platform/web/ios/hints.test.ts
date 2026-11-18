import { describe, expect, it } from 'vitest';
import { copyKeys, isCopyKey } from '../../../ui/copy/copy.ts';
import type { OsFamily, SessionState } from '../../../core/types.ts';
import gradingJson from '../../../../config/grading-config.json';
import {
  BLUETOOTH_LABEL_RE,
  BLUETOOTH_RTL_MS,
  HINT_COPY,
  bluetoothBanner,
  bluetoothLabelMatches,
  iosBetaLabelKey,
  rtlIsBluetoothClass,
  shouldShowAutoLockHint,
  shouldShowInstallCoach,
  type InstallCoachInput,
} from './hints.ts';

const ALL_OS: OsFamily[] = ['ios', 'ipados', 'macos', 'android', 'windows', 'linux', 'other'];
const ALL_STATES: SessionState[] = ['idle', 'loading', 'covered', 'scanning', 'count-in', 'performing', 'finishing', 'results', 'error'];

const coach = (over: Partial<InstallCoachInput> & { osFamily?: OsFamily; displayMode?: 'browser' | 'standalone' } = {}): InstallCoachInput => {
  const { osFamily = 'ios', displayMode = 'browser', ...rest } = over;
  return {
    capabilities: { osFamily, displayMode },
    session: 'results',
    gradedAttempts: 1,
    alreadyShown: false,
    rankUpInThisVisit: false,
    ...rest,
  };
};

describe('IOS5 install coach mark (W13)', () => {
  it('shows on iOS and iPadOS in browser mode after the first graded take', () => {
    expect(shouldShowInstallCoach(coach({ osFamily: 'ios' }))).toBe(true);
    expect(shouldShowInstallCoach(coach({ osFamily: 'ipados' }))).toBe(true);
  });

  it('never shows on any other OS, even in browser mode', () => {
    for (const os of ALL_OS.filter((o) => o !== 'ios' && o !== 'ipados')) {
      expect(shouldShowInstallCoach(coach({ osFamily: os }))).toBe(false);
    }
  });

  it('never shows in standalone (home-screen) mode', () => {
    expect(shouldShowInstallCoach(coach({ displayMode: 'standalone' }))).toBe(false);
    expect(shouldShowInstallCoach(coach({ osFamily: 'ipados', displayMode: 'standalone' }))).toBe(false);
  });

  it('shows once: never after it was shown', () => {
    expect(shouldShowInstallCoach(coach({ alreadyShown: true }))).toBe(false);
  });

  it('needs at least one graded take', () => {
    expect(shouldShowInstallCoach(coach({ gradedAttempts: 0 }))).toBe(false);
    expect(shouldShowInstallCoach(coach({ gradedAttempts: 1 }))).toBe(true);
    expect(shouldShowInstallCoach(coach({ gradedAttempts: 7 }))).toBe(true);
  });

  it('waits for a results screen', () => {
    for (const s of ALL_STATES.filter((s) => s !== 'results')) {
      expect(shouldShowInstallCoach(coach({ session: s }))).toBe(false);
    }
  });

  it('is deferred when a rank-up card is on the same results visit, and shows on the next one', () => {
    expect(shouldShowInstallCoach(coach({ rankUpInThisVisit: true }))).toBe(false);
    expect(shouldShowInstallCoach(coach({ rankUpInThisVisit: false }))).toBe(true);
  });

  it('is a pure function of its inputs (same input, same answer)', () => {
    const input = coach();
    expect(shouldShowInstallCoach(input)).toBe(shouldShowInstallCoach({ ...input }));
  });
});

describe('IOS5 Auto-Lock hint (W11)', () => {
  it('shows only after a wake-lock rejection', () => {
    expect(shouldShowAutoLockHint({ wakeLockRejected: false, session: 'scanning', alreadyShownThisSession: false })).toBe(false);
    expect(shouldShowAutoLockHint({ wakeLockRejected: true, session: 'scanning', alreadyShownThisSession: false })).toBe(true);
  });

  it('never during a take', () => {
    for (const s of ['count-in', 'performing'] as const) {
      expect(shouldShowAutoLockHint({ wakeLockRejected: true, session: s, alreadyShownThisSession: false })).toBe(false);
    }
  });

  it('shows at most once per session', () => {
    expect(shouldShowAutoLockHint({ wakeLockRejected: true, session: 'scanning', alreadyShownThisSession: true })).toBe(false);
  });

  it('is allowed on every non-take screen', () => {
    for (const s of ALL_STATES.filter((s) => s !== 'count-in' && s !== 'performing')) {
      expect(shouldShowAutoLockHint({ wakeLockRejected: true, session: s, alreadyShownThisSession: false })).toBe(true);
    }
  });
});

describe('IOS5 Bluetooth banner (W8)', () => {
  it('reads the RTL threshold from config/grading-config.json (ranked.maxRtlMs)', () => {
    expect(BLUETOOTH_RTL_MS).toBe(gradingJson.ranked.maxRtlMs);
    expect(BLUETOOTH_RTL_MS).toBe(120);
  });

  it('matches the labels the spec names, case-insensitively', () => {
    for (const label of ['AirPods Pro', 'Bluetooth Headphones', 'Beats Studio', 'Headset Microphone', 'Hands-Free', 'airpods', 'BLUETOOTH']) {
      expect(bluetoothLabelMatches(label)).toBe(true);
    }
    expect(BLUETOOTH_LABEL_RE.flags).toContain('i');
  });

  it('does not match built-in or wired labels', () => {
    for (const label of ['MacBook Air Microphone', 'iPhone Microphone', 'USB Audio Device', 'Built-in Microphone', '', null, undefined]) {
      expect(bluetoothLabelMatches(label)).toBe(false);
    }
  });

  it('flags RTL strictly above 120 ms, never when unmeasured', () => {
    expect(rtlIsBluetoothClass(120)).toBe(false);
    expect(rtlIsBluetoothClass(120.5)).toBe(true);
    expect(rtlIsBluetoothClass(150)).toBe(true);
    expect(rtlIsBluetoothClass(40)).toBe(false);
    expect(rtlIsBluetoothClass(null)).toBe(false);
  });

  it('a 150 ms fake calibration raises the banner with no label', () => {
    const b = bluetoothBanner({ inputLabel: 'Built-in Microphone', rtlMs: 150, osFamily: 'linux' });
    expect(b.show).toBe(true);
    expect(b.copyKeys).toEqual([HINT_COPY.bluetoothBanner]);
  });

  it('a label fixture raises the banner with no measurement', () => {
    const b = bluetoothBanner({ inputLabel: 'AirPods', rtlMs: null, osFamily: 'linux' });
    expect(b.show).toBe(true);
    expect(b.copyKeys).toEqual([HINT_COPY.bluetoothBanner]);
  });

  it('no banner for a wired route with a normal RTL', () => {
    expect(bluetoothBanner({ inputLabel: 'USB Audio', rtlMs: 30, osFamily: 'ios' })).toEqual({ show: false, copyKeys: [] });
  });

  it('adds the AirPods hint on iOS only', () => {
    const ios = bluetoothBanner({ inputLabel: 'AirPods', rtlMs: null, osFamily: 'ios' });
    expect(ios.copyKeys).toEqual([HINT_COPY.bluetoothBanner, HINT_COPY.airpodsHint]);
    const ipad = bluetoothBanner({ inputLabel: 'AirPods', rtlMs: null, osFamily: 'ipados' });
    expect(ipad.copyKeys).toContain(HINT_COPY.airpodsHint);
    const mac = bluetoothBanner({ inputLabel: 'AirPods', rtlMs: null, osFamily: 'macos' });
    expect(mac.copyKeys).toEqual([HINT_COPY.bluetoothBanner]);
  });
});

describe('IOS8 "iOS: beta" label rule', () => {
  it('shows the label for ios and ipados only', () => {
    expect(iosBetaLabelKey('ios')).toBe('app.beta');
    expect(iosBetaLabelKey('ipados')).toBe('app.beta');
    for (const os of ALL_OS.filter((o) => o !== 'ios' && o !== 'ipados')) {
      expect(iosBetaLabelKey(os)).toBeNull();
    }
  });
});

describe('IOS5 copy keys resolve from en.json', () => {
  it('every key the triggers return exists in the catalogue', () => {
    for (const key of Object.values(HINT_COPY)) {
      expect(isCopyKey(key), key).toBe(true);
    }
    expect(copyKeys.length).toBeGreaterThan(0);
  });
});
