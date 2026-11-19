// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FollowerEvent, GhostNote, LiveJudgment } from '../../../core/types.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { idleSoundView } from '../../../session/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { firstNoteLabel, midiOf } from '../scan/read-model.ts';
import { keyName } from '../setup/key-names.ts';
import { act, click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { PracticeFlowServicesProvider } from '../scan/services.ts';
import { PracticeApp, harness, type Harness } from '../scan/test-support.tsx';

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

async function render(h: Harness, mode: 'ranked' | 'practice' = 'ranked', onRender?: () => void): Promise<void> {
  h.session.pending.mode = mode;
  h.location.hash = '#/practice/play';
  const app = (
    <PracticeFlowServicesProvider value={h.services}>
      <PracticeApp h={h} />
    </PracticeFlowServicesProvider>
  );
  m = mount(onRender ? <Profiler id="screen" onRender={onRender}>{app}</Profiler> : app);
  act(() => h.session.emitState('count-in'));
  await flush();
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
const dialogButton = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no dialog button ${label}`);
  return b as HTMLButtonElement;
};
const follower = (h: Harness, event: FollowerEvent): void => {
  act(() => h.session.events.emit({ type: 'follower', event }));
};
const judgment = (idx: number): LiveJudgment =>
  ({ expectedIdx: idx, status: 'matched', timing: { verdict: 'late', deltaMs: 180 }, pitch: { verdict: 'ok', centsOff: 0 }, provisional: false }) as unknown as LiveJudgment;

describe('Performance screen', () => {
  it('renders the strip, the frozen frame and the count-in label; focus is on Stop', async () => {
    const h = harness();
    await render(h);
    expect(document.activeElement).toBe(button(copy('play.stop')));
    expect($('.sf-host').getAttribute('data-frozen')).toBe('true');
    expect($('.sf-host').getAttribute('data-arrangement')).toBe('slots');
    expect($('.perform').getAttribute('data-mode')).toBe('ranked');
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.countIn'));
    expect($('.perform-tempo').textContent).toContain('♩ = 100');
    expect($('.perform-mic-label').textContent).toBe('Mic');
    expect($('.sf-host').getAttribute('data-purpose')).toBe('take');
    expect($('[role="status"].ui-visually-hidden').textContent).toBe(copy('a11y.countIn.announce'));
  });

  it('the count-in band shows the beat number above the score; the strip shows dots; the take shows dots only', async () => {
    const h = harness();
    await render(h);
    expect($('.sf-host').hasAttribute('data-band')).toBe(true);
    expect($('.sf-count-caption').textContent).toBe('Bar 1 · ♩ = 100');
    for (let k = 1; k <= 4; k++) {
      act(() => h.session.events.emit({ type: 'count-in', beat: k, of: 4, t: 0 as never }));
      expect($('.sf-count-num').textContent).toBe(String(k));
      expect($('.sf-count-dot[data-state="current"]').parentElement?.children[k - 1]).toBe($('.sf-count-dot[data-state="current"]'));
      expect($('.perform-toolbar .dom-beat-dot[data-state="pulse"]').getAttribute('data-beat')).toBe(String(k));
    }
    expect($('.sf-count-dot[data-downbeat]')).toBeTruthy();
    expect(document.querySelector('.dom-beat-number')).toBeNull();
    act(() => h.session.emitState('performing'));
    expect($('.sf-host').hasAttribute('data-band')).toBe(false);
    follower(h, { type: 'clock', scoreBeat: 0.02 });
    expect($('.dom-beat-dot[data-state="pulse"]').getAttribute('data-beat')).toBe('1');
    follower(h, { type: 'clock', scoreBeat: 2.4 });
    expect($('.dom-beat-dot[data-state="pulse"]').getAttribute('data-beat')).toBe('3');
  });

  it('restarting the count-in clears the number and the dots', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.events.emit({ type: 'count-in', beat: 2, of: 4, t: 0 as never }));
    act(() => h.session.events.emit({ type: 'count-in-restart', reason: 'first-click-missing' }));
    expect($('.sf-count-num').textContent).toBe('');
    expect(document.querySelector('.perform-toolbar .dom-beat-dot[data-state="pulse"]')).toBeNull();
  });

  it('the count-in band sits in the top margin and never overlaps the first system', async () => {
    const h = harness();
    await render(h);
    const band = $('.sf-band');
    const frame = $('.sf-host');
    expect(frame.hasAttribute('data-band')).toBe(true);
    expect(band.parentElement).toBe(frame);
    // The frame places the band's bottom edge above the first system's highest ink (ledger lines and stems included),
    // so the band's box ends where the first system's box begins.
    const bandBottom = parseFloat(band.style.getPropertyValue('--sf-band-bottom'));
    expect(Number.isFinite(bandBottom)).toBe(true);
    const slot = $('.sr-slot[data-system="0"]');
    const stage = frame.querySelector<HTMLElement>('.sf-stage')!;
    expect(bandBottom).toBeLessThanOrEqual(stage.offsetTop + slot.offsetTop + slot.offsetHeight);
  });

  it('voice: "Your starting pitch" band with the key chord, then the first note, live from the session sounds', async () => {
    const h = harness();
    await render(h);
    const p = h.services.session.prepared!;
    const note = p.measures.flatMap((m) => m.events).find((e) => e.kind === 'note') as { writtenPitch: Parameters<typeof midiOf>[0] };
    const w = note.writtenPitch;
    act(() => h.sounds.setState({ ...idleSoundView(), playing: 'reference', caption: { kind: 'key-chord', writtenKey: p.writtenKey, concertKey: p.concertKey } }));
    expect($('.perform-pitch-title').textContent).toBe(copy('countIn.reference'));
    expect($('.perform-centre-text').textContent).toBe(copy('action.hearReference.short'));
    expect([...document.querySelectorAll('.perform-pitch-step')].map((x) => x.getAttribute('data-step'))).toEqual(['live', 'pending']);
    expect($('.perform-pitch-step').textContent).toBe(copy('reference.playing.chord', { key: keyName(p.writtenKey) }));
    expect(document.querySelector('.sf-count')).toBeNull();
    act(() => h.sounds.setState({ ...idleSoundView(), playing: 'reference', caption: { kind: 'first-note', written: w, concertMidi: midiOf(w) } }));
    expect([...document.querySelectorAll('.perform-pitch-step')].map((x) => x.getAttribute('data-step'))).toEqual(['done', 'live']);
    expect($('.perform-pitch-step[data-step="live"]').textContent).toBe(copy('reference.playing.first', { note: firstNoteLabel(w, midiOf(w)) }));
    // The reference ends: the clicks and the big number take over.
    act(() => h.sounds.setState(idleSoundView()));
    expect(document.querySelector('.perform-pitch')).toBeNull();
    expect($('.sf-count')).toBeTruthy();
  });

  it('the strip says "Bar 3 of 8" with the tempo beside it', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'clock', scoreBeat: 9 });
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.bar', { n: 3, total: 8 }));
    expect($('.perform-tempo').textContent).toContain('♩ = 100');
  });

  it('status messages: no-signal beats lost-place beats come-in-at', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'status', kind: 'come-in-at', bar: 5 });
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.comeIn', { n: 5 }));
    follower(h, { type: 'status', kind: 'lost-place' });
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.lostPlace'));
    follower(h, { type: 'status', kind: 'no-signal' });
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.noSignal'));
  });

  it('marks notes and shows ghosts through the overlay without re-rendering the screen', async () => {
    const h = harness();
    let commits = 0;
    await render(h, 'ranked', () => commits++);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'clock', scoreBeat: 0.02 });
    const before = commits;
    const ghost = { detectedId: 1, scoreBeat: 0.1, writtenPitch: { step: 'D', alter: 0, octave: 5 }, kind: 'wrong-pitch', centsError: null, targetExpectedIdx: 1, displaced: false } as GhostNote;
    for (let i = 0; i < 100; i++) {
      follower(h, { type: 'clock', scoreBeat: 0.02 + i * 0.001 });
      follower(h, { type: 'judgment', judgment: judgment(i % 8) });
      follower(h, { type: 'ghost', ghost: { ...ghost, detectedId: i } });
      follower(h, { type: 'missed', expectedIdx: 7 });
    }
    expect(commits).toBe(before);
    expect($('.sf-host').querySelectorAll('.sr-ghost').length).toBeGreaterThan(0);
    expect($('.sf-host').querySelector('line.sr-playhead')).toBeTruthy();
  });

  it('queues events that arrive before the frame is laid out', async () => {
    const h = harness();
    h.location.hash = '#/practice/play';
    m = mount(
      <PracticeFlowServicesProvider value={h.services}>
        <PracticeApp h={h} />
      </PracticeFlowServicesProvider>,
    );
    act(() => h.session.emitState('count-in'));
    follower(h, { type: 'missed', expectedIdx: 0 });
    await flush();
    expect($('.sf-host').querySelector('[data-expected-idx="0"]')).toBeTruthy();
  });

  it('the meter updates only when the drawn bar changes', async () => {
    const h = harness();
    let commits = 0;
    await render(h, 'ranked', () => commits++);
    follower(h, { type: 'level', levelDb: -30, clipping: false });
    expect($('.perform-mic').getAttribute('data-zone')).toBe('good');
    expect(document.querySelectorAll('.perform-mic-bars i[data-lit="true"]')).toHaveLength(4);
    const before = commits;
    for (let i = 0; i < 50; i++) follower(h, { type: 'level', levelDb: -30.001, clipping: false });
    expect(commits).toBe(before);
    follower(h, { type: 'level', levelDb: -1, clipping: true });
    expect($('.perform-mic').getAttribute('data-zone')).toBe('clipping');
    expect($('.perform-mic-bang').textContent).toBe(copy('play.meter.clip'));
  });

  it('Stop opens the confirm; Keep playing leaves the take running (practice)', async () => {
    const h = harness();
    await render(h, 'practice');
    click(button(copy('play.stop')));
    expect($('[role="dialog"]').textContent).toContain(copy('play.stopConfirm.practice'));
    click(dialogButton(copy('action.keepPlaying')));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.session.stop).not.toHaveBeenCalled();
    click(button(copy('play.stop')));
    click(dialogButton(copy('action.stop')));
    expect(h.session.stop).toHaveBeenCalledTimes(1);
  });

  it('ranked after the first note: "Stop now?" with Keep playing as the default', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'note-start', detectedId: 1, scoreBeat: 0, provisionalConcertMidi: 60, matchedExpected: 0, displaced: false });
    click(button(copy('play.stop')));
    expect($('[role="dialog"]').textContent).toContain(copy('play.stopConfirm.ranked.afterNote'));
    expect(document.activeElement).toBe(button(copy('action.keepPlaying')));
  });

  it('ranked before the first note: Restart asks the session once; Stop asks again so the take ends', async () => {
    const h = harness();
    await render(h);
    click(button(copy('play.stop')));
    expect($('[role="dialog"]').textContent).toContain(copy('play.stopConfirm.ranked.beforeNote'));
    expect(document.activeElement).toBe(button(copy('action.restart')));
    click(dialogButton(copy('action.restart')));
    expect(h.session.stop).toHaveBeenCalledTimes(1);

    click(button(copy('play.stop')));
    click(dialogButton(copy('action.stop')));
    await flush();
    expect(h.session.stop).toHaveBeenCalledTimes(3); // 1 restart, then stop + the repeat because the count-in is still running
  });

  it('Esc stops at once with no sheet, and closes the confirm when one is open', async () => {
    const h = harness();
    await render(h, 'practice');
    key(document, 'Escape');
    expect(h.session.stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(button(copy('play.stop')));
    key(document, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.session.stop).toHaveBeenCalledTimes(1);
  });

  it('finishing shows "Scoring…" and the results follow the session', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.emitState('finishing'));
    expect($('.perform-centre-text').textContent).toBe(copy('results.scoring'));
    expect($('[role="status"].ui-visually-hidden').textContent).toBe(copy('a11y.take.finished'));
    act(() => h.session.emitState('results'));
    expect(h.location.hash).toBe('#/practice/results');
  });

  it('only Stop is a control during a take, and the score has no buttons', async () => {
    const h = harness();
    await render(h);
    const controls = [...document.querySelectorAll('button, a, input, select')];
    expect(controls.map((c) => c.textContent)).toEqual([copy('play.stop')]);
    expect($('[data-testid="perform-score"]').querySelector('button, a, input')).toBeNull();
  });

  it('after-the-take mode draws no marks during the take', async () => {
    const s = defaultAppSettings();
    const h = harness({ settings: { ...s, display: { ...s.display, liveFeedback: 'after-take' } } });
    await render(h);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'ghost', ghost: { detectedId: 1, scoreBeat: 0.1, writtenPitch: { step: 'D', alter: 0, octave: 5 }, kind: 'wrong-pitch', centsError: null, targetExpectedIdx: 1, displaced: false } as GhostNote });
    expect($('.sf-host').querySelectorAll('.sr-ghost')).toHaveLength(0);
  });

  it('a short viewport keeps the message in the strip', async () => {
    const h = harness();
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    try {
      await render(h);
      expect($('.perform-centre-text').textContent).toBe(copy('play.status.countIn'));
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    }
  });

  it('CC BY items show the source line under the score', async () => {
    const h = harness();
    const e = h.services.session.prepared!;
    (e as { source: unknown }).source = { ...e.source, license: 'CC-BY-4.0', encoder: 'A. Encoder', corpus: 'openscore-lieder' };
    h.view.setState({ prepared: e }, false);
    await render(h);
    expect($('.perform-source').textContent).toContain(copy('credit.source', { encoder: 'A. Encoder', corpus: 'openscore-lieder' }));
  });
});
