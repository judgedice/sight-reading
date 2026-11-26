// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import instrumentsJson from '../../../../config/instruments.json';
import type { Instrument } from '../../../core/types.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { fakeServices, playAlongOk } from '../calibration/test-services.ts';
import {
  initialOnboarding,
  onboardingReducer,
  progressOf,
  restoreProgress,
  resumeState,
  stageStatuses,
  STEP_COUNT,
  WIZARD_STEPS,
  type OnboardingEvent,
  type OnboardingProgress,
  type OnboardingState,
} from './flow.ts';
import { hearReducer, initialHear, type HearFrame } from './hear-model.ts';
import { OnboardingScreen } from './OnboardingScreen.tsx';
import { OnboardingServicesProvider, type MicOutcome, type OnboardingResult, type OnboardingServices } from './services.ts';
import type { ScreenProps } from '../../route-types.ts';
import type { MatchFrame } from '../../../session/index.ts';
import { appConfigs } from '../../compose/configs.ts';

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

const $ = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const button = (name: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === name);
  if (!b) throw new Error(`no button ${name}; have ${[...document.querySelectorAll('button')].map((x) => x.textContent).join('|')}`);
  return b;
};
const names = (): string[] => [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
const text = (): string => document.body.textContent ?? '';
const press = async (name: string): Promise<void> => {
  await act(async () => {
    button(name).click();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const pick = (id: string): void => act(() => document.querySelector<HTMLElement>(`[data-instrument="${id}"]`)?.click());

/** "Hear you"'s engine: listens with no target and records stops. */
class HearEngine {
  clock = 0;
  listens: string[] = [];
  stops = 0;
  private sink: ((f: MatchFrame) => void) | null = null;
  nowMs(): number {
    return this.clock;
  }
  listenAny(instrumentId: string, onFrame: (f: MatchFrame) => void): Promise<void> {
    this.listens.push(instrumentId);
    this.sink = onFrame;
    return Promise.resolve();
  }
  stop(): void {
    this.stops++;
    this.sink = null;
  }
  get listening(): boolean {
    return this.sink !== null;
  }
  /** `ms` of frames 20 ms apart at a steady note. */
  async sing(ms: number, midi: number | null, o: { steady?: boolean; levelDb?: number } = {}): Promise<void> {
    await act(async () => {
      for (let left = ms; left > 0; left -= 20) {
        this.clock += 20;
        this.sink?.({ t: this.clock, midi, cents: 0, levelDb: o.levelDb ?? -24, steady: o.steady ?? true } as unknown as MatchFrame);
      }
      await Promise.resolve();
    });
  }
}

function services(o: { mic?: MicOutcome; caps?: Parameters<typeof fakeServices>[0]; match?: boolean; progress?: unknown } = {}) {
  const cal = fakeServices({ output: 'wired', playAlong: [playAlongOk()], ...(o.caps ?? {}) });
  const finished: OnboardingResult[] = [];
  const saved: (OnboardingProgress | null)[] = [];
  const requestMic = vi.fn(() => Promise.resolve(o.mic ?? { ok: true as const }));
  const engine = new HearEngine();
  const svc: OnboardingServices = {
    capabilities: cal.capabilities,
    instruments,
    initial: { instrumentId: null, showBeta: false },
    progress: o.progress ?? null,
    saveProgress: (p) => saved.push(p),
    placement: { excerpts: 3, minutes: 3 },
    levelCount: 10,
    levelDescription: (l) => `Level ${l} description`,
    micBrowser: 'chrome',
    requestMic,
    calibration: cal,
    ...(o.match === false ? {} : { match: { service: engine, cfg: appConfigs(), micAllowed: () => Promise.resolve(true), requestMic } }),
    finish: async (r) => {
      finished.push(r);
      return r.start === 'first-piece' ? '/practice/scan' : '/';
    },
  };
  return { svc, cal, finished, saved, requestMic, engine };
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

const run = (events: readonly OnboardingEvent[], s: OnboardingState = initialOnboarding()): OnboardingState => events.reduce(onboardingReducer, s);

describe('flow (R74)', () => {
  it('Welcome is not counted: three steps in order, Instrument, Sound check, Ready', () => {
    expect(STEP_COUNT).toBe(3);
    expect(WIZARD_STEPS).toEqual(['instrument', 'sound', 'ready']);
    const s = run([{ type: 'next' }, { type: 'next' }]);
    expect(s).toMatchObject({ step: 'sound', stage: 'mic' });
  });

  it('the microphone opens Hear you on the same step; Hear you then Timing; Timing done opens Ready', () => {
    let s = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-requesting' }, { type: 'mic-granted' }]);
    expect(s).toMatchObject({ step: 'sound', stage: 'hear', mic: 'granted' });
    s = onboardingReducer(s, { type: 'hear-done' });
    expect(s).toMatchObject({ step: 'sound', stage: 'timing', hear: 'heard' });
    s = onboardingReducer(s, { type: 'calibration-done', result: 'calibrated', ms: 95 });
    expect(s).toMatchObject({ step: 'ready', timing: 'calibrated', timingMs: 95 });
  });

  it('Back goes one stage back inside Sound check, then one step back', () => {
    let s = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }, { type: 'hear-skip' }]);
    expect(s.stage).toBe('timing');
    s = onboardingReducer(s, { type: 'back' });
    expect(s).toMatchObject({ step: 'sound', stage: 'hear' });
    s = onboardingReducer(s, { type: 'back' });
    expect(s).toMatchObject({ step: 'sound', stage: 'mic' });
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe('instrument');
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe('welcome');
  });

  it('"Not now": Ready with Hear you and Timing needing the microphone (ruling 13 stands)', () => {
    const s = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-skip' }]);
    expect(s).toMatchObject({ step: 'ready', mic: 'declined', hear: 'n/a', timing: 'n/a' });
    expect(stageStatuses(s)).toEqual({ mic: 'skipped', hear: 'needs-mic', timing: 'needs-mic' });
    // Back from Ready asks again; allowing it reopens the stages.
    const again = run([{ type: 'back' }, { type: 'mic-granted' }], s);
    expect(again).toMatchObject({ step: 'sound', stage: 'hear', hear: 'pending', timing: null });
  });

  it('Timing skipped means practice until calibrated; the mandatory path (R16) cannot skip it', () => {
    const at = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }, { type: 'hear-skip' }]);
    expect(onboardingReducer(at, { type: 'calibration-done', result: 'skipped' })).toMatchObject({ step: 'ready', timing: 'skipped' });
    const ios = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }, { type: 'hear-skip' }], initialOnboarding({ mandatory: true }));
    expect(onboardingReducer(ios, { type: 'calibration-done', result: 'skipped' })).toBe(ios);
  });

  it('without the match engine Hear you is left out: the microphone opens Timing', () => {
    const s = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }], initialOnboarding({ match: false }));
    expect(s).toMatchObject({ stage: 'timing', hear: 'n/a' });
    expect(onboardingReducer(s, { type: 'back' }).stage).toBe('mic');
  });

  it('only done steps can be chosen in the stepper; Run it now goes back to Timing', () => {
    const ready = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }, { type: 'hear-done' }, { type: 'calibration-done', result: 'skipped' }]);
    expect(onboardingReducer(ready, { type: 'goto-step', step: 'instrument' }).step).toBe('instrument');
    expect(onboardingReducer(ready, { type: 'goto-step', step: 'sound' })).toMatchObject({ step: 'sound', stage: 'timing' });
    const inst = run([{ type: 'next' }]);
    expect(onboardingReducer(inst, { type: 'goto-step', step: 'ready' })).toBe(inst);
    expect(onboardingReducer(ready, { type: 'goto-timing' })).toMatchObject({ step: 'sound', stage: 'timing', timing: null });
  });
});

describe('saved position and migration (R74)', () => {
  it('saves the step, stage and choices, never the browser permission', () => {
    const s = run([{ type: 'next' }, { type: 'next' }, { type: 'mic-granted' }, { type: 'hear-done' }]);
    expect(progressOf(s, 'flute', false)).toEqual({ step: 'sound', stage: 'timing', instrumentId: 'flute', showBeta: false, hear: 'heard' });
    expect(progressOf(initialOnboarding(), null, false)).toBeNull();
  });

  it('reads the round 2 six-step ids (1 to 6) and this round\'s names, and never traps a player mid-setup', () => {
    expect(restoreProgress({ step: 2, instrumentId: 'flute' })).toEqual({ step: 'instrument', instrumentId: 'flute', showBeta: false });
    expect(restoreProgress({ step: 3, instrumentId: 'flute' })).toMatchObject({ step: 'sound', stage: 'mic' });
    expect(restoreProgress({ step: 4, instrumentId: 'flute' })).toMatchObject({ step: 'sound', stage: 'timing' });
    expect(restoreProgress({ step: 5, instrumentId: 'flute' })).toMatchObject({ step: 'sound', stage: 'hear' });
    // The old difficulty step is gone: it reads as Ready.
    expect(restoreProgress({ step: 6, instrumentId: 'flute' })).toMatchObject({ step: 'ready' });
    expect(restoreProgress({ step: 'sound', stage: 'timing', instrumentId: 'cello' })).toMatchObject({ step: 'sound', stage: 'timing', instrumentId: 'cello' });
    expect(restoreProgress({ step: 'ready', instrumentId: 'cello' })).toMatchObject({ step: 'ready' });
    // Welcome, unknown ids and garbage start at Welcome.
    for (const raw of [{ step: 1 }, { step: 9 }, { step: 'nope' }, 'x', null, [], { stage: 'hear' }]) expect(restoreProgress(raw)).toBeNull();
    // Past the picker without an instrument: the picker first.
    expect(restoreProgress({ step: 5 })).toEqual({ step: 'instrument', instrumentId: null, showBeta: false });
  });

  it('a step past the microphone resumes at the Microphone stage; Allow then goes on to the first open stage or Ready', () => {
    const sound = resumeState({ step: 'sound', stage: 'timing', instrumentId: 'flute', showBeta: false, hear: 'heard' });
    expect(sound).toMatchObject({ step: 'sound', stage: 'mic', hear: 'heard' });
    // Allow then skips the stage already heard.
    expect(onboardingReducer(sound, { type: 'mic-granted' })).toMatchObject({ stage: 'timing' });
    const ready = resumeState({ step: 'ready', instrumentId: 'flute', showBeta: false, hear: 'heard', timing: 'skipped' });
    expect(ready).toMatchObject({ step: 'sound', stage: 'mic' });
    expect(onboardingReducer(ready, { type: 'mic-granted' })).toMatchObject({ step: 'ready', mic: 'granted', hear: 'heard', timing: 'skipped' });
    expect(resumeState({ step: 'ready', instrumentId: 'flute', showBeta: false, hear: 'n/a' })).toMatchObject({ step: 'ready', mic: 'declined' });
  });
});

describe('Hear you model', () => {
  const frames = (s0: ReturnType<typeof initialHear>, from: number, ms: number, f: Omit<HearFrame, 't'>) => {
    let s = s0;
    for (let t = from; t < from + ms; t += 20) s = hearReducer(s, { ...f, t });
    return s;
  };
  it('shows the note after half a second of steady voice, then holds it still; heard at about 1 s', () => {
    let s = frames(initialHear(), 0, 400, { midi: 55, levelDb: -24, steady: true });
    expect(s.note).toBeNull();
    s = frames(s, 400, 200, { midi: 55, levelDb: -24, steady: true });
    expect(s.note).toBe(55);
    expect(s.heard).toBe(false);
    // The voice slides away: the name stays put.
    s = frames(s, 600, 500, { midi: 57, levelDb: -24, steady: true });
    expect(s.note).toBe(55);
    expect(s.heard).toBe(true);
    expect(s.level).toBeGreaterThan(0.5);
  });
  it('a gap resets the steady time before the note shows; silence says we cannot hear you yet', () => {
    let s = frames(initialHear(), 0, 300, { midi: 55, levelDb: -24, steady: true });
    s = frames(s, 300, 400, { midi: null, levelDb: -80, steady: false });
    expect(s.steadyMs).toBe(0);
    expect(frames(initialHear(), 0, 4200, { midi: null, levelDb: -80, steady: false }).quiet).toBe(true);
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

  it('walks Welcome, Instrument, Sound check (Microphone, Hear you, Timing) and Ready, and starts the first piece', async () => {
    const { svc, requestMic, finished, engine, saved } = services();
    render(svc);
    // Welcome: not counted, a preview of the three steps, one action.
    expect(text()).not.toContain('Step 1 of 3');
    expect(text()).toContain("Three short steps: your instrument, a sound check, and you're ready.");
    expect(document.activeElement?.textContent).toBe('Get started');
    await press('Get started');
    // Step 1: the stepper names every step; the current one is aria-current.
    const stepper = $('nav.ob-stepper');
    expect(stepper.getAttribute('aria-label')).toBe('Setup, step 1 of 3: Instrument');
    expect(stepper.querySelector('[aria-current="step"]')?.textContent).toContain('Instrument');
    expect([...stepper.querySelectorAll('.ob-stepper-name')].map((n) => n.textContent)).toEqual(['Instrument', 'Sound check', 'Ready']);
    expect(text()).toContain('Step 1 of 3');
    expect(text()).toContain('Choose your voice or instrument');
    // Nothing preselected; Next waits for a card.
    expect(document.querySelectorAll('[role=radio][aria-checked="true"]')).toHaveLength(0);
    expect(button('Next: sound check').getAttribute('aria-disabled')).toBe('true');
    expect(requestMic).not.toHaveBeenCalled();
    pick('voice-baritone');
    expect($('[data-testid="ob-start-line"]').textContent).toBe("You'll start with C3 to C4. That's difficulty 1, the simplest. The range grows as you move up.");
    // The footer: Back at the left, the primary rightmost.
    const footer = $('[data-testid="wizard-footer"]');
    expect([...footer.querySelectorAll('button')].at(-1)?.textContent).toBe('Next: sound check');
    await press('Next: sound check');
    // Step 2: Microphone.
    expect(text()).toContain('Step 2 of 3');
    expect($('nav.ob-stepper').getAttribute('aria-label')).toBe('Setup, step 2 of 3: Sound check');
    expect($('[data-testid="ob-stages"] [aria-current="step"]').getAttribute('data-stage')).toBe('mic');
    expect(text()).toContain('Your browser will ask next. Choose Allow.');
    expect([...$('[data-testid="wizard-footer"]').querySelectorAll('button')].at(-1)?.textContent).toBe('Allow microphone');
    await press('Allow microphone');
    expect(requestMic).toHaveBeenCalledOnce();
    // Hear you opens in the same screen at once: the stage list ticks the microphone.
    expect($('[data-testid="ob-sound"]').getAttribute('data-stage')).toBe('hear');
    expect($('[data-stage="mic"]').getAttribute('data-status')).toBe('done');
    expect(engine.listens).toEqual(['voice-baritone']);
    expect(text()).toContain('Sing any note');
    expect(names()).toContain('Skip this check');
    expect(button('Next').getAttribute('aria-disabled')).toBe('true');
    await engine.sing(600, 55);
    expect($('[data-testid="ob-heard-note"]').textContent).toBe('G3');
    expect(button('Next').getAttribute('aria-disabled')).toBe('true');
    await engine.sing(500, 57);
    expect($('[data-testid="ob-heard-note"]').textContent).toBe('G3');
    expect(text()).toContain('We hear you clearly.');
    expect(text()).toContain('You sang about G3, which sits well in the baritone range.');
    expect(document.querySelector('.mt-needle, [data-testid="match-line"]')).toBeNull();
    await press('Next');
    expect(engine.stops).toBeGreaterThan(0);
    // Timing.
    expect($('[data-testid="ob-sound"]').getAttribute('data-stage')).toBe('timing');
    expect($('[data-stage="hear"]').getAttribute('data-status')).toBe('done');
    expect(text()).toContain('Sound comes from');
    expect(text()).toContain('Skipped, your tries are practice until you run it.');
    await press('Skip for now');
    // Step 3: Ready.
    expect(text()).toContain('Step 3 of 3');
    expect($('[data-row="hear"]').textContent).toContain('We hear you clearly');
    expect($('[data-row="timing"]').textContent).toContain('Not measured yet');
    expect($('[data-row="difficulty"]').textContent).toContain('1 of 10, the simplest');
    expect($('[data-testid="ob-ready-mode"]').textContent).toContain('Your first tries will be in Practice mode');
    expect($('[data-testid="ob-ready-mode"] [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('practice');
    expect([...$('[data-testid="wizard-footer"]').querySelectorAll('button')].at(-1)?.textContent).toBe('Start my first piece');
    await press('Start my first piece');
    expect(finished[0]).toMatchObject({ displayName: 'Player', instrumentId: 'voice-baritone', micAllowed: true, calibration: 'skipped', hear: 'heard', start: 'first-piece' });
    expect(nav).toHaveBeenCalledWith('/practice/scan', true);
    // The position was saved on the way.
    expect(saved.some((p) => p?.step === 'sound' && p.stage === 'hear')).toBe(true);
  });

  it('a measured timing check makes the first tries ranked and says the delay', async () => {
    const { svc, finished } = services();
    render(svc);
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    await press('Allow microphone');
    await press('Skip this check');
    await press('Start timing check');
    expect(text()).toContain('Measured:');
    await press('Next');
    expect($('[data-row="timing"]').textContent).toMatch(/Measured, \d+ ms/);
    expect($('[data-row="hear"]').textContent).toContain('Skipped');
    expect($('[data-testid="ob-ready-mode"] [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('ranked');
    await press('Go to Home');
    expect(finished[0]).toMatchObject({ calibration: 'calibrated', hear: 'skipped', start: 'home' });
    expect(nav).toHaveBeenCalledWith('/', true);
  });

  it('"Not now" opens Ready: microphone off, Hear you and Timing need it, tries are practice', async () => {
    const { svc, finished, engine } = services();
    render(svc);
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    expect(text()).toContain("Not now? You can still read and sing along, but tries won't be graded.");
    await press('Not now');
    expect(engine.listens).toEqual([]);
    expect($('[data-row="microphone"]').textContent).toContain("Off: tries won't be graded");
    expect($('[data-row="hear"]').textContent).toContain('Needs the microphone');
    expect($('[data-row="timing"]').textContent).toContain('Needs the microphone');
    expect(names()).not.toContain('Run it now');
    await press('Start my first piece');
    expect(finished[0]).toMatchObject({ micAllowed: false, calibration: null, hear: 'n/a' });
  });

  it('a blocked microphone says why the panel shows, with Try again and Continue without the microphone', async () => {
    const { svc, requestMic } = services({ mic: { ok: false, problem: 'denied' } });
    render(svc);
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    await press('Allow microphone');
    expect($('[data-testid="mic-denied"]').textContent).toContain('Shown because the browser blocked the microphone.');
    expect(text()).toContain("Microphone is blocked. The app can't hear you play.");
    await press('Try again');
    expect(requestMic).toHaveBeenCalledTimes(2);
    await press('Continue without the microphone');
    expect(text()).toContain('Step 3 of 3');
  });

  it.each([
    ['no-device', "We can't find a microphone.", true],
    ['busy', 'Another app is using the microphone.', true],
    ['insecure', 'The microphone only works on a secure (https) page.', false],
  ] as const)('a %s microphone shows its card with Continue without the microphone', async (problem, line, retry) => {
    const { svc } = services({ mic: { ok: false, problem } });
    render(svc);
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    await press('Allow microphone');
    expect(document.querySelector(`[data-testid="mic-${problem}"]`)?.textContent).toContain(line);
    expect(names().includes('Try again')).toBe(retry);
    expect(names()).toContain('Continue without the microphone');
  });

  it('iOS with unreported latency: Timing has no skip (R16)', async () => {
    const { svc } = services({ caps: { caps: { osFamily: 'ios', outputLatencyReported: false }, output: 'wired', playAlong: [playAlongOk()] } });
    render(svc);
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    await press('Allow microphone');
    await press('Skip this check');
    expect(names()).not.toContain('Skip for now');
    expect(names()).toContain('Start timing check');
  });

  it('without the match engine the stage list has no Hear you and the microphone opens Timing', async () => {
    const { svc } = services({ match: false });
    render(svc);
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    expect(document.querySelector('[data-stage="hear"]')).toBeNull();
    await press('Allow microphone');
    expect($('[data-testid="ob-sound"]').getAttribute('data-stage')).toBe('timing');
  });

  it('a baritone singing above the range is offered the tenor, and choosing it listens on the tenor', async () => {
    const { svc, engine, finished } = services();
    render(svc);
    await press('Get started');
    pick('voice-baritone');
    await press('Next: sound check');
    await press('Allow microphone');
    await engine.sing(1200, 72);
    expect($('[data-testid="ob-other-voice"]').textContent).toContain('Your notes sat above the baritone range. Would tenor fit better?');
    await press('Choose Tenor');
    expect(engine.listens.at(-1)).toBe('voice-tenor');
    await press('Next');
    await press('Skip for now');
    await press('Go to Home');
    expect(finished[0]).toMatchObject({ instrumentId: 'voice-tenor' });
  });

  it('the stepper goes back to a done step; Back on the instrument step returns to Welcome', async () => {
    const { svc } = services();
    render(svc);
    await press('Get started');
    await press('Back');
    expect(text()).toContain('Read it. Play it.');
    await press('Get started');
    pick('flute');
    await press('Next: sound check');
    await press('Instrument, Done');
    expect(text()).toContain('Step 1 of 3');
    // The choice is kept.
    expect(document.querySelector('[data-instrument="flute"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('a reload mid sound check resumes there, at the Microphone stage, with the instrument kept', async () => {
    const { svc } = services({ progress: { step: 'sound', stage: 'timing', instrumentId: 'cello', showBeta: false, hear: 'skipped' } });
    render(svc);
    expect(text()).toContain('Step 2 of 3');
    expect($('[data-testid="ob-sound"]').getAttribute('data-stage')).toBe('mic');
    await press('Allow microphone');
    expect($('[data-testid="ob-sound"]').getAttribute('data-stage')).toBe('timing');
  });

  it('a saved round 2 position (step 5 of 6) resumes in the Sound check, not at Welcome', async () => {
    const { svc } = services({ progress: { step: 5, instrumentId: 'flute' } });
    render(svc);
    expect(text()).toContain('Step 2 of 3');
  });

  it('a reload at Ready asks for the microphone again, then returns to Ready with what was decided', async () => {
    const { svc } = services({ progress: { step: 'ready', instrumentId: 'flute', showBeta: false, hear: 'heard', timing: 'skipped' } });
    render(svc);
    expect(text()).toContain('Step 2 of 3');
    await press('Allow microphone');
    expect(text()).toContain('Step 3 of 3');
    expect($('[data-row="hear"]').textContent).toContain('We hear you clearly');
  });
});
