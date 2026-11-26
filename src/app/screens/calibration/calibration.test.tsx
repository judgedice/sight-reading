// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { CalibrationCard, shownWarnings, type CalFooter } from './CalibrationCard.tsx';
import { calibrateReferrer } from './CalibrationScreen.tsx';
import { MAC_BUILT_IN } from '../../../core/bluetooth-evidence.fixtures.ts';
import { calReducer, calibrationIsMandatoryPath, diagnosticsWithResult, initialCalState, methodFor, offsetTick, stageStatuses, warningsFor } from './flow.ts';
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
  it('warnings: Bluetooth only on evidence (declared or a Bluetooth input), a neutral delay above the ranked limit, AirPods on iOS, AEC', () => {
    const base = { outputMode: 'speakers', rtlMs: 40, maxRtlMs: 120, accepted: true, route, caps: { osFamily: 'windows' }, aecSuspected: false } as const;
    expect(warningsFor(base)).toEqual([]);
    // Latency alone is never Bluetooth (round 3): a long, accepted round trip gets the neutral delay warning.
    expect(warningsFor({ ...base, rtlMs: 121 })).toEqual(['delay']);
    expect(warningsFor({ ...base, rtlMs: 120 })).toEqual([]);
    // A rejected run's delay is not trusted, so it raises nothing.
    expect(warningsFor({ ...base, rtlMs: 250, accepted: false })).toEqual([]);
    expect(warningsFor({ ...base, outputMode: 'bluetooth' })).toEqual(['bluetooth']);
    expect(warningsFor({ ...base, route: { inputKind: 'bluetooth' } })).toEqual(['bluetooth']);
    expect(warningsFor({ ...base, route: { inputKind: 'bluetooth' }, rtlMs: 200 })).toEqual(['bluetooth', 'delay']);
    expect(warningsFor({ ...base, route: { inputKind: 'bluetooth' }, accepted: false, rtlMs: null })).toEqual(['bluetooth']);
    expect(warningsFor({ ...base, rtlMs: 200, caps: { osFamily: 'ios' } })).toEqual(['delay']);
    expect(warningsFor({ ...base, route: { inputKind: 'bluetooth' }, caps: { osFamily: 'ios' } })).toEqual(['bluetooth', 'airpods']);
    expect(warningsFor({ ...base, aecSuspected: true })).toEqual(['aec']);
  });
  it("the owner's MacBook built-in audio (real numbers) raises no warning at all", () => {
    const mac = { outputMode: MAC_BUILT_IN.outputMode, maxRtlMs: 120, route: { inputKind: MAC_BUILT_IN.inputKind }, caps: { osFamily: MAC_BUILT_IN.osFamily }, aecSuspected: MAC_BUILT_IN.loopback.aecSuspected } as const;
    for (const rtlMs of [MAC_BUILT_IN.loopback.roundTripMs, ...MAC_BUILT_IN.rechecksMs, MAC_BUILT_IN.selfTestLoopback.rtlMs]) {
      expect(warningsFor({ ...mac, rtlMs, accepted: true }), String(rtlMs)).toEqual([]);
      expect(warningsFor({ ...mac, rtlMs, accepted: false }), String(rtlMs)).toEqual([]);
    }
    // The 2026-11-20 tries had no recognised label: an unknown input is not Bluetooth either.
    expect(warningsFor({ ...mac, route: { inputKind: 'unknown' }, rtlMs: MAC_BUILT_IN.rechecksMs[2], accepted: true })).toEqual([]);
    expect(warningsFor({ ...mac, route: null, rtlMs: MAC_BUILT_IN.loopback.roundTripMs, accepted: true })).toEqual([]);
  });
  it('the diagnostics export says which run the card showed and what it warned', () => {
    let s = calReducer(initialCalState(), { type: 'start-loopback', plan: speakerPlan() });
    s = calReducer(s, { type: 'loopback-done', outcome: loopbackOk({ rtlMs: MAC_BUILT_IN.loopback.roundTripMs, madMs: MAC_BUILT_IN.loopback.spreadMs }), warnings: [] });
    const out = JSON.parse(diagnosticsWithResult('{"kind":"audio-self-test","route":{"inputKind":"built-in"}}', s)) as Record<string, unknown>;
    expect(out['kind']).toBe('audio-self-test');
    expect(out['shown']).toEqual({ method: 'loopback', step: 'measured', accepted: true, failure: null, rtlMs: 95.48, madMs: 0.11, warnings: [] });
    expect(diagnosticsWithResult('not json', s)).toBe('not json');
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
  it('speakers: Start unlocks in the click, shows the measured delay, asks about audibility, saves and continues', async () => {
    const svc = fakeServices();
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} allowSkip />));
    expect(document.body.textContent).toContain("About 15 seconds: clicks at uneven gaps (on purpose, so an echo can't fool the timing), a short tone, then a one-bar count-in.");
    expect(names()).toEqual(['Hear the click', 'Skip for now', 'Start timing check']);
    expect(document.body.textContent).toContain('Skipped, your tries are practice until you run it.');
    act(() => button('Start timing check').click());
    // unlock was called synchronously from the click, before any await resolved.
    expect(svc.calls[0]).toBe('unlock');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(svc.calls).toEqual(['unlock', 'loopback']);
    expect(svc.saved).toHaveLength(1);
    expect(document.querySelector('[data-testid="cal-result"]')?.textContent).toContain('Measured: 42 ms. Timing marks will be fair.');
    expect(document.body.textContent).toContain('Can you hear the click clearly while you play a note?');
    expect(button('Continue').getAttribute('aria-disabled')).toBe('true');
    await press('Yes');
    click(button('Continue'));
    expect(done).toHaveBeenCalledWith('calibrated', 42);
  });
  it('Not really suggests the Woodblock or Beep sound', async () => {
    const svc = fakeServices();
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    await press('Not really');
    expect(document.body.textContent).toContain('Try the Woodblock or Beep sound, or wired headphones.');
    expect(button('Continue').getAttribute('aria-disabled')).toBeNull();
  });
  it('loopback failure leads with the count and why the alternative shows; Play along runs play-along', async () => {
    const svc = fakeServices({ loopback: [loopbackBad()], playAlong: [playAlongOk()] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    expect(document.querySelector('[data-testid="cal-fail"]')?.textContent).toBe('We heard 2 of 10 clicks, not enough to time them.');
    expect(document.body.textContent).toContain("Shown because the clicks weren't heard.");
    // The stage that failed is named under Details for support.
    expect(document.querySelector('[data-testid="cal-details"]')?.textContent).toContain("Stage 1, Timing, didn't pass.");
    expect(names()).toContain('Try the clicks again');
    await press('Play along');
    expect(svc.calls.filter((c) => c === 'playalong')).toHaveLength(1);
    expect(document.querySelector('[data-testid="cal-result"]')?.textContent).toContain('Measured: 60 ms.');
    // Play-along has no audibility question.
    expect(button('Continue').getAttribute('aria-disabled')).toBeNull();
  });
  it('headphones go straight to play-along; two failures offer Use an estimate, which never saves', async () => {
    const svc = fakeServices({ output: 'wired', playAlong: [playAlongBad(), playAlongBad()] });
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} allowSkip />));
    expect(document.body.textContent).toContain('About 10 seconds: 8 steady clicks. Play one short note on each.');
    expect([...document.querySelectorAll('.cal-stage-row')].map((r) => r.getAttribute('data-stage'))).toEqual(['play-along']);
    await press('Start timing check');
    expect(document.body.textContent).toContain("Stage 1, Play along, didn't pass.");
    // Headphones: the speaker checks did not run, and say why (under Details for support).
    const skipped = [...document.querySelectorAll('.cal-check[data-status="skipped"] .cal-check-name')].map((n) => n.textContent);
    expect(skipped).toEqual(['Pitch check', 'Clicks heard', 'Timing confirmed', 'Screen speed']);
    expect(document.body.textContent).toContain("Needs the speakers, so it doesn't run with headphones.");
    expect(names()).not.toContain('Use an estimate');
    await press('Try again');
    expect(document.body.textContent).toContain("Shown because play-along didn't work twice.");
    await press('Use an estimate');
    expect(svc.saved).toEqual([]);
    click(button('Continue'));
    expect(done).toHaveBeenCalledWith('estimate', null);
  });
  it('a long delay with no Bluetooth evidence: the measured number first, info tone, inside the result, never Bluetooth (R80)', async () => {
    const svc = fakeServices({ loopback: [loopbackOk({ rtlMs: 180, aecSuspected: true })] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    // "Bluetooth" is an option of the output select; no message names it.
    expect(document.body.textContent).not.toContain('Bluetooth adds');
    const result = document.querySelector('[data-testid="cal-result"]')!;
    const info = result.querySelector('.ui-banner-info')!;
    expect(info.textContent).toContain("Measured: 180 ms. That's longer than we can time fairly, so tries will be practice for now.");
    expect(info.textContent).not.toMatch(/XP/);
    expect(names()).toContain('Run the check again');
    expect(document.body.textContent).toContain('filtering the microphone');
  });
  it("the owner's MacBook measurement (95 ms, spread 0.1 ms) shows no warning", async () => {
    const svc = fakeServices({ loopback: [loopbackOk({ rtlMs: MAC_BUILT_IN.loopback.roundTripMs, madMs: MAC_BUILT_IN.loopback.spreadMs })] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    expect(document.querySelector('[data-testid="cal-result"]')?.textContent).toContain('95');
    // "Bluetooth" is still an option of the output select; no message names it.
    expect(document.body.textContent).not.toContain('Bluetooth audio');
    expect(document.body.textContent).not.toContain('long delay');
    expect(document.querySelectorAll('.ui-banner-caution')).toHaveLength(0);
  });
  it('Bluetooth evidence with a fair delay: no warning at all (R80)', async () => {
    const svc = fakeServices({ route: { ...route, inputKind: 'bluetooth' }, loopback: [loopbackOk({ rtlMs: 60 })] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    expect(document.body.textContent).not.toContain('Bluetooth adds');
    expect(document.querySelectorAll('.ui-banner')).toHaveLength(0);
  });
  it('Bluetooth evidence with a long delay: the cause is named in caution tone, instead of the neutral line (R80)', async () => {
    const svc = fakeServices({ route: { ...route, inputKind: 'bluetooth' }, loopback: [loopbackOk({ rtlMs: 240 })] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    const result = document.querySelector('[data-testid="cal-result"]')!;
    expect(result.querySelector('.ui-banner-caution')?.textContent).toContain("Bluetooth adds a delay we can't time fairly, so tries will be practice.");
    expect(document.body.textContent).not.toContain("That's longer than we can time fairly");
  });
  it('shownWarnings: delay alone is info; Bluetooth only with a long delay; never both', () => {
    expect(shownWarnings(['delay'])).toEqual([{ id: 'delay', tone: 'info' }]);
    expect(shownWarnings(['bluetooth'])).toEqual([]);
    expect(shownWarnings(['bluetooth', 'delay'])).toEqual([{ id: 'bluetooth', tone: 'caution' }]);
    expect(shownWarnings(['aec'])).toEqual([{ id: 'aec', tone: 'caution' }]);
  });
  describe('wizard variant (round 3 Timing stage)', () => {
    const footer = { current: null as CalFooter | null };
    const mountWizard = (svc: ReturnType<typeof fakeServices>, done = vi.fn()): void => {
      current = mount(
        wrap(
          <CalibrationCard
            variant="wizard"
            allowSkip
            services={svc}
            onDone={done}
            renderFooter={(f) => {
              footer.current = f;
              return (
                <div data-testid="footer">
                  {f.skip ? <button type="button" onClick={f.skip.onClick}>{f.skip.label}</button> : null}
                  {f.primary ? <button type="button" aria-disabled={f.primary.disabled ? 'true' : undefined} onClick={f.primary.onClick}>{f.primary.label}</button> : null}
                </div>
              );
            }}
          />,
        ),
      );
    };
    it('idle: the output, the preview, Start timing check and Skip for now in the footer; details hold the device select', () => {
      mountWizard(fakeServices());
      expect(document.body.textContent).toContain('Sound comes from');
      expect(footer.current?.primary?.label).toBe('Start timing check');
      expect(footer.current?.skip?.label).toBe('Skip for now');
      expect(footer.current?.note).toBe('Skipped, your tries are practice until you run it.');
      expect(document.querySelector('[data-testid="cal-details"] summary')?.textContent).toBe('Details for support');
      expect(document.querySelector('[data-testid="cal-details"]')?.textContent).toContain('Input device');
      // Export diagnostics is never at the top level.
      expect(names().filter((n) => n === 'Export diagnostics')).toHaveLength(0);
    });
    it('a pass says the measured number and Next finishes with it', async () => {
      const done = vi.fn();
      mountWizard(fakeServices({ output: 'wired', playAlong: [playAlongOk()] }), done);
      await press('Start timing check');
      expect(document.querySelector('[data-testid="cal-result"]')?.textContent).toMatch(/Measured: \d+ ms\. Timing marks will be fair\./);
      await press('Next');
      expect(done).toHaveBeenCalledWith('calibrated', expect.any(Number));
    });
    it('a failed loopback leads with the count and why the alternative shows, and the footer tries the clicks again', async () => {
      mountWizard(fakeServices({ loopback: [loopbackBad()] }));
      await press('Start timing check');
      expect(document.querySelector('[data-testid="cal-fail"]')?.textContent).toBe('We heard 2 of 10 clicks, not enough to time them.');
      expect(document.body.textContent).toContain("Shown because the clicks weren't heard.");
      expect(document.querySelector('[data-testid="cal-play-along"]')?.textContent).toContain('Play along instead');
      expect(footer.current?.primary?.label).toBe('Try the clicks again');
    });
    it('the mandatory path (R16) has no skip', () => {
      mountWizard(fakeServices({ caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongOk()] }));
      expect(footer.current?.skip).toBeNull();
    });
  });
  it('iOS: beta label, XP note, no Skip control (R16), and a failed run never traps the player', async () => {
    const svc = fakeServices({ caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongBad(), playAlongBad()] });
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} allowSkip />));
    expect(document.body.textContent).toContain('iOS: beta');
    expect(document.body.textContent).toContain('On iPhone and iPad, tries earn XP only after this check.');
    expect(names()).not.toContain('Skip for now');
    await press('Start timing check');
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
    act(() => button('Start timing check').click());
    expect(svc.stops).toBeGreaterThan(0);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(names()).not.toContain('Hear the click');
    expect(document.body.textContent).toContain('Device choice is locked while we listen.');
    expect(document.body.textContent).toContain('0 of 10 clicks heard');
    expect([...document.querySelectorAll('select')].every((x) => x.closest('[aria-disabled="true"]') !== null || x.disabled || x.getAttribute('aria-disabled') === 'true')).toBe(true);
    // The mark of the click that has sounded is lit; the others wait.
    expect(document.querySelectorAll('.cal-dots')[0]!.querySelectorAll('.cal-dot[data-state="sounding"], .cal-dot[data-state="heard"]')).toHaveLength(1);
    await act(async () => {
      release(loopbackOk());
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(names()).toContain('Hear the click');
    expect(document.body.textContent).not.toContain('Device choice is locked');
  });
  it('Skip is available where allowed', async () => {
    const svc = fakeServices();
    const done = vi.fn();
    current = mount(wrap(<CalibrationCard services={svc} onDone={done} allowSkip />));
    click(button('Skip for now'));
    expect(done).toHaveBeenCalledWith('skipped');
  });
  it('a thrown run reads as a failure with a retry', async () => {
    const svc = fakeServices();
    svc.runLoopback = () => Promise.reject(new Error('no audio'));
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    await press('Start timing check');
    expect(document.body.textContent).toContain("The audio check couldn't run. Try again.");
    expect(names()).toContain('Try the clicks again');
  });
  it('changing output resets the card and stores the preference', async () => {
    const svc = fakeServices();
    current = mount(wrap(<CalibrationCard services={svc} onDone={() => undefined} />));
    const sel = document.querySelector<HTMLSelectElement>('select[aria-label="Sound comes from"]');
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
    await press('Start timing check');
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
    await press('Start timing check');
    expect(document.body.textContent).toContain('Measured: 42 ms. Timing marks will be fair.');
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
    // The export carries what the card showed (round 3), next to the self-test's own fields.
    expect(svc.exported.map((j) => JSON.parse(j) as unknown)).toEqual([{ kind: 'audio-self-test', shown: { method: 'loopback', step: 'measured', accepted: true, failure: null, rtlMs: 42, madMs: 2, warnings: [] } }]);
    // There is no separate audio-check card or button: it ran with the calibration.
    expect(names()).not.toContain('Check audio');
    await press('Calibrate again');
    expect(svc.calls.filter((c) => c === 'loopback')).toHaveLength(2);
  });
});

describe('#/calibrate exits (round 3, 01-ux-review problem 10)', () => {
  it('Back and Continue return to where the player came from: Home by default, Settings > Sound from Settings', () => {
    expect(calibrateReferrer('#/calibrate')).toEqual({ path: '/', label: 'Home' });
    expect(calibrateReferrer('#/calibrate?from=home')).toEqual({ path: '/', label: 'Home' });
    expect(calibrateReferrer('#/calibrate?from=settings')).toEqual({ path: '/settings/audio', label: 'Settings' });
  });
});
