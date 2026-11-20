// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoidReason } from '../../../core/types.ts';
import { copyKeys, requiredVariables } from '../../../ui/copy/copy.ts';
import { click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import {
  ErrorCard,
  ErrorKindScreen,
  ErrorScreen,
  MicDeniedScreen,
  HistoryEmpty,
  HistoryFilteredEmpty,
  MicOffBanner,
  MicProblemCard,
  NotGradedResult,
  ProgressEmpty,
  SelectorEmpty,
  SlipsEmpty,
  VoidCard,
} from './States.tsx';
import { classifyMicError, pickMicBrowser } from './mic.ts';
import { PENDING_COPY, text, type PendingKey } from './text.ts';
import { practiseWithoutListening, voidCopy } from './void.ts';
import { formatMessage } from '../../../ui/copy/copy.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});
const buttons = (): string[] => [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
const buttonNamed = (name: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === name);
  if (!b) throw new Error(`no button ${name}`);
  return b;
};

describe('pending copy', () => {
  it('formats with exactly its placeholders and never shadows a catalogue key', () => {
    for (const key of Object.keys(PENDING_COPY) as PendingKey[]) {
      const vars = Object.fromEntries(requiredVariables(PENDING_COPY[key]).map((v) => [v, 1]));
      expect(() => formatMessage(PENDING_COPY[key], vars)).not.toThrow();
    }
    // A key that has since entered the catalogue is used from there (text() prefers it); report drift.
    const adopted = Object.keys(PENDING_COPY).filter((k) => (copyKeys as readonly string[]).includes(k));
    expect(adopted).toEqual([]);
  });
  it('text() reads the catalogue for catalogue keys', () => {
    expect(text('action.tryAgain')).toBe('Try again');
    expect(text('calibrate.dot.heard', { n: 2, total: 10 })).toBe('Click 2 of 10: heard');
  });
});

describe('microphone cases', () => {
  it('classifies getUserMedia errors', () => {
    expect(classifyMicError({ name: 'NotAllowedError' })).toBe('denied');
    expect(classifyMicError({ name: 'NotFoundError' })).toBe('no-device');
    expect(classifyMicError({ name: 'NotReadableError' })).toBe('busy');
    expect(classifyMicError(new Error('x'))).toBe('no-device');
    expect(classifyMicError({ name: 'NotAllowedError' }, false)).toBe('insecure');
  });
  it('picks per-browser steps from capabilities', () => {
    const base = { osFamily: 'windows', displayMode: 'browser', outputLatencyReported: true } as const;
    expect(pickMicBrowser(base)).toBe('chrome');
    expect(pickMicBrowser(base, 'firefox')).toBe('firefox');
    expect(pickMicBrowser({ ...base, osFamily: 'macos', outputLatencyReported: false })).toBe('safari-mac');
    expect(pickMicBrowser({ ...base, osFamily: 'ios', outputLatencyReported: false })).toBe('ios-safari');
    expect(pickMicBrowser({ ...base, osFamily: 'ipados', displayMode: 'standalone', outputLatencyReported: false })).toBe('ios-home-screen');
  });
  it('denied card shows the browser steps with both actions; others offer Try again only', () => {
    const retry = vi.fn();
    const practise = vi.fn();
    current = mount(<MicProblemCard problem="denied" browser="firefox" onTryAgain={retry} onPractiseWithoutListening={practise} />);
    expect(document.body.textContent).toContain("Microphone is blocked. The app can't hear you play.");
    expect(document.body.textContent).toContain('crossed-out mic');
    expect(buttons()).toEqual(['Try again', 'Practise without listening']);
    click(buttonNamed('Practise without listening'));
    expect(practise).toHaveBeenCalledOnce();
    current.render(<MicProblemCard problem="busy" onTryAgain={retry} onPractiseWithoutListening={practise} />);
    expect(buttons()).toEqual(['Try again']);
    expect(document.body.textContent).toContain('Another app is using the microphone');
    current.render(<MicProblemCard problem="insecure" onTryAgain={retry} />);
    expect(buttons()).toEqual([]);
    expect(document.body.textContent).toContain('secure (https) page');
  });
  it('micOff banner offers Allow microphone', () => {
    const allow = vi.fn();
    current = mount(<MicOffBanner onAllow={allow} />);
    click(buttonNamed('Allow microphone'));
    expect(allow).toHaveBeenCalledOnce();
  });
});

describe('void cards', () => {
  const reasons: VoidReason[] = ['interrupted', 'no-signal', 'device-change', 'backlog', 'capture-gap', 'stopped-before-first-note'];
  it('every reason has copy and at least one next step', () => {
    for (const r of reasons) expect(voidCopy(r).actions.length).toBeGreaterThan(0);
  });
  it('renders the table in 04 section 9.3', () => {
    const fns = { onTryAgain: vi.fn(), onCheckMicrophone: vi.fn(), onRecalibrate: vi.fn() };
    current = mount(<VoidCard reason="no-signal" {...fns} />);
    expect(document.body.textContent).toContain("We couldn't hear you, so this try wasn't graded.");
    expect(buttons()).toEqual(['Check microphone', 'Try again']);
    current.render(<VoidCard reason="device-change" {...fns} />);
    expect(buttons()).toEqual(['Calibrate again']);
    click(buttonNamed('Calibrate again'));
    expect(fns.onRecalibrate).toHaveBeenCalledOnce();
    current.render(<VoidCard reason="backlog" {...fns} />);
    expect(document.body.textContent).toContain('This device fell behind while listening');
    current.render(<VoidCard reason="interrupted" {...fns} />);
    expect(document.body.textContent).toContain('The try was interrupted');
    expect(buttons()).toEqual(['Try again']);
  });
  it('never shows a grade or XP', () => {
    current = mount(<VoidCard reason="interrupted" onTryAgain={() => undefined} />);
    expect(document.body.textContent).not.toMatch(/XP|Grade/);
  });
});

describe('error and empty states', () => {
  it('storage error cards carry their action', () => {
    const f = vi.fn();
    current = mount(<ErrorCard kind="storage-loss" onPrimary={f} onSecondary={f} />);
    expect(buttons()).toEqual(['Import backup', 'Start fresh']);
    current.render(<ErrorCard kind="storage-blocked" onPrimary={f} />);
    expect(buttons()).toEqual(['Export this try']);
  });
  it('empty states match 9.1', () => {
    const f = vi.fn();
    current = mount(<ProgressEmpty onStart={f} />);
    expect(document.body.textContent).toContain('Your progress starts with one try');
    click(buttonNamed('Start practising'));
    expect(f).toHaveBeenCalledOnce();
    current.render(<HistoryEmpty onStart={f} />);
    expect(document.body.textContent).toContain('Every try you play is saved on this device.');
    current.render(<HistoryFilteredEmpty onClear={f} />);
    expect(buttons()).toEqual(['Clear filters']);
    current.render(<SlipsEmpty />);
    expect(buttons()).toEqual([]);
    current.render(<SelectorEmpty body="Level 2 has no unseen music in 3/4 for flute yet." suggestions={[{ label: 'Set time to Random', onSelect: f }, { label: 'Practise a piece you\'ve seen', onSelect: f }]} />);
    expect(buttons()).toEqual(['Set time to Random', 'Practise a piece you\'ve seen']);
    expect(document.body.textContent).toContain('No piece fits these settings');
  });
});

describe('practise without listening (R13)', () => {
  it('turns capture off and forces practice (no XP)', () => {
    const s = practiseWithoutListening({
      instrumentId: 'flute', level: 3, writtenKey: 'random', meter: 'random', bpm: 'random', bars: 'random', mode: 'ranked',
      listening: true, metronome: 'audible', clickTimbre: 'tick', outputMode: 'speakers', a4Hz: 440,
    });
    expect(s.listening).toBe(false);
    expect(s.mode).toBe('practice');
    expect(s.level).toBe(3);
  });
  it('results line reads Not graded · no XP with the credit', () => {
    current = mount(<NotGradedResult credit="Schubert · Op. 1" />);
    expect(document.body.textContent).toContain('Not graded · no XP');
    expect(document.body.textContent).toContain('That was: Schubert · Op. 1');
    expect(document.body.textContent).not.toMatch(/Grade [A-F]/);
  });
});

describe('full-screen errors (05 section 8.13)', () => {
  const kinds = ['audio-start', 'mic-start', 'corpus', 'no-worklet'] as const;

  it.each(kinds)('%s: heading, cause, and both actions fire', (kind) => {
    const retry = vi.fn();
    const back = vi.fn();
    current = mount(<ErrorKindScreen kind={kind} onTryAgain={retry} onBackToPractice={back} />);
    expect(document.querySelector('h1')?.textContent).toBeTruthy();
    expect(document.querySelector('.err-screen-body')?.textContent).toBeTruthy();
    expect(buttons()).toEqual(['Try again', 'Back to Practice']);
    click(buttonNamed('Try again'));
    expect(retry).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
    click(buttonNamed('Back to Practice'));
    expect(back).toHaveBeenCalledOnce();
  });

  it('the sound screen gives its heading, cause and the kept line, and never mentions the clock rate', () => {
    current = mount(<ErrorKindScreen kind="audio-start" onTryAgain={() => undefined} onBackToPractice={() => undefined} />);
    expect(document.querySelector('h1')?.textContent).toBe("The sound didn't start");
    expect(document.body.textContent).toContain('Your piece is kept. Try again starts it from the beginning.');
    expect(document.body.textContent).not.toMatch(/wrong speed|clock/i);
  });

  it('the microphone screen has its heading and offers Save diagnostics when services are given', () => {
    const services = {
      supportAddress: null,
      soundOptInShown: true,
      exportTry: async () => null,
      exportLast: async () => null,
      settings: async () => ({ includeAudio: false }),
      setSettings: async () => undefined,
    };
    current = mount(<ErrorKindScreen kind="mic-start" diagnostics={services} onTryAgain={() => undefined} onBackToPractice={() => undefined} />);
    expect(document.querySelector('h1')?.textContent).toBe("The microphone didn't open");
    expect(document.body.textContent).toContain('Keeps happening? Save what the app saw for the team.');
    expect(buttons()).toContain('Save diagnostics');
  });

  it('corpus and no-worklet screens carry no kept line', () => {
    current = mount(<ErrorKindScreen kind="corpus" onTryAgain={() => undefined} onBackToPractice={() => undefined} />);
    expect(document.querySelector('[data-testid="error-kept"]')).toBeNull();
  });

  it('puts focus on the heading so the problem is announced', () => {
    current = mount(<ErrorKindScreen kind="corpus" onTryAgain={() => undefined} onBackToPractice={() => undefined} />);
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });

  it('microphone denied shows the heading, the browser steps, Try again and Practise without listening', () => {
    const retry = vi.fn();
    const practise = vi.fn();
    current = mount(<MicDeniedScreen browser="safari-mac" onTryAgain={retry} onPractiseWithoutListening={practise} />);
    expect(document.querySelector('h1')?.textContent).toBe("Microphone is blocked. The app can't hear you play.");
    expect(document.body.textContent).toContain('Safari > Settings for This Website > Microphone > Allow.');
    expect(buttons()).toEqual(['Try again', 'Practise without listening']);
    click(buttonNamed('Try again'));
    click(buttonNamed('Practise without listening'));
    expect(retry).toHaveBeenCalledOnce();
    expect(practise).toHaveBeenCalledOnce();
  });

  it('the first action is primary, the second secondary', () => {
    current = mount(<ErrorScreen testId="x" heading="H" body="B" actions={[{ label: 'One', onClick: () => undefined, primary: true }, { label: 'Two', onClick: () => undefined }]} />);
    expect(buttonNamed('One').className).toContain('ui-button-primary');
    expect(buttonNamed('Two').className).toContain('ui-button-secondary');
  });
});
