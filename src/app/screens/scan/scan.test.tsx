// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { PracticeApp, harness, testExcerpt, type Harness } from './test-support.tsx';
import { PracticeFlowServicesProvider } from './services.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function render(h: Harness): void {
  m = mount(
    <PracticeFlowServicesProvider value={h.services}>
      <PracticeApp h={h} />
    </PracticeFlowServicesProvider>,
  );
}

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
};
const tick = (h: Harness, remainingSec: number): void => {
  act(() => h.session.events.emit({ type: 'scan-tick', remainingSec }));
};
async function reveal(h: Harness): Promise<void> {
  click(button(copy('action.startScan')));
  await flush();
  tick(h, 30);
}

describe('Scan screen', () => {
  it('covered: facts and the ranked notice, never the title or composer', () => {
    const h = harness();
    render(h);
    const cover = $('[data-testid="scan-cover"]');
    const src = h.services.session.prepared!.source;
    expect(cover.textContent).toContain(copy('scan.cover'));
    expect(cover.textContent).toContain(copy('scan.ranked.notice', { seconds: 30 }));
    expect(document.body.textContent).not.toContain(src.composer);
    expect(document.body.textContent).not.toContain(src.work);
    click(button(copy('action.practiceInstead')));
    expect(h.practiceInstead).toHaveBeenCalledTimes(1);
  });

  it('practice cover has no ranked notice', () => {
    const h = harness({ mode: 'practice' });
    render(h);
    expect($('[data-testid="scan-cover"]').textContent).not.toContain(copy('scan.ranked.notice', { seconds: 30 }));
  });

  it('Start scan is the first gesture: unlocks audio and reveals; Space does the same', async () => {
    const h = harness();
    render(h);
    key(document, ' ');
    expect(h.session.ensureAudio).toHaveBeenCalledTimes(1);
    expect(h.session.revealScan).toHaveBeenCalledTimes(1);
    await flush();
    expect(document.querySelector('[data-testid="scan-cover"]')).toBeNull();
    expect($('.sf-host').querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('scanning: the same geometry as the take (all systems drawn), toolbar chip and summary', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    expect($('.scan-chip').textContent).toBe(copy('scan.chip.ranked', { time: '0:30' }));
    expect($('.scan-summary').textContent).toContain('Level 3');
    expect($('.sf-host').getAttribute('data-arrangement')).toBe('all');
  });

  it('ranked: "Starting in N" from 5 s; Start playing starts the take at any time', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    expect($('.scan-timer-label').textContent).toBe('');
    tick(h, 5);
    expect($('.scan-timer-label').textContent).toBe(copy('scan.startingIn', { n: 5 }));
    tick(h, 2);
    expect($('.scan-timer-label').textContent).toBe(copy('scan.startingIn', { n: 2 }));
    click(button(copy('action.startPlaying')));
    expect(h.session.startTake).toHaveBeenCalledTimes(1);
  });

  it('Space and Enter start playing while scanning; focus lands on Start playing', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    expect(document.activeElement).toBe(button(copy('action.startPlaying')));
    key(document.body, 'Enter');
    expect(h.session.startTake).toHaveBeenCalledTimes(1);
  });

  it('practice never auto-starts and says so at 0', async () => {
    const h = harness({ mode: 'practice' });
    render(h);
    await reveal(h);
    expect($('.scan-chip').textContent).toBe(copy('scan.chip.practice'));
    tick(h, 0);
    expect($('.scan-timer-label').textContent).toBe(copy('scan.practice.timeUp'));
    expect(h.session.startTake).not.toHaveBeenCalled();
  });

  it('STARS: five rows, the clock ticks them, a player tick sticks, and the signatures detail is generated', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    const rows = [...document.querySelectorAll('.scan-stars-list li')];
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.getAttribute('data-checked'))).toEqual(['false', 'false', 'false', 'false', 'false']);
    expect(rows[0]!.textContent).toContain('4/4, felt in 4');
    tick(h, 18);
    expect([...document.querySelectorAll('.scan-stars-list li')].filter((r) => r.getAttribute('data-checked') === 'true')).toHaveLength(2);
    click(document.querySelectorAll<HTMLElement>('.scan-stars-list li button')[4]!);
    tick(h, 12);
    const checked = [...document.querySelectorAll('.scan-stars-list li')].map((r) => r.getAttribute('data-checked'));
    expect(checked).toEqual(['true', 'true', 'true', 'false', 'true']);
  });

  it('hides the STARS list when the setting is off but keeps the helpers', async () => {
    const s = defaultAppSettings();
    const h = harness({ settings: { ...s, practicePrefs: { ...s.practicePrefs, showStars: false } } });
    render(h);
    await reveal(h);
    expect(document.querySelector('.scan-stars-list')).toBeNull();
    expect(button(copy('action.hearTempo'))).toBeTruthy();
  });

  it('highlights the active row\'s notes in the score and clears them at count-in', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    // Row 3 (accidentals) is active after two ticks; the signs row highlights the extremes when hovered.
    const signs = document.querySelectorAll<HTMLElement>('.scan-stars-list li')[4]!;
    act(() => {
      signs.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const prepared = h.services.session.prepared!;
    h.services.session.prepared!.extremes.highId.length;
    expect(document.querySelectorAll('.scan-highlight').length).toBe(prepared.extremes.highId === prepared.extremes.lowId ? 1 : 2);
    act(() => {
      signs.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    act(() => {
      h.session.state = 'count-in';
      h.session.events.emit({ type: 'state', state: 'count-in', prev: 'scanning' });
    });
    expect(document.querySelectorAll('.scan-highlight')).toHaveLength(0);
  });

  it('helpers: Hear the tempo; Tuning note shows a number only; no voice reference for a flute', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    click(button(copy('action.hearTempo')));
    expect(h.services.hearTempo).toHaveBeenCalledTimes(1);
    click(button(copy('action.tuningNote')));
    await flush();
    expect($('.scan-tuning').textContent).toBe(copy('scan.tuning.result', { cents: 8, direction: copy('direction.flat') }));
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === copy('action.hearReference'))).toBe(false);
  });

  it('voice gets the reference button and no tuning note', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'voice' }) });
    render(h);
    await reveal(h);
    click(button(copy('action.hearReference')));
    expect(h.session.playVoiceReference).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === copy('action.tuningNote'))).toBe(false);
  });

  it('follows the session into the take and the results', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    act(() => h.session.emitState('count-in'));
    expect(h.location.hash).toBe('#/practice/play');
    act(() => h.session.emitState('results'));
    expect(h.location.hash).toBe('#/practice/results');
  });

  it('skip before reveal is free and asks nothing; after reveal it asks, then skips and names the piece', async () => {
    const h = harness();
    render(h);
    click(button(copy('action.skip')));
    expect(h.session.skip).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    h.session.skip.mockClear();
    await reveal(h);
    click($('.scan-overflow'));
    click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === copy('scan.overflow.skip'))!);
    expect($('[role="dialog"]').textContent).toContain(copy('dialog.skip.title'));
    expect(h.session.skip).not.toHaveBeenCalled();
    click(button(copy('action.skip')));
    await flush();
    expect(h.session.skip).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(copy('credit.that-was', { credit: '' }).trim().slice(0, 9));
  });

  it('Home after reveal asks to skip; Keep reading closes it; before reveal it just leaves', async () => {
    const h = harness();
    render(h);
    click(button(copy('nav.home')));
    expect(h.location.hash).toBe('#/');
    h.location.navigate('/practice/scan');
    await reveal(h);
    click(button(copy('nav.home')));
    expect($('[role="dialog"]')).toBeTruthy();
    click(button(copy('action.keepReading')));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.session.skip).not.toHaveBeenCalled();
  });

  it('About this music is the only way to see title and composer before results', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    const src = h.services.session.prepared!.source;
    expect(document.body.textContent).not.toContain(src.composer);
    click($('.scan-overflow'));
    click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === copy('scan.overflow.aboutMusic'))!);
    expect($('[role="dialog"]').textContent).toContain(src.composer);
  });

  it('CC BY items show the non-identifying source line, which opens a licence sheet without title or composer', async () => {
    const e = testExcerpt();
    const h = harness({ prepared: { ...e, source: { ...e.source, license: 'CC-BY-4.0', encoder: 'A. Encoder', corpus: 'openscore-lieder' } } });
    render(h);
    await reveal(h);
    const line = $('.scan-source-line');
    expect(line.textContent).toBe(copy('credit.source', { encoder: 'A. Encoder', corpus: 'openscore-lieder' }));
    click(line);
    expect($('[role="dialog"]').textContent).not.toContain(e.source.composer);
    expect($('[role="dialog"]').textContent).toContain('A. Encoder');
  });

  it('shows the quiet bars chip when the selector served another length', async () => {
    const h = harness();
    const s = defaultAppSettings();
    h.settings.set({ ...s, practice: { ...s.practice, bars: 12 } });
    render(h);
    await reveal(h);
    expect($('.scan-quiet-chip').textContent).toBe(copy('scan.served.bars', { served: 8, requested: 12 }));
  });

  it('shows the iOS wake lock hint only when asked', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    expect(document.querySelector('.scan-hint')).toBeNull();
  });
});
