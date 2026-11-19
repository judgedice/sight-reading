// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import instrumentsJson from '../../../../config/instruments.json';
import type { Instrument } from '../../../core/types.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { fakeServices, playAlongOk } from '../calibration/test-services.ts';
import { initialOnboarding, onboardingReducer } from './flow.ts';
import { MIC_GRANTED_HOLD_MS, OnboardingScreen } from './OnboardingScreen.tsx';
import { OnboardingServicesProvider, type MicOutcome, type OnboardingResult, type OnboardingServices } from './services.ts';
import type { ScreenProps } from '../../route-types.ts';

const instruments = (instrumentsJson as unknown as { instruments: Instrument[] }).instruments;

const nav = vi.fn();
const source: LocationSource = { getHash: () => '#/welcome', subscribe: () => () => undefined, navigate: (p, r) => nav(p, r) };
const screenProps = { route: { def: createRouteTable().find((r) => r.id === 'welcome'), path: '/welcome', params: {} } } as unknown as ScreenProps;

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  nav.mockReset();
});

const button = (name: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === name);
  if (!b) throw new Error(`no button ${name}; have ${[...document.querySelectorAll('button')].map((x) => x.textContent).join('|')}`);
  return b;
};
const settle = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
const names = (): string[] => [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
let clicks = 0;
const press = async (name: string): Promise<void> => {
  clicks++;
  await act(async () => {
    button(name).click();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function services(o: { mic?: MicOutcome; caps?: Parameters<typeof fakeServices>[0] } = {}) {
  const cal = fakeServices({ output: 'wired', playAlong: [playAlongOk()], ...(o.caps ?? {}) });
  const finished: OnboardingResult[] = [];
  const requestMic = vi.fn(() => Promise.resolve(o.mic ?? { ok: true as const }));
  const svc: OnboardingServices = {
    capabilities: cal.capabilities,
    instruments,
    initial: { instrumentId: 'flute', showBeta: false },
    placement: { excerpts: 3, minutes: 3 },
    levelCount: 10,
    levelDescription: (l) => `Level ${l} description`,
    micBrowser: 'chrome',
    requestMic,
    calibration: cal,
    finish: async (r) => {
      finished.push(r);
      return r.level.kind === 'placement' ? '/practice/scan?placement=1' : '/';
    },
  };
  return { svc, cal, finished, requestMic };
}

function render(svc: OnboardingServices): void {
  current = mount(
    <RouterProvider table={createRouteTable()} source={source}>
      <OnboardingServicesProvider value={svc}>
        <OnboardingScreen {...screenProps} />
      </OnboardingServicesProvider>
    </RouterProvider>,
  );
}

describe('flow', () => {
  it('walks forward and Back retraces the steps taken', () => {
    let s = initialOnboarding();
    s = onboardingReducer(s, { type: 'next' });
    s = onboardingReducer(s, { type: 'next' });
    expect(s.step).toBe(3);
    s = onboardingReducer(s, { type: 'mic-skip' });
    expect(s.step).toBe(5);
    expect(s.mic).toBe('declined');
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe(3);
    s = onboardingReducer(s, { type: 'mic-granted' });
    expect(s.step).toBe(3);
    expect(s.mic).toBe('granted');
    s = onboardingReducer(s, { type: 'mic-continue' });
    expect(s.step).toBe(4);
    s = onboardingReducer(s, { type: 'calibration-done', result: 'skipped' });
    expect(s.step).toBe(5);
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe(4);
  });
  it('a mic problem keeps step 3; events from other steps are ignored', () => {
    let s = onboardingReducer(onboardingReducer(initialOnboarding(), { type: 'next' }), { type: 'next' });
    s = onboardingReducer(s, { type: 'mic-problem', problem: 'denied' });
    expect(s.step).toBe(3);
    expect(s.mic).toBe('denied');
    expect(onboardingReducer(initialOnboarding(), { type: 'mic-granted' }).step).toBe(1);
  });
});

describe('OnboardingScreen', () => {
  it('without services it stays a labelled stand-in', () => {
    current = mount(
      <RouterProvider table={createRouteTable()} source={source}>
        <OnboardingScreen {...screenProps} />
      </RouterProvider>,
    );
    expect(document.querySelector('[data-testid="screen-welcome"]')).not.toBeNull();
  });

  it('completes in at most 6 clicks with defaults and never prompts for the mic before step 3', async () => {
    clicks = 0;
    const { svc, requestMic, finished } = services();
    render(svc);
    expect(document.body.textContent).not.toContain('Step 1 of 5');
    expect(document.body.textContent).toContain('Read it. Play it. See how it went.');
    expect(document.querySelector('input[type=text]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Get started');
    await press('Get started');
    expect(document.body.textContent).toContain('Step 2 of 5');
    expect(requestMic).not.toHaveBeenCalled();
    await press('Continue'); // flute is preselected
    expect(document.body.textContent).toContain('Step 3 of 5');
    expect(requestMic).not.toHaveBeenCalled();
    await press('Allow microphone');
    expect(requestMic).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Microphone is on.');
    expect(document.body.textContent).toContain('Step 3 of 5');
    await settle(MIC_GRANTED_HOLD_MS + 50);
    expect(document.body.textContent).toContain('Step 4 of 5');
    await press('Skip');
    expect(document.body.textContent).toContain('Step 5 of 5');
    await press('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(clicks).toBeLessThanOrEqual(6);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ displayName: 'Player', instrumentId: 'flute', micAllowed: true, calibration: 'skipped', level: { kind: 'placement' } });
    expect(nav).toHaveBeenCalledWith('/practice/scan?placement=1', true);
  });

  it('instrument cards are one radio group with the range in text and the transposition line', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    const radios = [...document.querySelectorAll<HTMLElement>('[role=radio]')];
    expect(radios).toHaveLength(13);
    expect(document.querySelectorAll('[role=radiogroup]')).toHaveLength(1);
    expect(radios.find((r) => r.dataset.instrument === 'flute')?.getAttribute('aria-checked')).toBe('true');
    expect(document.body.textContent).toContain('Sounds a major 2nd lower');
    expect(document.body.textContent).toContain('Written an octave higher');
    expect(document.querySelector('[data-testid="picked-range"]')?.textContent).toContain('Flute');
    const clarinet = radios.find((r) => r.dataset.instrument === 'clarinet-bb') as HTMLElement;
    act(() => clarinet.click());
    expect(clarinet.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-testid="picked-range"]')?.textContent).toContain('Clarinet');
    await press('Continue');
    await press('Not now');
    expect(document.body.textContent).toContain('Step 5 of 5');
    await press("I'll choose");
    expect(document.querySelector('[data-testid="ob-level"]')?.textContent).toContain('Level 2 description');
    await press('Start practising');
    expect(finished[0]).toMatchObject({ instrumentId: 'clarinet-bb', micAllowed: false, calibration: null, level: { kind: 'level', level: 2 } });
    expect(nav).toHaveBeenCalledWith('/', true);
  });

  it('picks Baritone with the keyboard and finishes with voice-baritone', async () => {
    const { svc, finished } = services();
    svc.initial.instrumentId = 'voice-tenor';
    render(svc);
    await press('Get started');
    const card = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-instrument="${id}"]`) as HTMLElement;
    act(() => card('voice-tenor').focus());
    act(() => {
      card('voice-tenor').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(card('voice-baritone').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(card('voice-baritone'));
    expect(card('voice-baritone').getAttribute('aria-label')).toBe('Baritone voice, range G2 to G4');
    expect(document.querySelector('[data-testid="picked-range"]')?.textContent).toContain('Baritone voice');
    await press('Continue');
    await press('Not now');
    await press("I'll choose");
    await press('Start practising');
    expect(finished[0]).toMatchObject({ instrumentId: 'voice-baritone' });
  });

  it('beta toggle shows beta cards with a badge', async () => {
    const { svc } = services();
    render(svc);
    await press('Get started');
    const sw = document.querySelector<HTMLInputElement>('input[role=switch]') as HTMLInputElement;
    act(() => sw.click());
    expect(document.querySelectorAll('[role=radio]').length).toBe(instruments.length);
    expect(document.body.textContent).toContain('less tested');
  });

  it('a denied microphone shows the denied card inline with Try again and Practise without listening', async () => {
    const { svc, requestMic } = services({ mic: { ok: false, problem: 'denied' } });
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    expect(document.body.textContent).toContain("Microphone is blocked. The app can't hear you play.");
    expect(names()).toContain('Try again');
    await press('Try again');
    expect(requestMic).toHaveBeenCalledTimes(2);
    await press('Continue without the microphone');
    expect(document.body.textContent).toContain('Step 5 of 5');
  });

  it.each([
    ['no-device', "We can't find a microphone.", true],
    ['busy', 'Another app is using the microphone.', true],
    ['insecure', 'The microphone only works on a secure (https) page.', false],
  ] as const)('a %s microphone shows its card with Continue without the microphone', async (problem, line, retry) => {
    const { svc } = services({ mic: { ok: false, problem } });
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    expect(document.querySelector(`[data-testid="mic-${problem}"]`)?.textContent).toContain(line);
    expect(names().includes('Try again')).toBe(retry);
    expect(names()).toContain('Continue without the microphone');
  });

  it('the microphone step says takes will not be graded under Not now', async () => {
    const { svc } = services();
    render(svc);
    await press('Get started');
    await press('Continue');
    expect(document.body.textContent).toContain("You can still practise, but takes won't be graded.");
  });

  it('without the microphone, placement says it needs it and cannot be chosen; I\'ll choose is open', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Not now');
    expect(document.body.textContent).toContain('Needs the microphone.');
    const placement = button('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(placement.getAttribute('aria-disabled')).toBe('true');
    await press('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(finished).toHaveLength(0);
    expect(document.querySelector('[data-testid="ob-level"] [role=group]')).not.toBeNull();
    expect(document.querySelector('[data-testid="picked-range"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Follow my progress');
  });

  it('Back returns to the previous step; the name defaults and there is no name field', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    await press('Back');
    expect(document.body.textContent).toContain('Read it. Play it.');
    await press('Get started');
    await press('Continue');
    await press('Not now');
    await press("I'll choose");
    await press('Start practising');
    expect(finished[0]?.displayName).toBe('Player');
  });

  it('calibration is the step card itself and shows the skip hint under Skip', async () => {
    const { svc } = services();
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    await settle(MIC_GRANTED_HOLD_MS + 50);
    const step = document.querySelector('[data-testid="ob-calibration"]') as HTMLElement;
    expect(step.querySelectorAll('.ui-card')).toHaveLength(1);
    expect(step.textContent).toContain('Without calibration, takes on this device are practice only.');
  });

  it('iOS with unreported latency: calibration step has no Skip control', async () => {
    const { svc } = services({ caps: { caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongOk()] } });
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    await settle(MIC_GRANTED_HOLD_MS + 50);
    expect(document.body.textContent).toContain('Step 4 of 5');
    expect(names()).not.toContain('Skip');
    expect(document.body.textContent).not.toContain('Without calibration');
    expect(names()).toContain('Start');
  });

  it('calibrating moves on with the result', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    await settle(MIC_GRANTED_HOLD_MS + 50);
    await press('Start');
    await press('Continue');
    expect(document.body.textContent).toContain('Step 5 of 5');
    await press('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(finished[0]?.calibration).toBe('calibrated');
  });
});
