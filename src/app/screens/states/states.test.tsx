// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoidReason } from '../../../core/types.ts';
import { copyKeys, requiredVariables } from '../../../ui/copy/copy.ts';
import { click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import {
  CalibrationMissingBanner,
  ErrorCard,
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
    expect(document.body.textContent).toContain("We couldn't hear you, so this take wasn't graded.");
    expect(buttons()).toEqual(['Check microphone', 'Try again']);
    current.render(<VoidCard reason="device-change" {...fns} />);
    expect(buttons()).toEqual(['Recalibrate']);
    click(buttonNamed('Recalibrate'));
    expect(fns.onRecalibrate).toHaveBeenCalledOnce();
    current.render(<VoidCard reason="backlog" {...fns} />);
    expect(document.body.textContent).toContain('This device fell behind while listening');
    current.render(<VoidCard reason="interrupted" {...fns} />);
    expect(document.body.textContent).toContain('The take was interrupted');
    expect(buttons()).toEqual(['Try again']);
  });
  it('never shows a grade or XP', () => {
    current = mount(<VoidCard reason="interrupted" onTryAgain={() => undefined} />);
    expect(document.body.textContent).not.toMatch(/XP|Grade/);
  });
});

describe('error and empty states', () => {
  it('error cards carry their action', () => {
    const f = vi.fn();
    current = mount(<ErrorCard kind="clock-rate" onPrimary={f} />);
    expect(document.body.textContent).toContain("Your device's audio clock is running at the wrong speed, so timing can't be measured. Close other apps that play sound, then try again.");
    click(buttonNamed('Reload'));
    expect(f).toHaveBeenCalledOnce();
    current.render(<ErrorCard kind="storage-loss" onPrimary={f} onSecondary={f} />);
    expect(buttons()).toEqual(['Import backup', 'Start fresh']);
    current.render(<ErrorCard kind="no-worklet" onPrimary={f} />);
    expect(buttons()).toEqual(['Practise without listening']);
    current.render(<ErrorCard kind="corpus" onPrimary={f} />);
    expect(buttons()).toEqual(['Retry']);
  });
  it('empty states match 9.1', () => {
    const f = vi.fn();
    current = mount(<ProgressEmpty onStart={f} />);
    expect(document.body.textContent).toContain('Your progress starts with one take');
    click(buttonNamed('Start practising'));
    expect(f).toHaveBeenCalledOnce();
    current.render(<HistoryEmpty onStart={f} />);
    expect(document.body.textContent).toContain('Every take you play is saved on this device.');
    current.render(<HistoryFilteredEmpty onClear={f} />);
    expect(buttons()).toEqual(['Clear filters']);
    current.render(<SlipsEmpty />);
    expect(buttons()).toEqual([]);
    current.render(<SelectorEmpty body="Level 2 has no unseen music in 3/4 for flute yet." suggestions={[{ label: 'Set time to Random', onSelect: f }, { label: 'Practise a seen excerpt', onSelect: f }]} />);
    expect(buttons()).toEqual(['Set time to Random', 'Practise a seen excerpt']);
    expect(document.body.textContent).toContain('No excerpt fits these settings');
  });
  it('calibration banner never blocks: it is dismissible and carries Calibrate', () => {
    const f = vi.fn();
    current = mount(<CalibrationMissingBanner seconds={8} onCalibrate={f} />);
    expect(document.body.textContent).toContain('It takes 8 seconds.');
    click(buttonNamed('Calibrate'));
    expect(f).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
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
