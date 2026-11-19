// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { CalibrationCard } from './CalibrationCard.tsx';
import { SelfTestPanel } from './SelfTestPanel.tsx';
import { calReducer, calibrationIsMandatoryPath, initialCalState, methodFor, offsetTick, warningsFor } from './flow.ts';
import { fakeServices, loopbackBad, loopbackOk, playAlongBad, playAlongOk, route } from './test-services.ts';

const source: LocationSource = { getHash: () => '#/calibrate', subscribe: () => () => undefined, navigate: () => undefined };
let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});
const wrap = (n: React.ReactNode): React.ReactNode => (
  <RouterProvider table={createRouteTable()} source={source}>
    {n}
  </RouterProvider>
);
const button = (name: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === name);
  if (!b) throw new Error(`no button ${name}; have ${[...document.querySelectorAll('button')].map((x) => x.textContent).join('|')}`);
  return b;
};
const names = (): string[] => [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
const press = async (name: string): Promise<void> => {
  await act(async () => {
    button(name).click();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('flow', () => {
  it('speakers use loopback, headphones play-along', () => {
    expect(methodFor('speakers')).toBe('loopback');
    expect(methodFor('wired')).toBe('play-along');
    expect(methodFor('bluetooth')).toBe('play-along');
  });
  it('offers an estimate only after the second play-along failure', () => {
    let s = calReducer(initialCalState(), { type: 'start-playalong', clicks: 8 });
    s = calReducer(s, { type: 'playalong-done', outcome: playAlongBad(), warnings: [] });
    expect(s.playAlongFailures).toBe(1);
    s = calReducer(s, { type: 'start-playalong', clicks: 8 });
    s = calReducer(s, { type: 'playalong-done', outcome: playAlongBad(), warnings: [] });
    expect(s.playAlongFailures).toBe(2);
    s = calReducer(s, { type: 'use-estimate' });
    expect(s.step).toBe('finished');
    expect(s.estimate).toBe(true);
    expect(s.calibration).toBeNull();
  });
  it('a success resets the failure count; dots mirror the offsets', () => {
    let s = calReducer(initialCalState(), { type: 'start-playalong', clicks: 8 });
    s = calReducer(s, { type: 'playalong-done', outcome: playAlongBad(), warnings: [] });
    s = calReducer(s, { type: 'playalong-done', outcome: playAlongOk(), warnings: [] });
    expect(s.playAlongFailures).toBe(0);
    expect(s.dots.every((d) => d === 'heard')).toBe(true);
  });
  it('warnings: bluetooth by declaration or RTL above the ranked limit, AirPods on iOS, AEC', () => {
    const base = { outputMode: 'speakers', rtlMs: 40, maxRtlMs: 120, route, caps: { osFamily: 'windows' }, aecSuspected: false } as const;
    expect(warningsFor(base)).toEqual([]);
    expect(warningsFor({ ...base, rtlMs: 121 })).toEqual(['bluetooth']);
    expect(warningsFor({ ...base, outputMode: 'bluetooth' })).toEqual(['bluetooth']);
    expect(warningsFor({ ...base, rtlMs: 200, caps: { osFamily: 'ios' } })).toEqual(['bluetooth', 'airpods']);
    expect(warningsFor({ ...base, aecSuspected: true })).toEqual(['aec']);
  });
  it('mandatory path is iOS with unreported output latency (R16)', () => {
    expect(calibrationIsMandatoryPath({ osFamily: 'ios', outputLatencyReported: false })).toBe(true);
    expect(calibrationIsMandatoryPath({ osFamily: 'macos', outputLatencyReported: false })).toBe(false);
    expect(calibrationIsMandatoryPath({ osFamily: 'ios', outputLatencyReported: true })).toBe(false);
  });
  it('offset ticks clamp', () => {
    expect(offsetTick(null)).toBeNull();
    expect(offsetTick(-250)).toBe(-1);
    expect(offsetTick(50)).toBe(0.5);
  });
});

describe('CalibrationCard', () => {
  it('speakers: Start unlocks in the click, shows the result, asks about audibility, saves and continues', async () => {
    const svc = fakeServices();
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} allowSkip />));
    expect(document.body.textContent).toContain('Stay quiet for about 8 seconds');
    expect(names()).toEqual(['Hear the click', 'Start', 'Skip']);
    expect(document.body.textContent).toContain('Without calibration, takes on this device are practice only.');
    act(() => button('Start').click());
    // unlock was called synchronously from the click, before any await resolved.
    expect(svc.calls[0]).toBe('unlock');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(svc.calls).toEqual(['unlock', 'loopback']);
    expect(svc.saved).toHaveLength(1);
    expect(document.body.textContent).toContain("Your setup adds 42 ms. We'll correct for it.");
    expect(document.body.textContent).toContain('± 2 ms');
    expect(document.body.textContent).toContain('Can you hear the click clearly while you play a note?');
    expect(names()).not.toContain('Continue');
    await press('Yes');
    expect(names()).toContain('Continue');
    click(button('Continue'));
    expect(done).toHaveBeenCalledWith('calibrated');
  });
  it('Not really suggests the Woodblock or Beep sound and links to Metronome sound', async () => {
    const svc = fakeServices();
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start');
    await press('Not really');
    expect(document.body.textContent).toContain('Try the Woodblock or Beep sound, or wired headphones.');
    expect(document.querySelector('a[href="#/settings/audio"]')?.textContent).toBe('Metronome sound');
    expect(names()).toContain('Continue');
  });
  it('loopback failure names the next steps; Play along instead runs play-along', async () => {
    const svc = fakeServices({ loopback: [loopbackBad()], playAlong: [playAlongOk()] });
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} />));
    await press('Start');
    expect(document.body.textContent).toContain("We couldn't hear the clicks. Turn up the volume, or play along instead.");
    expect(names()).toEqual(['Try again', 'Play along instead']);
    await press('Play along instead');
    expect(svc.calls.filter((c) => c === 'playalong')).toHaveLength(1);
    expect(document.body.textContent).toContain('Your setup adds 60 ms');
    // Play-along has no audibility question.
    expect(names()).toContain('Continue');
  });
  it('headphones go straight to play-along; two failures offer Use an estimate, which never saves', async () => {
    const svc = fakeServices({ output: 'wired', playAlong: [playAlongBad(), playAlongBad()] });
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} allowSkip />));
    expect(document.body.textContent).toContain('Play a short note on each click. 8 clicks.');
    await press('Start');
    expect(names()).toEqual(['Try again', 'Skip']);
    await press('Try again');
    expect(document.body.textContent).toContain("Timing can't be trusted with an estimate, so takes won't earn XP until you calibrate.");
    expect(names()).toContain('Use an estimate');
    await press('Use an estimate');
    expect(svc.saved).toEqual([]);
    click(button('Continue'));
    expect(done).toHaveBeenCalledWith('estimate');
  });
  it('shows Bluetooth and AEC warnings', async () => {
    const svc = fakeServices({ loopback: [loopbackOk({ rtlMs: 180, aecSuspected: true })] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start');
    expect(document.body.textContent).toContain('This looks like Bluetooth audio');
    expect(document.body.textContent).toContain('filtering the microphone');
  });
  it('iOS: beta label, XP note, no Skip control (R16), and a failed run never traps the player', async () => {
    const svc = fakeServices({ caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongBad(), playAlongBad()] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} allowSkip />));
    expect(document.body.textContent).toContain('iOS: beta');
    expect(document.body.textContent).toContain('On iPhone and iPad, takes earn XP only after this check.');
    expect(names()).toEqual(['Hear the click', 'Start']);
    await press('Start');
    await press('Try again');
    expect(names()).toContain('Use an estimate');
  });
  it('Hear the click shows before Start and on the result, is absent while listening, and locks the selects', async () => {
    const svc = fakeServices();
    let release: (v: ReturnType<typeof loopbackOk>) => void = () => undefined;
    svc.runLoopback = () => new Promise((r) => (release = r));
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    expect(names()).toContain('Hear the click');
    await press('Hear the click');
    expect(svc.calls).toContain('hear');
    act(() => button('Start').click());
    expect(svc.stops).toBeGreaterThan(0);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(names()).not.toContain('Hear the click');
    expect(document.body.textContent).toContain('Device choice is locked while we listen.');
    expect([...document.querySelectorAll('select')].every((x) => x.closest('[aria-disabled="true"]') !== null || x.disabled || x.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(document.querySelectorAll('.cal-dot[data-current="true"]')).toHaveLength(1);
    await act(async () => {
      release(loopbackOk());
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(names()).toContain('Hear the click');
    expect(document.body.textContent).not.toContain('Device choice is locked');
  });
  it('Skip is available where allowed and is not shown while running', async () => {
    const svc = fakeServices();
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} allowSkip />));
    click(button('Skip'));
    expect(done).toHaveBeenCalledWith('skipped');
  });
  it('a thrown run reads as a failure with a retry', async () => {
    const svc = fakeServices();
    svc.runLoopback = () => Promise.reject(new Error('no audio'));
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start');
    expect(document.body.textContent).toContain("The audio check couldn't run. Try again.");
    expect(names()).toContain('Try again');
  });
  it('changing output resets the card and stores the preference', async () => {
    const svc = fakeServices();
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    const sel = document.querySelector<HTMLSelectElement>('select[aria-label="Output"]');
    expect(sel).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(sel, 'wired');
      sel?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(svc.calls).toContain('prefs:{"outputMode":"wired"}');
    expect(document.body.textContent).toContain('Play a short note on each click');
  });
});

describe('SelfTestPanel', () => {
  it('runs the check, lists pass/fail per item and exports diagnostics', async () => {
    const svc = fakeServices();
    current = mount(wrap(<SelfTestPanel services={svc} />));
    expect(names()).toEqual(['Check audio']);
    await press('Check audio');
    const rows = [...document.querySelectorAll('.cal-check')].map((r) => r.textContent);
    expect(rows).toEqual(['Sanity tonePass', 'Clicks heardPass', 'Count-in recheckFail', 'Clock ratePass', 'Mic processing offPass', 'Screen refreshSkipped']);
    expect(document.body.textContent).toContain('Some checks failed');
    await press('Export diagnostics');
    expect(svc.exported).toEqual(['{"kind":"audio-self-test"}']);
  });
});
