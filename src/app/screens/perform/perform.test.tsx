// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FollowerEvent, GhostNote, LiveJudgment } from '../../../core/types.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { SoundPlayer, idleSoundView } from '../../../session/index.ts';
import { VOICE_REFERENCE } from '../../../session/take-plan.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { firstNoteLabel, midiOf } from '../scan/read-model.ts';
import { keyName } from '../setup/key-names.ts';
import { act, click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { PracticeFlowServicesProvider } from '../scan/services.ts';
import { PracticeApp, harness, testExcerpt, type Harness } from '../scan/test-support.tsx';

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
/** A switch (role="switch") by its visible label. */
const switchFor = (label: string): HTMLInputElement => {
  const sw = [...document.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find((x) => x.closest('label')?.textContent === label);
  if (!sw) throw new Error(`no switch ${label}`);
  return sw;
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
  it('a take that fails goes back to the read-through, which shows the error and Try again', async () => {
    const h = harness();
    await render(h);
    act(() => {
      h.view.setState({ error: { code: 'audio-setup', detail: 'x' } });
      h.session.emitState('error');
    });
    await flush();
    expect(h.location.hash).toBe('#/practice/scan');
    expect(document.querySelector('[data-testid="screen-practice.scan"]')?.getAttribute('data-state')).toBe('error');
    expect(document.body.textContent).toContain(copy('error.audioSetup'));
  });

  it('renders the strip, the frozen frame and the count-in label; focus is on Stop', async () => {
    const h = harness();
    await render(h);
    expect(document.activeElement).toBe(button(copy('play.stop')));
    expect($('.sf-host').getAttribute('data-frozen')).toBe('true');
    expect($('.sf-host').getAttribute('data-arrangement')).toBe('slots');
    expect($('.perform').getAttribute('data-mode')).toBe('ranked');
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.countIn'));
    expect($('.perform-tempo').textContent).toContain('♩ = 100');
    // No starting pitch for an instrument: the count-in strip has the mic meter (04-design §5); "Marks start at bar 1"
    // is for the starting pitch only (05 D7).
    expect(document.querySelector('.perform-marks-start')).toBeNull();
    expect(document.querySelector('.perform-mic')).toBeTruthy();
    expect($('.sf-host').getAttribute('data-purpose')).toBe('take');
    expect($('[role="status"].ui-visually-hidden').textContent).toBe(copy('a11y.countIn.announce.bars', { total: 1, beats: 4 }));
  });

  it('count-in track (PLAN R70): one bar, a plain 1 2 3 4, nothing says "Play" or marks the first note before bar 1', async () => {
    const h = harness();
    await render(h);
    expect($('.sf-host').hasAttribute('data-band')).toBe(true);
    expect(document.querySelectorAll('.sf-count-cell')).toHaveLength(4);
    expect([...document.querySelectorAll('.sf-count-group')].map((g) => g.getAttribute('data-tone'))).toEqual(['listen']);
    // No second set of beat dots in the strip during the count-in.
    expect(document.querySelector('.perform-toolbar .dom-beat-dot')).toBeNull();
    for (let k = 1; k <= 4; k++) {
      act(() => h.session.events.emit({ type: 'count-in', beat: k, of: 4, t: 0 as never }));
      const cur = [...document.querySelectorAll('.sf-count-cell')].findIndex((c) => c.getAttribute('data-state') === 'current');
      expect(cur).toBe(k - 1);
      expect(document.querySelectorAll('.sf-count-cell[data-state="past"]')).toHaveLength(k - 1);
      expect($('.sf-count-cell[data-state="current"]').textContent).toBe(String(k));
      expect($('.sf-count-title').textContent).toBe(copy('countIn.listen'));
      expect($('.sf-count-detail').textContent).not.toContain('Count-in bar');
      // No entry word in the track, and nothing on the first note.
      expect(document.querySelector('.sf-count-entry')).toBeNull();
      expect(document.querySelector('.sf-hl-name, .sf-hl-disc, .sf-hl-pulse, [data-brass]')).toBeNull();
      expect($('.perform').textContent).not.toMatch(/\b(Sing|Play)\b/);
    }
    act(() => h.session.emitState('performing'));
    expect($('.sf-host').hasAttribute('data-band')).toBe(false);
    expect(document.querySelector('.sf-hl-name, .sf-hl-disc, .sf-hl-pulse, [data-brass]')).toBeNull();
    // During the try nothing in the strip moves with the beat: no beat dots (PLAN R70, only the line moves).
    follower(h, { type: 'clock', scoreBeat: 0.02 });
    follower(h, { type: 'clock', scoreBeat: 2.4 });
    expect(document.querySelector('.dom-beat-dot')).toBeNull();
  });

  it('the count-in track is not a control: aria-hidden, no button role, nothing focusable', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.events.emit({ type: 'count-in', beat: 8, of: 8, t: 0 as never }));
    const track = $('.sf-count');
    expect(track.getAttribute('aria-hidden')).toBe('true');
    expect(track.querySelector('button, a, input, select, [role="button"], [tabindex]')).toBeNull();
    expect($('.sf-band').querySelector('button, a, input, select, [role="button"], [tabindex]')).toBeNull();
  });

  it('every system is at full ink from the first click; only the starting pitch dims the score', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'voice-baritone' }) });
    await render(h);
    expect($('.sf-host').hasAttribute('data-dim')).toBe(true);
    act(() => h.session.events.emit({ type: 'count-in', beat: 1, of: 8, t: 0 as never }));
    expect($('.sf-host').hasAttribute('data-dim')).toBe(false);
    expect($('.sf-count')).toBeTruthy();
  });

  it('a 1-bar count-in says "Count-in" and the tempo, not "Come in after 4" or "bar 1 of 1" (PLAN R70)', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.events.emit({ type: 'count-in', beat: 1, of: 4, t: 0 as never }));
    expect(document.querySelectorAll('.sf-count-cell')).toHaveLength(4);
    expect($('.sf-count-title').textContent).toBe(copy('countIn.listen'));
    expect($('.sf-count-detail').textContent).not.toContain(copy('countIn.barOf', { n: 1, total: 1 }));
    expect($('.sf-count-detail').textContent).toContain('♩ = 100');
  });

  it('a session sending a 2-bar count-in still draws both bars, the last one brass', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.events.emit({ type: 'count-in', beat: 5, of: 8, t: 0 as never }));
    expect(document.querySelectorAll('.sf-count-cell')).toHaveLength(8);
    expect([...document.querySelectorAll('.sf-count-group')].map((g) => g.getAttribute('data-tone'))).toEqual(['listen', 'last']);
    expect($('.sf-count-title').textContent).toBe('Come in after 4');
    expect(document.querySelector('.sf-count-entry')).toBeNull();
  });

  it('"Restarting the count-in" shows until the new count-in\'s second click, then the strip says "Count-in" (PLAN R70)', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.events.emit({ type: 'count-in', beat: 4, of: 4, t: 0 as never }));
    act(() => h.session.events.emit({ type: 'count-in-restart', reason: 'first-click-missing' }));
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.restartCountIn'));
    act(() => h.session.events.emit({ type: 'count-in', beat: 1, of: 4, t: 0 as never }));
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.restartCountIn'));
    act(() => h.session.events.emit({ type: 'count-in', beat: 2, of: 4, t: 0 as never }));
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.countIn'));
  });

  it('restarting the count-in empties the track', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.events.emit({ type: 'count-in', beat: 2, of: 8, t: 0 as never }));
    act(() => h.session.events.emit({ type: 'count-in-restart', reason: 'first-click-missing' }));
    expect(document.querySelector('.sf-count-cell[data-state="current"]')).toBeNull();
    expect(document.querySelector('.sf-count-cell[data-state="past"]')).toBeNull();
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

  it('voice: while the starting pitch is scheduled but not yet heard, its steps are pending and nothing marks the first note', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'voice-baritone' }) });
    await render(h);
    act(() => h.sounds.setState({ ...idleSoundView(), playing: 'reference', caption: null }));
    const steps = [...document.querySelectorAll('.perform-pitch-step')].map((x) => x.getAttribute('data-step'));
    expect(steps).toEqual(['pending', 'pending']);
    expect(document.querySelector('.perform-pitch-next')).toBeNull();
    expect(document.querySelector('.sf-hl-disc')).toBeNull();
  });

  it('voice: the starting-pitch card in the cue zone, its steps live from the session sounds, then the track', async () => {
    const h = harness({ prepared: testExcerpt({ instrumentId: 'voice-baritone' }) });
    await render(h);
    const p = h.services.session.prepared!;
    const note = p.measures.flatMap((m) => m.events).find((e) => e.kind === 'note') as { writtenPitch: Parameters<typeof midiOf>[0] };
    const w = note.writtenPitch;
    const steps = (): (string | null)[] => [...document.querySelectorAll('.perform-pitch-step')].map((x) => x.getAttribute('data-step'));
    // R0: the card is up from Start, before the first tone; the strip says when marks start.
    expect($('.perform-pitch-title').textContent).toBe(copy('countIn.reference'));
    expect($('.perform-pitch-why').textContent).toBe(copy('countIn.reference.why'));
    expect(steps()).toEqual(['pending', 'pending']);
    expect($('.perform-centre-text').textContent).toBe(copy('action.hearReference.short'));
    expect($('.perform-marks-start').textContent).toBe(copy('countIn.marksStart'));
    act(() => h.sounds.setState({ ...idleSoundView(), playing: 'reference', caption: { kind: 'key-chord', writtenKey: p.writtenKey, concertKey: p.concertKey } }));
    expect(steps()).toEqual(['live', 'pending']);
    expect($('.perform-pitch-step').textContent).toBe(copy('reference.playing.chord', { key: keyName(p.writtenKey) }));
    expect(document.querySelector('.sf-count')).toBeNull();
    act(() => h.sounds.setState({ ...idleSoundView(), playing: 'reference', caption: { kind: 'first-note', written: w, concertMidi: midiOf(w) } }));
    expect(steps()).toEqual(['done', 'live']);
    expect($('.perform-pitch-step[data-step="live"]').textContent).toBe(copy('reference.playing.first', { note: firstNoteLabel(w, midiOf(w)) }));
    expect($('.sf-hl-name').textContent).toBe(firstNoteLabel(w, midiOf(w)));
    act(() => h.sounds.setState({ ...idleSoundView(), playing: 'reference', caption: { kind: 'count-in-next' } }));
    expect(steps()).toEqual(['done', 'done']);
    expect($('.perform-pitch-next').textContent).toBe(copy('countIn.reference.next'));
    // The ring stays, without the name, so the note is easy to find again.
    expect($('.sf-hl-disc')).toBeTruthy();
    expect(document.querySelector('.sf-hl-name')).toBeNull();
    // The first click: the card goes, the track takes the cue zone, the score is at full ink.
    act(() => h.sounds.setState(idleSoundView()));
    act(() => h.session.events.emit({ type: 'count-in', beat: 1, of: 4, t: 0 as never }));
    expect(document.querySelector('.perform-pitch')).toBeNull();
    // The starting pitch's first-note mark goes with the card (PLAN R70: nothing on the first note in the count-in).
    expect(document.querySelector('.sf-hl-disc, .sf-hl-name, [data-brass]')).toBeNull();
    expect(document.querySelector('.sf-count-entry')).toBeNull();
    expect(document.querySelector('.sf-count')!.textContent).not.toContain(copy('countIn.entry.voice'));
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.countIn'));
    expect(document.querySelector('.perform-marks-start')).toBeNull();
    expect(document.querySelector('.perform-mic')).toBeTruthy();
  });

  it('the card step changes within 50 ms of each reference segment time', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ prepared: testExcerpt({ instrumentId: 'voice-baritone' }) });
      let now = 0;
      const player = new SoundPlayer({ now: () => now as never, stopSounds: () => undefined }, { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (x) => clearTimeout(x as never) });
      (h.services as { sounds: unknown }).sounds = player.view;
      h.session.pending.mode = 'ranked';
      h.location.hash = '#/practice/play';
      m = mount(
        <PracticeFlowServicesProvider value={h.services}>
          <PracticeApp h={h} />
        </PracticeFlowServicesProvider>,
      );
      act(() => h.session.emitState('count-in'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const p = h.services.session.prepared!;
      const first = p.measures.flatMap((mm) => mm.events).find((e) => e.kind === 'note') as { writtenPitch: Parameters<typeof midiOf>[0] };
      const r = VOICE_REFERENCE;
      const firstAt = 3 * (r.triadToneSec + r.gapSec) + r.gapSec;
      const len = firstAt + r.firstNoteSec;
      const lead = 0.6;
      const segments = [
        { atSec: 0, caption: { kind: 'key-chord' as const, writtenKey: p.writtenKey, concertKey: p.concertKey } },
        { atSec: firstAt, caption: { kind: 'first-note' as const, written: first.writtenPitch, concertMidi: midiOf(first.writtenPitch) } },
        { atSec: len, caption: { kind: 'count-in-next' as const } },
      ];
      act(() => player.follow({ kind: 'reference', durSec: len + 0.6, segments }, lead));
      const steps = (): string => [...document.querySelectorAll('.perform-pitch-step')].map((x) => x.getAttribute('data-step')).join(',');
      const expected = ['live,pending', 'done,live', 'done,done'];
      let t = 0;
      for (const [i, s] of segments.entries()) {
        const due = (lead + s.atSec) * 1000;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(due - 1 - t);
        });
        expect(steps()).not.toBe(expected[i]);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        t = due + 49;
        now = t / 1000;
        expect(steps()).toBe(expected[i]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('the strip says "Bar 3 of 8" with the tempo beside it', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'clock', scoreBeat: 9 });
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.bar', { n: 3, total: 8 }));
    expect($('.perform-tempo').textContent).toContain('♩ = 100');
  });

  it('without the audible clock the strip follows the follower clock, and no bar is ever washed (round 2: beat line)', async () => {
    const h = harness();
    await render(h);
    act(() => h.session.emitState('performing'));
    for (const beat of [0.1, 3.9, 4.2, 9, 13.5]) {
      follower(h, { type: 'clock', scoreBeat: beat });
      const n = Math.floor(beat / 4) + 1;
      expect($('.perform-centre-text').textContent).toBe(copy('play.status.bar', { n, total: 8 }));
      expect(document.querySelector('.sr-bar-tint')).toBeNull();
      expect(document.querySelector('.sf-hl-bar')).toBeNull();
    }
    // No audible clock, no beat line and no switch for it.
    expect(document.querySelector('.sf-beat-line')).toBeNull();
    expect(document.querySelector('.perform-beatline')).toBeNull();
    act(() => h.session.emitState('count-in'));
    act(() => h.session.events.emit({ type: 'count-in-restart', reason: 'stop-before-first-note' }));
    expect($('.sr-playhead').getAttribute('visibility')).toBe('hidden');
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
    const h = harness({ prepared: testExcerpt({ levelServed: 4 }) });
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
    act(() => h.session.emitState('performing'));
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

  const ghostOf = (id: number, kind: GhostNote['kind']): GhostNote => ({ detectedId: id, scoreBeat: 0.1 + id, writtenPitch: { step: 'D', alter: 0, octave: 5 }, kind, centsError: null, targetExpectedIdx: kind === 'extra' ? null : 1, displaced: false });
  const tryWithGhosts = async (level: number, ghostsLive?: 'from4' | 'always' | 'never'): Promise<{ ghosts: number }> => {
    const s = defaultAppSettings();
    const h = harness({ prepared: testExcerpt({ levelServed: level }), ...(ghostsLive ? { settings: { ...s, display: { ...s.display, ghostsLive } } } : {}) });
    await render(h);
    // Heard before bar 1: never drawn, at any difficulty.
    follower(h, { type: 'ghost', ghost: ghostOf(99, 'extra') });
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'clock', scoreBeat: 0.5 });
    follower(h, { type: 'ghost', ghost: ghostOf(1, 'wrong-pitch') });
    follower(h, { type: 'ghost', ghost: ghostOf(2, 'extra') });
    return { ghosts: $('.sf-host').querySelectorAll('.sr-ghost').length };
  };

  it('difficulty 1 with "from difficulty 4": the heard note of a wrong pitch draws live (PLAN R71), extras wait', async () => {
    const r = await tryWithGhosts(1);
    expect(r.ghosts).toBe(1);
    expect($('.sf-host .sr-ghost').getAttribute('data-kind')).toBe('wrong-pitch');
  });

  it('difficulty 1: a sharp heard note draws live with its up arrow, a flat one with its down arrow (PLAN R71)', async () => {
    const h = harness({ prepared: testExcerpt({ levelServed: 1 }) });
    await render(h);
    act(() => h.session.emitState('performing'));
    follower(h, { type: 'clock', scoreBeat: 0.5 });
    follower(h, { type: 'ghost', ghost: { ...ghostOf(1, 'sharp'), centsError: 45 } });
    follower(h, { type: 'ghost', ghost: { ...ghostOf(2, 'flat'), targetExpectedIdx: 2, centsError: -40 } });
    const ghosts = [...$('.sf-host').querySelectorAll('.sr-ghost')];
    expect(ghosts.map((g) => g.getAttribute('data-direction'))).toEqual(['up', 'down']);
    expect(ghosts.map((g) => g.querySelector('.sr-ghost-arrow')?.getAttribute('data-arrow'))).toEqual(['up', 'down']);
  });

  it('difficulty 4 with "from difficulty 4": ghosts and extras draw live, but never before bar 1', async () => {
    const r = await tryWithGhosts(4);
    expect(r.ghosts).toBe(2);
  });

  it('"Always" and "Never" override the difficulty', async () => {
    expect((await tryWithGhosts(1, 'always')).ghosts).toBe(2);
    m?.unmount();
    m = null;
    document.body.innerHTML = '';
    // "Never" hides extras and timing ghosts; the heard note of a wrong pitch is always drawn (PLAN R71).
    expect((await tryWithGhosts(6, 'never')).ghosts).toBe(1);
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

// Beat line (round 2): the try screen on an audible clock. The test drives the animation frames by hand.
describe('Performance screen on the audible clock', () => {
  const BPM = 100; // the harness excerpt's tempo, 4/4
  const BEAT = 60 / BPM;
  const T0 = 50;
  interface Clocked {
    h: Harness;
    setAudible(t: number): void;
    frame(): void;
  }
  function clocked(over: Parameters<typeof harness>[0] = {}): Clocked {
    const h = harness(over);
    let audible = 0;
    h.services.audibleNow = () => audible;
    (h.session as unknown as { takeClock: unknown }).takeClock = { t0: T0, bpm: BPM, countInBeats: 8 };
    h.services.setBeatLine = (on) => {
      const s = h.settings.get();
      h.settings.set({ ...s, display: { ...s.display, beatLine: on } });
    };
    const frames: (() => void)[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (frames.push(() => cb(0)), frames.length));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    return {
      h,
      setAudible: (t) => (audible = t),
      frame: () => act(() => frames.splice(0).forEach((f) => f())),
    };
  }
  const at = (c: Clocked, beat: number): void => {
    c.setAudible(T0 + beat * BEAT);
    c.frame();
  };
  const line = (): Element | null => {
    const el = document.querySelector('line.sf-beat-line');
    return el && el.getAttribute('visibility') === 'visible' ? el : null;
  };
  const lineX = (): number => Number(/translate\(([-\d.]+) 0\)/.exec(line()!.getAttribute('transform') ?? '')![1]);
  afterEach(() => vi.restoreAllMocks());

  it('the count-in track follows the audible clock, not the session events; the line waits at the first note', async () => {
    const c = clocked();
    await render(c.h);
    at(c, -8.01);
    expect(document.querySelectorAll('.sf-count-cell[data-state="current"]')).toHaveLength(0);
    expect(line()).toBeNull();
    // A session event says click 3 already (the context clock is ahead of the speakers): the track waits for the sound.
    act(() => c.h.session.events.emit({ type: 'count-in', beat: 3, of: 8, t: (T0 - 6 * BEAT) as never }));
    expect(document.querySelectorAll('.sf-count-cell[data-state="current"]')).toHaveLength(0);
    at(c, -8);
    expect([...document.querySelectorAll('.sf-count-cell')].findIndex((e) => e.getAttribute('data-state') === 'current')).toBe(0);
    const wait = lineX();
    at(c, -5);
    expect([...document.querySelectorAll('.sf-count-cell')].findIndex((e) => e.getAttribute('data-state') === 'current')).toBe(3);
    at(c, -0.5);
    expect(lineX()).toBe(wait);
    // PLAN R70: nothing on the first note and no entry word before the music is heard.
    expect(document.querySelector('.sf-hl-name, .sf-hl-disc, [data-brass]')).toBeNull();
    expect(document.querySelector('.sf-count-entry')).toBeNull();
    // The session reaches the music first; the track stays until the downbeat is heard.
    act(() => c.h.session.emitState('performing'));
    expect(document.querySelector('.sf-count')).not.toBeNull();
    expect(document.querySelector('.sf-count-entry')).toBeNull();
    // The downbeat: the go word, for the first beat only, and still nothing on the first note.
    at(c, 0);
    expect($('.sf-count-entry').getAttribute('data-on')).toBe('true');
    expect($('.sf-count-entry .sf-count-word').textContent).toBe(copy('countIn.entry.instrument'));
    expect(document.querySelector('.sf-hl-name, .sf-hl-disc, .sf-hl-pulse, [data-brass]')).toBeNull();
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.bar', { n: 1, total: 8 }));
    expect(lineX()).toBe(wait);
    at(c, 1);
    expect(document.querySelector('.sf-count')).toBeNull();
  });

  it('moves the line every frame with no React render, and the strip once per beat and bar', async () => {
    const c = clocked();
    let commits = 0;
    await render(c.h, 'ranked', () => commits++);
    act(() => c.h.session.emitState('performing'));
    at(c, 0);
    at(c, 0.1);
    const before = commits;
    const xs: number[] = [];
    for (let i = 1; i <= 8; i++) {
      at(c, 0.1 + i * 0.1);
      xs.push(lineX());
    }
    expect(commits).toBe(before);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    // Beat 2: the go word and the track go (a commit or two), then one commit per beat.
    at(c, 1);
    const afterGo = commits;
    expect(afterGo - before).toBeGreaterThanOrEqual(1);
    expect(afterGo - before).toBeLessThanOrEqual(3);
    at(c, 2);
    expect(commits).toBe(afterGo + 1);
    expect(document.querySelector('.dom-beat-dot')).toBeNull();
    at(c, 9);
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.bar', { n: 3, total: 8 }));
    // The follower's clock (a round trip late) no longer moves the strip.
    follower(c.h, { type: 'clock', scoreBeat: 2 });
    expect($('.perform-centre-text').textContent).toBe(copy('play.status.bar', { n: 3, total: 8 }));
  });

  it('the switch turns the line off and on and remembers it; Settings off means nothing moves on the staff', async () => {
    const c = clocked();
    await render(c.h);
    act(() => c.h.session.emitState('performing'));
    at(c, 0.5);
    expect(line()).not.toBeNull();
    const sw = switchFor(copy('play.beatLine'));
    expect(sw.checked).toBe(true);
    click(sw);
    expect(c.h.settings.get().display.beatLine).toBe(false);
    at(c, 0.6);
    expect(line()).toBeNull();
    expect(switchFor(copy('play.beatLine')).checked).toBe(false);
    click(switchFor(copy('play.beatLine')));
    at(c, 0.7);
    expect(line()).not.toBeNull();

    m?.unmount();
    const s = defaultAppSettings();
    const off = clocked({ settings: { ...s, display: { ...s.display, beatLine: false } } });
    await render(off.h);
    act(() => off.h.session.emitState('performing'));
    for (const b of [-3, 0, 2.5, 7]) {
      at(off, b);
      expect(line()).toBeNull();
    }
  });

  it('under reduced motion the line steps on the beat', async () => {
    const c = clocked();
    c.h.services.reducedMotion = () => true;
    await render(c.h);
    act(() => c.h.session.emitState('performing'));
    at(c, 2);
    const x2 = lineX();
    at(c, 2.6);
    expect(lineX()).toBe(x2);
    at(c, 3);
    expect(lineX()).toBeGreaterThan(x2);
  });
});
