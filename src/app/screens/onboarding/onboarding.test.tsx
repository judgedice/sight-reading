// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import instrumentsJson from '../../../../config/instruments.json';
import type { Instrument } from '../../../core/types.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { fakeServices, playAlongOk } from '../calibration/test-services.ts';
import { initialOnboarding, onboardingReducer } from './flow.ts';
import { groupInstruments, transpositionLine } from './instruments.ts';
import { OnboardingScreen } from './OnboardingScreen.tsx';
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

describe('instruments', () => {
  it('launch instruments only by default, grouped Voice, Woodwinds, Brass, Strings, Keyboard', () => {
    const g = groupInstruments(instruments, false);
    expect(g.map((x) => x.group)).toEqual(['voice', 'woodwinds', 'brass', 'strings', 'keyboard']);
    expect(g.flatMap((x) => x.items).every((i) => i.status === 'launch')).toBe(true);
    expect(g[0]?.items.map((i) => i.id)).toEqual(['voice-soprano', 'voice-alto', 'voice-tenor', 'voice-bass']);
    expect(g.flatMap((x) => x.items)).toHaveLength(11);
  });
  it('beta toggle reveals beta instruments', () => {
    const all = groupInstruments(instruments, true).flatMap((x) => x.items);
    expect(all.length).toBe(instruments.length);
    expect(all.some((i) => i.status === 'beta')).toBe(true);
  });
  it('transposition line for B-flat and E-flat instruments only', () => {
    const by = (id: string) => instruments.find((i) => i.id === id) as (typeof instruments)[number];
    expect(transpositionLine(by('clarinet-bb'))).toBe('B♭: sounds a major 2nd lower');
    expect(transpositionLine(by('sax-alto'))).toBe('E♭: sounds a major 6th lower');
    expect(transpositionLine(by('flute'))).toBeNull();
    expect(transpositionLine(by('voice-tenor'))).toBeNull();
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
    expect(document.body.textContent).toContain('Step 1 of 5');
    expect(document.body.textContent).toContain('Read it. Play it. See how it went.');
    await press('Get started');
    expect(document.body.textContent).toContain('Step 2 of 5');
    expect(requestMic).not.toHaveBeenCalled();
    await press('Continue'); // flute is preselected
    expect(document.body.textContent).toContain('Step 3 of 5');
    expect(requestMic).not.toHaveBeenCalled();
    await press('Allow microphone');
    expect(requestMic).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Step 4 of 5');
    await press('Skip');
    expect(document.body.textContent).toContain('Step 5 of 5');
    await press('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(clicks).toBeLessThanOrEqual(6);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ displayName: 'Player', instrumentId: 'flute', micAllowed: true, calibration: 'skipped', level: { kind: 'placement' } });
    expect(nav).toHaveBeenCalledWith('/practice/scan?placement=1', true);
  });

  it('instrument cards are a radio group with abbreviations and the transposition line', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(radios).toHaveLength(11);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.find((r) => r.value === 'flute')?.checked).toBe(true);
    expect(document.body.textContent).toContain('A.Sx');
    expect(document.body.textContent).toContain('B♭: sounds a major 2nd lower');
    const clarinet = radios.find((r) => r.value === 'clarinet-bb') as HTMLInputElement;
    act(() => clarinet.click());
    expect(clarinet.checked).toBe(true);
    await press('Continue');
    await press('Not now');
    expect(document.body.textContent).toContain('Step 5 of 5');
    await press("I'll choose");
    expect(document.querySelector('[data-testid="ob-level-description"]')?.textContent).toBe('Level 2 description');
    await press('Start practising');
    expect(finished[0]).toMatchObject({ instrumentId: 'clarinet-bb', micAllowed: false, calibration: null, level: { kind: 'level', level: 2 } });
    expect(nav).toHaveBeenCalledWith('/', true);
  });

  it('beta toggle shows beta cards with a badge', async () => {
    const { svc } = services();
    render(svc);
    await press('Get started');
    const sw = document.querySelector<HTMLInputElement>('input[role=switch]') as HTMLInputElement;
    act(() => sw.click());
    expect(document.querySelectorAll('input[type=radio]').length).toBe(instruments.length);
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
    await press('Practise without listening');
    expect(document.body.textContent).toContain('Step 5 of 5');
  });

  it('Back returns to the previous step and a typed name is kept', async () => {
    const { svc, finished } = services();
    render(svc);
    const input = document.querySelector<HTMLInputElement>('input[type=text]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, 'Ada');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('Get started');
    await press('Back');
    expect(document.body.textContent).toContain('Step 1 of 5');
    await press('Get started');
    await press('Continue');
    await press('Not now');
    await press('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(finished[0]?.displayName).toBe('Ada');
  });

  it('iOS with unreported latency: calibration step has no Skip control', async () => {
    const { svc } = services({ caps: { caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongOk()] } });
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    expect(document.body.textContent).toContain('Step 4 of 5');
    expect(names()).not.toContain('Skip');
    expect(names()).toContain('Start');
  });

  it('calibrating moves on with the result', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    await press('Start');
    await press('Continue');
    expect(document.body.textContent).toContain('Step 5 of 5');
    await press('Find my difficulty (3 short excerpts, about 3 minutes)');
    expect(finished[0]?.calibration).toBe('calibrated');
  });
});
