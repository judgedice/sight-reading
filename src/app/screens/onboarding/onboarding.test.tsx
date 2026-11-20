// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import instrumentsJson from '../../../../config/instruments.json';
import type { Instrument } from '../../../core/types.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { fakeServices, playAlongOk } from '../calibration/test-services.ts';
import { initialOnboarding, onboardingReducer, STEP_COUNT } from './flow.ts';
import { MIC_GRANTED_HOLD_MS, OnboardingScreen } from './OnboardingScreen.tsx';
import { OnboardingServicesProvider, type MicOutcome, type OnboardingResult, type OnboardingServices } from './services.ts';
import type { ScreenProps } from '../../route-types.ts';
import type { MatchNoteService } from '../../../session/index.ts';
import { appConfigs } from '../../compose/configs.ts';
import { at, FakeEngine } from '../match/match-test-kit.ts';
import type { MatchFrame } from '../../../session/index.ts';

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

function services(o: { mic?: MicOutcome; caps?: Parameters<typeof fakeServices>[0]; match?: boolean } = {}) {
  const cal = fakeServices({ output: 'wired', playAlong: [playAlongOk()], ...(o.caps ?? {}) });
  const finished: OnboardingResult[] = [];
  const requestMic = vi.fn(() => Promise.resolve(o.mic ?? { ok: true as const }));
  const engine = new FakeEngine();
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
    ...(o.match === false ? {} : { match: { service: engine as unknown as MatchNoteService, cfg: appConfigs(), micAllowed: () => Promise.resolve(true), requestMic } }),
    finish: async (r) => {
      finished.push(r);
      return r.level.kind === 'placement' ? '/practice/scan?placement=1' : '/';
    },
  };
  return { svc, cal, finished, requestMic, engine };
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
    expect(s.step).toBe(6);
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
    s = onboardingReducer(s, { type: 'match-done' });
    expect(s.step).toBe(6);
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe(5);
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe(4);
  });
  it('has 6 steps; without the match engine calibration goes straight to the difficulty', () => {
    expect(STEP_COUNT).toBe(6);
    let s = initialOnboarding({ match: false });
    for (const e of [{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }, { type: 'mic-continue' }] as const) s = onboardingReducer(s, e);
    expect(s.step).toBe(4);
    expect(onboardingReducer(s, { type: 'calibration-done', result: 'skipped' }).step).toBe(6);
    // match-done only acts on the note step.
    expect(onboardingReducer(s, { type: 'match-done' }).step).toBe(4);
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
    expect(document.body.textContent).not.toContain('Step 1 of 6');
    expect(document.body.textContent).toContain('Read it. Play it. See how it went.');
    expect(document.querySelector('input[type=text]')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Get started');
    await press('Get started');
    expect(document.body.textContent).toContain('Step 2 of 6');
    expect(requestMic).not.toHaveBeenCalled();
    await press('Continue'); // flute is preselected
    expect(document.body.textContent).toContain('Step 3 of 6');
    expect(requestMic).not.toHaveBeenCalled();
    await press('Allow microphone');
    expect(requestMic).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Microphone is on.');
    expect(document.body.textContent).toContain('Step 3 of 6');
    await settle(MIC_GRANTED_HOLD_MS + 50);
    expect(document.body.textContent).toContain('Step 4 of 6');
    await press('Skip');
    expect(document.body.textContent).toContain('Step 5 of 6');
    expect(document.body.textContent).toContain('Play one note');
    await press('Skip');
    expect(document.body.textContent).toContain('Step 6 of 6');
    await press('Find my difficulty (3 short pieces, about 3 minutes)');
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
    expect(document.body.textContent).toContain('Step 6 of 6');
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
    expect(document.body.textContent).toContain('Step 6 of 6');
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
    expect(document.body.textContent).toContain("You can still practise, but tries won't be graded.");
  });

  it('without the microphone, placement says it needs it and cannot be chosen; I\'ll choose is open', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Not now');
    expect(document.body.textContent).toContain('Needs the microphone.');
    const placement = button('Find my difficulty (3 short pieces, about 3 minutes)');
    expect(placement.getAttribute('aria-disabled')).toBe('true');
    await press('Find my difficulty (3 short pieces, about 3 minutes)');
    expect(finished).toHaveLength(0);
    expect(document.querySelector('[data-testid="ob-level"] [role=group]')).not.toBeNull();
    expect(document.querySelector('[data-testid="picked-range"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Follow my progress');
    // The stepper above already says the difficulty: the picture repeats neither the instrument name nor "Difficulty N".
    const picked = document.querySelector('[data-testid="ob-level"] [data-testid="picked-range"]')!;
    expect(picked.querySelector('.pk-picked-head')).toBeNull();
    expect(picked.querySelector('figure')).not.toBeNull();
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
    expect(step.textContent).toContain('Without calibration, tries on this device are practice only.');
  });

  it('iOS with unreported latency: calibration step has no Skip control', async () => {
    const { svc } = services({ caps: { caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongOk()] } });
    render(svc);
    await press('Get started');
    await press('Continue');
    await press('Allow microphone');
    await settle(MIC_GRANTED_HOLD_MS + 50);
    expect(document.body.textContent).toContain('Step 4 of 6');
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
    expect(document.body.textContent).toContain('Step 5 of 6');
    await press('Skip');
    expect(document.body.textContent).toContain('Step 6 of 6');
    await press('Find my difficulty (3 short pieces, about 3 minutes)');
    expect(finished[0]?.calibration).toBe('calibrated');
  });

  describe('Sing one note / Play one note', () => {
    /** Sends `ms` of frames on the engine's clock, 20 ms apart. Hits come from frames alone, so no timers run. */
    const sing = async (engine: FakeEngine, ms: number, frame: (e: FakeEngine) => Omit<MatchFrame, 't' | 'levelDb'>): Promise<void> => {
      await act(async () => {
        for (let left = ms; left > 0; left -= 20) {
          engine.clock += 20;
          engine.emit(frame(engine));
        }
        await Promise.resolve();
      });
    };
    const toMatchStep = async (svc: OnboardingServices): Promise<void> => {
      render(svc);
      await press('Get started');
      await press('Continue');
      await press('Allow microphone');
      await settle(MIC_GRANTED_HOLD_MS + 50);
      await press('Skip');
      await settle(0);
    };

    it('comes after calibration as step 5 of 6, plays one note and listens, with Skip and no range chips', async () => {
      const { svc, engine } = services();
      svc.initial.instrumentId = 'voice-baritone';
      await toMatchStep(svc);
      expect(document.body.textContent).toContain('Step 5 of 6');
      expect(document.querySelector('.ob-head-title')?.textContent).toBe('Sing one note');
      expect(document.activeElement).toBe(document.querySelector('.ob-head-title'));
      expect(document.body.textContent).toContain('A quick check that we hear you. Not graded.');
      expect(engine.played).toHaveLength(1);
      expect(engine.listening).toBe(true);
      expect(names()).toContain('Skip');
      expect(names()).toContain('Play it again');
      expect(names()).not.toContain('Continue');
      expect(document.querySelector('.mt-chip')).toBeNull();
    });

    it('after a hit it offers Continue and never moves on by itself', async () => {
      const { svc, engine, finished } = services();
      await toMatchStep(svc);
      expect(document.querySelector('.ob-head-title')?.textContent).toBe('Play one note');
      await sing(engine, 1000, at(4));
      expect(document.querySelector('[data-testid="match-line"]')?.textContent).toBe("We heard you clearly. You're ready.");
      expect(names()).toContain('Continue');
      // Ten seconds later on the engine's clock, with the screen's ticks running: still the note step.
      engine.clock += 10_000;
      await settle(350);
      expect(document.body.textContent).toContain('Step 5 of 6');
      expect(engine.played).toHaveLength(1);
      // Play it again keeps Continue.
      await press('Play it again');
      expect(engine.played).toHaveLength(2);
      expect(names()).toContain('Continue');
      await press('Continue');
      expect(document.body.textContent).toContain('Step 6 of 6');
      await press('Back');
      expect(document.body.textContent).toContain('Step 5 of 6');
      await press('Skip');
      await press('Find my difficulty (3 short pieces, about 3 minutes)');
      expect(finished[0]).toMatchObject({ instrumentId: 'flute', micAllowed: true });
    });

    it('a baritone whose notes sit above the range is offered the tenor, and choosing it restarts on the tenor', async () => {
      const { svc, engine, finished } = services();
      svc.initial.instrumentId = 'voice-baritone';
      await toMatchStep(svc);
      await sing(engine, 2500, (e) => ({ midi: e.target + 6, cents: 0, steady: true }));
      const offer = document.querySelector('[data-testid="ob-other-voice"]');
      expect(offer?.textContent).toContain('Your notes sat above the baritone range. Would tenor fit better?');
      await press('Choose Tenor');
      expect(document.querySelector('[data-testid="ob-other-voice"]')).toBeNull();
      expect(engine.played).toHaveLength(2);
      await press('Skip');
      await press('Find my difficulty (3 short pieces, about 3 minutes)');
      expect(finished[0]).toMatchObject({ instrumentId: 'voice-tenor' });
    });

    it('without the microphone the note step is left out', async () => {
      const { svc } = services();
      render(svc);
      await press('Get started');
      await press('Continue');
      await press('Not now');
      expect(document.body.textContent).toContain('Step 6 of 6');
      expect(document.querySelector('[data-testid="ob-match"]')).toBeNull();
    });

    it('without the match engine calibration goes to the difficulty', async () => {
      const { svc } = services({ match: false });
      render(svc);
      await press('Get started');
      await press('Continue');
      await press('Allow microphone');
      await settle(MIC_GRANTED_HOLD_MS + 50);
      await press('Skip');
      expect(document.body.textContent).toContain('Step 6 of 6');
    });

    it('leaving the step stops the engine', async () => {
      const { svc, engine } = services();
      await toMatchStep(svc);
      const before = engine.stops;
      await press('Skip');
      expect(engine.stops).toBeGreaterThan(before);
    });
  });
});
