// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { keyName } from '../setup/key-names.ts';
import { markSoundsCoachSeen, resetSoundsCoach } from './coach.ts';
import { creditLine } from './model.ts';
import { firstNoteLabel, firstNoteOf } from './read-model.ts';
import { PracticeApp, harness, testExcerpt, type Harness } from './test-support.tsx';
import { SESSION_ERROR_TEXT } from './ScanScreen.tsx';
import { PracticeFlowServicesProvider } from './services.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
  resetSoundsCoach();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function render(h: Harness, opts: { coach?: boolean } = {}): void {
  if (!opts.coach) markSoundsCoachSeen();
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
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll('button')];
const button = (label: string): HTMLButtonElement => {
  const name = (x: HTMLButtonElement): string => x.getAttribute('aria-label') ?? [...x.childNodes].filter((n) => !(n instanceof Element && n.tagName === 'KBD')).map((n) => n.textContent).join('');
  const b = buttons().find((x) => name(x) === label);
  if (!b) throw new Error(`no button ${label}`);
  return b;
};
const sound = (id: string): HTMLButtonElement => $<HTMLButtonElement>(`[data-sound="${id}"] button, button[data-sound="${id}"]`);
const hasSound = (id: string): boolean => document.querySelector(`[data-sound="${id}"]`) !== null;
const tick = (h: Harness, remainingSec: number): void => {
  act(() => h.session.events.emit({ type: 'scan-tick', remainingSec }));
};
const caption = (): string => $('[data-testid="live-caption"]').textContent ?? '';
const announced = (): string => $('[data-testid="scan-announce"]').textContent ?? '';
const chip = (): string => $('[data-testid="mode-chip"]').textContent ?? '';
const confirm = (): Element | null => document.querySelector('[data-testid="listen-confirm"]');
async function reveal(h: Harness, remainingSec = 30): Promise<void> {
  click(button(copy('action.startScan')));
  await flush();
  tick(h, remainingSec);
}

describe('Cover', () => {
  it('shows the engraved signature, one summary line and the ranked line, never the title or composer', () => {
    const h = harness();
    render(h);
    const cover = $('[data-testid="scan-cover"]');
    const src = h.services.session.prepared!.source;
    expect(cover.querySelector('[data-testid="cover-signature"]')).not.toBeNull();
    expect(cover.querySelectorAll('.scan-cover-summary')).toHaveLength(1);
    expect(cover.textContent).toContain('Difficulty 3');
    expect(cover.textContent).toContain(copy('scan.cover'));
    expect(cover.textContent).toContain(copy('scan.ranked.notice', { seconds: 30 }));
    expect(cover.textContent).toContain(copy('scan.skipFreeHint'));
    expect(chip()).toBe(copy('badge.ranked'));
    expect(document.body.textContent).not.toContain(src.composer);
    expect(document.body.textContent).not.toContain(src.work);
    click(button(copy('action.practiceInstead')));
    expect(h.practiceInstead).toHaveBeenCalledTimes(1);
  });

  it('practice cover has no ranked line', () => {
    const h = harness({ mode: 'practice' });
    render(h);
    expect($('[data-testid="scan-cover"]').textContent).not.toContain(copy('scan.ranked.notice', { seconds: 30 }));
    expect(chip()).toBe(copy('scan.chip.practice'));
  });

  it('loading: the frame with "Getting the music…", Show the music held', () => {
    const h = harness();
    act(() => h.view.setState({ state: 'loading', prepared: null }));
    render(h);
    const cover = $('[data-testid="scan-cover"]');
    expect(cover.getAttribute('aria-busy')).toBe('true');
    expect(cover.textContent).toContain(copy('scan.cover.loading'));
    expect(button(copy('action.startScan')).getAttribute('aria-disabled')).toBe('true');
    key(document, ' ');
    expect(h.session.revealScan).not.toHaveBeenCalled();
  });

  it('corpus error: the message with Try again and Back to Practice', () => {
    const h = harness();
    act(() => h.view.setState({ error: { code: 'corpus-load' } }));
    render(h);
    expect(document.body.textContent).toContain(copy('error.corpus'));
    expect(button(copy('action.tryAgain'))).toBeTruthy();
    click(button(copy('action.backToPractice')));
    expect(h.location.hash).toBe('#/');
  });

  it.each([
    ['audio-setup', 'error.audioSetup'],
    ['storage', 'error.storage'],
    ['unknown', 'error.unknown'],
    ['mic-denied', 'permission.denied.title'],
  ] as const)('a %s error says so, never that the audio clock is wrong, with its details', (code, key) => {
    const h = harness();
    act(() => h.view.setState({ error: { code, detail: 'WebAudioBackend: call unlock() first' } }));
    render(h);
    const alert = $('[role="alert"]');
    expect(alert.textContent).toContain(copy(key));
    expect(alert.textContent).not.toContain(copy('error.clockRate'));
    expect($('.scan-error-detail').textContent).toBe(copy('error.details', { detail: 'WebAudioBackend: call unlock() first' }));
  });

  it('every session error code has its own text and none is the clock-rate message', () => {
    for (const k of Object.values(SESSION_ERROR_TEXT)) expect(k).not.toBe('error.clockRate');
  });

  it('empty pool: no Try again, Back to Practice only', () => {
    const h = harness();
    act(() => h.view.setState({ error: { code: 'empty-pool' } }));
    render(h);
    expect(document.body.textContent).toContain(copy('error.emptyPool'));
    expect(document.querySelector('.scan-error-detail')).toBeNull();
    expect(() => button(copy('action.tryAgain'))).toThrow();
  });

  it('Try again after a take could not start: reopens audio in the tap and retries the read-through, staying here', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    act(() => {
      h.session.emitState('error');
      h.view.setState({ error: { code: 'audio-setup', detail: 'x' } });
    });
    const calls = h.session.ensureAudio.mock.calls.length;
    click(button(copy('action.tryAgain')));
    expect(h.session.ensureAudio).toHaveBeenCalledTimes(calls + 1);
    expect(h.session.retry).toHaveBeenCalledTimes(1);
    expect(h.location.hash).not.toBe('#/');
    expect($('[data-testid="screen-practice.scan"]').getAttribute('data-state')).toBe('scanning');
  });

  it('Start playing reopens audio inside the tap before it starts the take', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    const calls = h.session.ensureAudio.mock.calls.length;
    click(button(copy('action.startPlaying')));
    expect(h.session.ensureAudio).toHaveBeenCalledTimes(calls + 1);
    expect(h.session.startTake).toHaveBeenCalledTimes(1);
  });

  it('Show the music is the first gesture: unlocks audio and reveals; Space does the same', async () => {
    const h = harness();
    render(h);
    key(document, ' ');
    expect(h.session.ensureAudio).toHaveBeenCalledTimes(1);
    expect(h.session.revealScan).toHaveBeenCalledTimes(1);
    await flush();
    expect(document.querySelector('[data-testid="scan-cover"]')).toBeNull();
    expect($('.sf-host').querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('Skip before reveal is free and asks nothing', () => {
    const h = harness();
    render(h);
    click(button(copy('action.skip')));
    expect(h.session.skip).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Read-through', () => {
  it('toolbar: summary, mode chip with its ring and time left, overflow; the score drawn whole', async () => {
    const h = harness();
    render(h);
    await reveal(h, 24);
    expect(chip()).toContain(copy('scan.chip.ranked', { time: '0:24' }));
    expect($('[data-testid="mode-chip"] [role="img"]').getAttribute('aria-label')).toBe(copy('scan.timeLeft', { time: '0:24' }));
    expect($('.scan-summary').textContent).toContain('Difficulty 3');
    expect($('.sf-host').getAttribute('data-arrangement')).toBe('all');
    expect($('.scan-overflow').getAttribute('aria-haspopup')).toBe('menu');
  });

  it('ranked: polite announcements at 10 and 5 seconds; Start playing starts the take at any time', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    tick(h, 12);
    expect(announced()).toBe('');
    tick(h, 10);
    expect(announced()).toBe(copy('scan.startingIn', { n: 10 }));
    tick(h, 7);
    expect(announced()).toBe(copy('scan.startingIn', { n: 10 }));
    tick(h, 4.98);
    expect(announced()).toBe(copy('scan.startingIn', { n: 5 }));
    click(button(copy('action.startPlaying')));
    expect(h.session.startTake).toHaveBeenCalledTimes(1);
  });

  it('Space and Enter start playing while reading; focus lands on Start playing', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    expect(document.activeElement).toBe(button(copy('action.startPlaying')));
    key(document.body, 'Enter');
    expect(h.session.startTake).toHaveBeenCalledTimes(1);
  });

  it('practice never auto-starts, never announces the countdown and says so at 0', async () => {
    const h = harness({ mode: 'practice' });
    render(h);
    await reveal(h);
    expect(chip()).toBe(copy('scan.chip.practice'));
    expect($('[data-testid="scan-read-hint"]').textContent).toBe(copy('scan.practice.readHint'));
    tick(h, 10);
    expect(announced()).toBe('');
    act(() => h.view.setState({ scan: { remainingSec: 0, expired: true } }));
    expect($('[data-testid="scan-read-hint"]').textContent).toBe(copy('scan.practice.timeUp'));
    expect(h.session.startTake).not.toHaveBeenCalled();
  });

  it('Before you play: five rows, the clock ticks them, a player tick sticks, and the signatures detail is generated', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    expect($('.scan-stars').textContent).toContain(copy('stars.heading'));
    expect($('.scan-stars').textContent).toContain(copy('stars.optional'));
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

  it('hides the checklist when the setting is off but keeps the sounds', async () => {
    const s = defaultAppSettings();
    const h = harness({ settings: { ...s, practicePrefs: { ...s.practicePrefs, showStars: false } } });
    render(h);
    await reveal(h);
    expect(document.querySelector('.scan-stars-list')).toBeNull();
    expect(hasSound('tempo')).toBe(true);
  });

  it("highlights the active row's notes in the score and clears them at count-in", async () => {
    const h = harness();
    render(h);
    await reveal(h);
    const signs = document.querySelectorAll<HTMLElement>('.scan-stars-list li')[4]!;
    act(() => {
      signs.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const prepared = h.services.session.prepared!;
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

  it('follows the session into the take and the results', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    act(() => h.session.emitState('count-in'));
    expect(h.location.hash).toBe('#/practice/play');
    act(() => h.session.emitState('results'));
    expect(h.location.hash).toBe('#/practice/results');
  });

  it('skip after reveal asks, then skips and names the piece', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    click($('.scan-overflow'));
    click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === copy('scan.overflow.skip'))!);
    expect($('[role="dialog"]').textContent).toContain(copy('dialog.skip.title'));
    expect(h.session.skip).not.toHaveBeenCalled();
    click(button(copy('action.skip')));
    await flush();
    expect(h.session.skip).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(copy('credit.that-was', { credit: creditLine(h.services.session.prepared!.source) }));
  });

  it('Home after reveal asks to skip; Keep reading closes it; before reveal it just leaves', async () => {
    const h = harness();
    render(h);
    click(button(copy('nav.home')));
    expect(h.location.hash).toBe('#/');
    act(() => h.location.navigate('/practice/scan', false));
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

describe('Sounds and the reference (05 sections 8.8, 10; section 16 items 9, 10 and 13)', () => {
  it('item 9: ranked Listen first opens the confirm; Keep it ranked changes nothing and plays nothing', async () => {
    const h = harness();
    render(h);
    await reveal(h, 24);
    expect(sound('listen').textContent).toContain(copy('listen.rankedLine'));
    click(sound('listen'));
    expect(confirm()).not.toBeNull();
    expect($('[role="dialog"]').textContent).toContain(copy('listen.confirm.body'));
    expect($('[data-testid="confirm-time"]').textContent).toBe(copy('scan.timeLeft', { time: '0:24' }));
    expect(document.activeElement?.textContent).toBe(copy('listen.confirm.no'));
    click(button(copy('listen.confirm.no')));
    expect(confirm()).toBeNull();
    expect(h.listenFirst).not.toHaveBeenCalled();
    expect(chip()).toContain(copy('scan.chip.ranked', { time: '0:24' }));
    expect(h.sounds.getState().playing).toBeNull();
  });

  it('item 9: Escape on the confirm keeps it ranked', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    click(sound('listen'));
    key(document.activeElement ?? document, 'Escape');
    expect(confirm()).toBeNull();
    expect(h.listenFirst).not.toHaveBeenCalled();
  });

  it('item 9: Listen, make it practice changes the chip, announces it, plays, and the countdown runs on', async () => {
    const h = harness();
    render(h);
    await reveal(h, 18);
    click(sound('listen'));
    expect($('[data-testid="confirm-time"]').textContent).toBe(copy('scan.timeLeft', { time: '0:18' }));
    // The countdown never pauses while the confirm is open.
    tick(h, 17);
    expect($('[data-testid="confirm-time"]').textContent).toBe(copy('scan.timeLeft', { time: '0:17' }));
    click(button(copy('listen.confirm.yes')));
    expect(h.listenFirst).toHaveBeenCalledTimes(1);
    expect(confirm()).toBeNull();
    expect(chip()).toBe(copy('scan.chip.practice'));
    expect(announced()).toBe(copy('listen.nowPractice'));
    expect(h.services.session.pending?.listenedFirst).toBe(true);
    // Playing: the button reads Stop and keeps the practice caption; pressing it stops.
    expect(sound('listen').textContent).toContain(copy('action.stop'));
    expect(sound('listen').textContent).toContain(copy('listen.practiceCaption'));
    tick(h, 16);
    expect(h.view.getState().scan?.remainingSec).toBe(16);
    click(sound('listen'));
    expect(h.stopSounds).toHaveBeenCalled();
    expect(announced()).toBe(copy('listen.stopped'));
  });

  it('item 9: at 0 the open confirm closes as Keep it ranked', async () => {
    const h = harness();
    render(h);
    await reveal(h, 3);
    click(sound('listen'));
    expect(confirm()).not.toBeNull();
    tick(h, 0);
    expect(confirm()).toBeNull();
    expect(h.listenFirst).not.toHaveBeenCalled();
  });

  it('item 10: practice Listen first plays at once with no confirm; L does the same', async () => {
    const h = harness({ mode: 'practice' });
    render(h);
    await reveal(h);
    expect(sound('listen').textContent).toContain(copy('listen.practiceCaption'));
    click(sound('listen'));
    expect(confirm()).toBeNull();
    expect(h.listenFirst).toHaveBeenCalledTimes(1);
    key(document.body, 'l');
    expect(h.stopSounds).toHaveBeenCalledTimes(1);
    key(document.body, 'L');
    expect(h.listenFirst).toHaveBeenCalledTimes(2);
  });

  it('L in ranked opens the confirm', async () => {
    const h = harness();
    render(h);
    await reveal(h);
    key(document.body, 'l');
    expect(confirm()).not.toBeNull();
  });

  it('item 13, voice: Hear starting pitch with its caption and an info button whose text is section 10 verbatim', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'voice-baritone' }) });
    render(h);
    await reveal(h);
    const row = $('[data-sound="reference"]').closest('.sd-sound') ?? $('[data-sound="reference"]');
    expect(row.textContent).toContain(copy('action.hearReference'));
    expect(row.textContent).toContain(copy('reference.caption.voice'));
    const info = button(copy('reference.info.button', { control: copy('action.hearReference') }));
    expect(info.getAttribute('aria-expanded')).toBe('false');
    expect(info.getAttribute('title')).toBe(copy('reference.caption.voice'));
    click(info);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    const pop = $(`#${info.getAttribute('aria-controls')!}`);
    expect(pop.textContent).toContain(copy('reference.info.title.voice'));
    expect(pop.textContent).toContain(copy('reference.info.voice'));
    click(info);
    expect(info.getAttribute('aria-expanded')).toBe('false');
    // Touch: a press opens it too.
    act(() => {
      info.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' } as PointerEventInit));
      info.click();
    });
    expect(info.getAttribute('aria-expanded')).toBe('true');
    // Voices have no Check my tuning and no Hear the key.
    expect(hasSound('tuning')).toBe(false);
    expect(buttons().some((b) => b.textContent?.includes(copy('action.hearKey')))).toBe(false);
  });

  it('item 13, instrument: Hear the key with its caption and info; Check my tuning for winds', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'clarinet-bb' }) });
    render(h);
    await reveal(h);
    const row = $('[data-sound="reference"]').closest('.sd-sound') ?? $('[data-sound="reference"]');
    expect(row.textContent).toContain(copy('action.hearKey'));
    expect(row.textContent).toContain(copy('reference.caption.instrument'));
    const info = button(copy('reference.info.button', { control: copy('action.hearKey') }));
    click(info);
    const pop = $(`#${info.getAttribute('aria-controls')!}`);
    expect(pop.textContent).toContain(copy('reference.info.title.instrument'));
    expect(pop.textContent).toContain(copy('reference.info.instrument'));
    expect(hasSound('tuning')).toBe(true);
    expect(buttons().some((b) => b.textContent?.includes(copy('action.hearReference')))).toBe(false);
  });

  it('piano has no Check my tuning; practising without listening hides it for everyone', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'piano-rh' }) });
    render(h);
    await reveal(h);
    expect(hasSound('tuning')).toBe(false);
    m?.unmount();
    document.body.innerHTML = '';
    const s = defaultAppSettings();
    const h2 = harness({ prepared: testExcerpt({ instrumentId: 'flute' }), settings: { ...s, practice: { ...s.practice, listening: false } } });
    render(h2);
    await reveal(h2);
    expect(hasSound('tuning')).toBe(false);
    expect(hasSound('reference')).toBe(true);
  });

  it('captions: key chord with the key signature highlighted, then the first note, tempo, Listen bars, failure', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'voice-baritone' }) });
    render(h);
    await reveal(h);
    const p = h.services.session.prepared!;
    click(sound('reference'));
    expect(h.hearStartingPitch).toHaveBeenCalledTimes(1);
    const chord = copy('reference.playing.chord', { key: keyName(p.writtenKey) });
    expect(caption()).toBe(chord);
    expect(announced()).toBe(chord);
    expect($('[data-sound="reference"]').closest('[data-playing]')?.getAttribute('data-playing') ?? $('[data-sound="reference"]').getAttribute('data-playing')).toBe('true');
    const f = firstNoteOf(p)!;
    const note = firstNoteLabel(f.written, f.concertMidi);
    act(() => h.sounds.setState({ caption: { kind: 'first-note', written: f.written, concertMidi: f.concertMidi } }));
    expect(caption()).toBe(copy('reference.playing.first', { note }));
    expect(announced()).toBe(copy('reference.playing.first', { note }));
    click(sound('tempo'));
    expect(caption()).toBe(copy('sound.playing.tempo', { tempo: copy('tempo.marking', { unit: '♩', bpm: 100 }) }));
    act(() => h.sounds.setState({ playing: 'listen', caption: { kind: 'bar', bar: 3, of: 8 }, bar: 3 }));
    expect(caption()).toBe(copy('listen.playing', { n: 3, total: 8 }));
    // Bars are visual only: the polite region does not read each one.
    expect(announced()).not.toBe(copy('listen.playing', { n: 3, total: 8 }));
    act(() => h.sounds.setState({ playing: null, caption: null, bar: null, failed: true }));
    expect(caption()).toBe(copy('sound.failed'));
    expect($('[data-testid="live-caption"]').getAttribute('data-failed')).toBe('true');
  });

  it('Check my tuning: listening, then the result in the caption line; a failure says so', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'flute' }) });
    render(h);
    await reveal(h);
    expect($('[data-sound="tuning"]').textContent).toContain(copy('tuning.caption', { seconds: h.services.configs.grading.tuning.captureSec }));
    click(sound('tuning'));
    await flush();
    expect(caption()).toBe(copy('scan.tuning.result', { cents: 8, direction: copy('direction.flat') }));
    h.session.captureTuningNote.mockImplementationOnce(() => Promise.reject(new Error('quiet')));
    click(sound('tuning'));
    await flush();
    expect(caption()).toBe(copy('tuning.fail'));
  });

  it('Hear the key plays through the session for instruments; leaving the screen stops any sound', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'clarinet-bb' }) });
    render(h);
    await reveal(h);
    click(sound('reference'));
    expect(h.hearKey).toHaveBeenCalledTimes(1);
    expect(caption()).toBe(copy('reference.playing.chord', { key: keyName(h.services.session.prepared!.writtenKey) }));
    h.stopSounds.mockClear();
    m?.unmount();
    m = null;
    expect(h.stopSounds).toHaveBeenCalled();
  });

  it('the coach mark shows on the first read-through only and never returns', async () => {
    resetSoundsCoach();
    const h = harness();
    render(h, { coach: true });
    expect(document.querySelector('[data-testid="coach-mark"]')).toBeNull();
    await reveal(h);
    expect($('[data-testid="coach-mark"]').textContent).toContain(copy('scan.coach'));
    click(button(copy('action.gotIt')));
    expect(document.querySelector('[data-testid="coach-mark"]')).toBeNull();
    m?.unmount();
    document.body.innerHTML = '';
    const h2 = harness();
    render(h2, { coach: true });
    await reveal(h2);
    expect(document.querySelector('[data-testid="coach-mark"]')).toBeNull();
  });
});
