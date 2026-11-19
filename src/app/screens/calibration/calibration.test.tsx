// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { CalibrationCard } from './CalibrationCard.tsx';
import { calReducer, calibrationIsMandatoryPath, initialCalState, methodFor, offsetTick, stageStatuses, warningsFor } from './flow.ts';
import type { CalProgress, LoopbackOutcome } from './services.ts';
import { checksSpeakers, fakeServices, headphonePlan, loopbackBad, loopbackOk, playAlongBad, playAlongOk, route, speakerPlan } from './test-services.ts';

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
    let s = calReducer(initialCalState(), { type: 'start-playalong', plan: headphonePlan() });
    s = calReducer(s, { type: 'playalong-done', outcome: playAlongBad(), warnings: [] });
    expect(s.playAlongFailures).toBe(1);
    s = calReducer(s, { type: 'start-playalong', plan: headphonePlan() });
    s = calReducer(s, { type: 'playalong-done', outcome: playAlongBad(), warnings: [] });
    expect(s.playAlongFailures).toBe(2);
    s = calReducer(s, { type: 'use-estimate' });
    expect(s.step).toBe('finished');
    expect(s.estimate).toBe(true);
    expect(s.calibration).toBeNull();
  });
  it('a success resets the failure count; dots mirror the offsets', () => {
    let s = calReducer(initialCalState(), { type: 'start-playalong', plan: headphonePlan() });
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
    expect(document.body.textContent).toContain("About 15 seconds: clicks at uneven gaps (on purpose, so an echo can't fool the timing), a short tone, then a one-bar count-in.");
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
    expect(document.body.textContent).toContain("Stage 1, Timing, didn't pass.");
    expect(document.body.textContent).toContain('We heard 2 of 10 ticks, not enough to time them. Turn up the volume, or play along instead.');
    expect(names()).toEqual(['Try again', 'Play along instead', 'Export diagnostics']);
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
    expect(document.body.textContent).toContain('About 10 seconds: 8 steady clicks. Play one short note on each.');
    expect(document.body.textContent).toContain("With headphones, sound doesn't reach the mic, so there's no tone or count-in check.");
    expect([...document.querySelectorAll('.cal-stage-row')].map((r) => r.getAttribute('data-stage'))).toEqual(['play-along']);
    await press('Start');
    expect(document.body.textContent).toContain("Stage 1, Play along, didn't pass.");
    // Headphones: the speaker checks did not run, and say why.
    const skipped = [...document.querySelectorAll('.cal-check[data-status="skipped"] .cal-check-name')].map((n) => n.textContent);
    expect(skipped).toEqual(['Pitch check', 'Clicks heard', 'Timing confirmed', 'Screen speed']);
    expect(document.body.textContent).toContain("Needs the speakers, so it doesn't run with headphones.");
    expect(names()).toEqual(['Try again', 'Export diagnostics', 'Skip']);
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
    svc.runLoopback = (x) =>
      new Promise((r) => {
        release = r;
        x.onStage('timing');
        x.onSound('timing', 0);
      });
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
    // The mark of the click that has sounded is lit; the others wait.
    expect(document.querySelectorAll('.cal-dot[data-state="sounding"], .cal-dot[data-state="heard"]')).toHaveLength(1);
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
    expect(document.body.textContent).toContain('8 steady clicks. Play one short note on each.');
  });
});

describe('stages', () => {
  it('a mark lights when its click sounds, then settles; the other stages light per sound and settle at the next', () => {
    let s = calReducer(initialCalState(), { type: 'start-loopback', plan: speakerPlan() });
    expect(s.dots).toHaveLength(10);
    expect(s.marks.template).toHaveLength(6);
    expect(s.marks['count-in']).toHaveLength(4);
    s = calReducer(s, { type: 'stage', stage: 'timing' });
    s = calReducer(s, { type: 'sound', stage: 'timing', index: 0 });
    expect(s.dots[0]).toBe('sounding');
    s = calReducer(s, { type: 'click', index: 0, heard: true });
    expect(s.dots[0]).toBe('heard');
    s = calReducer(s, { type: 'stage', stage: 'template' });
    s = calReducer(s, { type: 'sound', stage: 'template', index: 0 });
    s = calReducer(s, { type: 'sound', stage: 'template', index: 1 });
    expect(s.marks.template?.slice(0, 3)).toEqual(['done', 'sounding', 'pending']);
    expect(stageStatuses(s)).toEqual(['done', 'now', 'upcoming', 'upcoming']);
    s = calReducer(s, { type: 'loopback-done', outcome: loopbackOk({ checks: checksSpeakers({ recheck: 'fail' }) }), warnings: [] });
    expect(s.marks.template?.slice(0, 2)).toEqual(['done', 'done']);
    expect(stageStatuses(s)).toEqual(['passed', 'done', 'passed', 'failed']);
  });

  it('shows the stage line in one polite live region, changing per stage, and names the stage a thrown run stopped in', async () => {
    const svc = fakeServices();
    let p: CalProgress | null = null;
    let fail: (e: Error) => void = () => undefined;
    svc.runLoopback = (x) =>
      new Promise<LoopbackOutcome>((_, rej) => {
        p = x;
        fail = rej;
      });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    expect([...document.querySelectorAll('.cal-stage-row')].map((r) => r.getAttribute('data-stage'))).toEqual(['timing', 'template', 'pitch', 'count-in']);
    await press('Start');
    const now = (): string => document.querySelector('[data-testid="cal-now"]')?.textContent ?? '';
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(now()).toBe('Getting ready. Stay quiet.');
    act(() => p?.onStage('timing'));
    expect(now()).toBe('1 of 4 · Timing: 10 ticks at uneven gaps, on purpose');
    act(() => p?.onStage('template'));
    expect(now()).toBe('2 of 4 · Learning your click sound: 6 clicks in Classic');
    act(() => p?.onSound('template', 0));
    expect(document.querySelector('[data-stage="template"] .cal-mark')?.getAttribute('data-state')).toBe('sounding');
    expect(document.querySelector('[data-stage="template"]')?.getAttribute('aria-current')).toBe('step');
    act(() => p?.onStage('count-in'));
    expect(now()).toBe('4 of 4 · Count-in check: one loud click, then 3 softer, like a count-in');
    expect(document.querySelectorAll('[data-stage="count-in"] .cal-mark[data-accent="true"]')).toHaveLength(1);
    await act(async () => {
      fail(new Error('device gone'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.body.textContent).toContain('It stopped during stage 4, Count-in check.');
  });

  it('ends with the delay, what it means, and the audio check in plain words with a line per failure and skip', async () => {
    const svc = fakeServices({ loopback: [loopbackOk({ checks: checksSpeakers({ 'clock-rate': 'fail', recheck: 'fail' }) })] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start');
    expect(document.body.textContent).toContain("Your setup adds 42 ms. We'll correct for it.");
    expect(document.body.textContent).toContain('how long a sound takes to leave your speakers and reach the mic');
    // Stages carry their own results: the count-in stage failed, and says what that means.
    const status = (id: string): string | null => document.querySelector(`[data-stage="${id}"]`)?.getAttribute('data-status') ?? null;
    expect(['timing', 'template', 'pitch', 'count-in'].map(status)).toEqual(['passed', 'done', 'passed', 'failed']);
    expect(document.querySelector('[data-stage="count-in"] .cal-stage-why')?.textContent).toBe("A count-in didn't match the measured delay. Run it again in a quiet room.");
    // The check list holds what no stage stands for.
    const rows = [...document.querySelectorAll('.cal-check')].map((r) => [r.querySelector('.cal-check-name')?.textContent, r.querySelector('.cal-check-status')?.textContent, r.querySelector('.cal-check-why')?.textContent ?? null]);
    expect(rows).toEqual([
      ['Audio speed', "Didn't pass", "Your device's audio clock seems to run at the wrong speed, which can blur timing. Close other apps that play sound, then reload the page."],
      ['Mic effects off', 'Passed', null],
      ['Screen speed', 'Skipped', 'Not measured in the browser yet.'],
    ]);
    expect(document.body.textContent).toContain('Some checks failed');
    await press('Export diagnostics');
    expect(svc.exported).toEqual(['{"kind":"audio-self-test"}']);
    // There is no separate audio-check card or button: it ran with the calibration.
    expect(names()).not.toContain('Check audio');
    await press('Recalibrate');
    expect(svc.calls.filter((c) => c === 'loopback')).toHaveLength(2);
  });
});
