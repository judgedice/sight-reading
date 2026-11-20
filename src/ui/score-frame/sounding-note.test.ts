// @vitest-environment jsdom
// The sounding-note highlight (Listen playback review): the span search, the driver against a fake audio clock with
// output latency (each note lights at its audible time and goes off at its written end; a pickup lights inside the
// lead-in bar; a rest lights nothing), and the layer in a real laid-out frame (a system break moves the disc to the
// next system's SVG, reduced motion steps without animation, the scrolling arrangement follows the line).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ExcerptDoc, PreparedEvent, PreparedExcerpt, PreparedMeasure, SpelledPitch, Step } from '../../core/types.ts';
import { appConfigs } from '../../app/compose/configs.ts';
import * as notationModule from '../../notation/index.ts';
import { fixtureDoc } from '../../notation/testing/corpus-node.ts';
import { barsExcerpt, FRAME_FIXTURE_ID } from '../../../e2e/notation/score-frame-fixture.ts';
import { listenSourceOf, planListen } from '../../session/listen-plan.ts';
import { SOUND_LEAD_SEC, SoundPlayer } from '../../session/sounds.ts';
import { ScoreFrameController } from './controller.ts';
import { bindNotation } from './notation-binding.ts';
import { SoundingNoteDriver, SoundingNoteLayer, spanAt, type FrameLoop, type SoundingSource } from './sounding-note.ts';

const cfg = appConfigs();
const Q = 480;

const pitch = (name: string): SpelledPitch => {
  const m = /^([A-G])(\d)$/.exec(name);
  if (!m) throw new Error(name);
  return { step: m[1] as Step, alter: 0, octave: Number(m[2]) } as SpelledPitch;
};

/** 3/4 with a one-beat pickup: | G3 | C4 h, A3 q | B3 q, rest q, G3 q | C4 h. | (concert = written, baritone). */
function pickupExcerpt(): PreparedExcerpt {
  const bars: (string | null)[][] = [['G3'], ['C4', 'A3'], ['B3', null, 'G3'], ['C4']];
  const durs: number[][] = [[Q], [2 * Q, Q], [Q, Q, Q], [3 * Q]];
  const measures: PreparedMeasure[] = [];
  let tick = 0;
  let id = 0;
  bars.forEach((evs, i) => {
    const start = tick;
    const events: PreparedEvent[] = evs.map((p, k) => {
      const base = { id: `e${++id}`, tick, dur: durs[i]![k]! };
      tick += base.dur;
      if (p === null) return { ...base, kind: 'rest' } as PreparedEvent;
      return { ...base, kind: 'note', concertPitch: pitch(p), writtenPitch: pitch(p) } as PreparedEvent;
    });
    measures.push({ index: i, isPickup: i === 0, startTick: start, displayBar: i, events });
  });
  return {
    instrumentId: 'voice-baritone',
    excerptId: 'hand',
    meter: { beats: 3, beatType: 4, countUnitTicks: Q, countsPerBar: 3 },
    pickupTicks: Q,
    writtenKey: { fifths: 0, mode: 'major' },
    concertKey: { fifths: 0, mode: 'major' },
    clef: 'bass',
    measures,
    selection: { settings: { bpm: 60 } },
  } as unknown as PreparedExcerpt;
}

/** A clock and a frame loop driven by hand: `run(sec)` steps the audio clock 5 ms at a time and fires frames. */
function fakeAudio(lagSec: number) {
  let now = 20;
  const frames = new Map<number, () => void>();
  let ids = 0;
  const loop: FrameLoop = {
    requestAnimationFrame: (cb) => {
      frames.set(++ids, cb);
      return ids;
    },
    cancelAnimationFrame: (h) => void frames.delete(h),
  };
  const run = (sec: number): void => {
    const end = now + sec;
    while (now < end - 1e-9) {
      now += 0.005;
      const due = [...frames.values()];
      frames.clear();
      for (const f of due) f();
    }
  };
  const audio = { now: () => now as never, audibleNow: () => (now - lagSec) as never, stopSounds: () => undefined };
  const timers = { setTimeout: () => 0, clearTimeout: () => undefined };
  return { loop, run, audio, timers, now: () => now };
}

describe('spanAt', () => {
  const spans = [
    { startsAt: 1, endsAt: 2 },
    { startsAt: 2, endsAt: 2.5 },
    { startsAt: 3, endsAt: 4 },
  ];
  it('finds the span sounding at t: before, inside, at a boundary, in a gap, after', () => {
    expect(spanAt(spans, 0.5)).toBe(-1);
    expect(spanAt(spans, 1)).toBe(0);
    expect(spanAt(spans, 1.999)).toBe(0);
    expect(spanAt(spans, 2)).toBe(1);
    expect(spanAt(spans, 2.7)).toBe(-1);
    expect(spanAt(spans, 3.5, 1)).toBe(2);
    expect(spanAt(spans, 4)).toBe(-1);
    expect(spanAt([], 1)).toBe(-1);
    expect(spanAt(spans, NaN)).toBe(-1);
  });
  it('a stale hint after the time still finds the span', () => {
    expect(spanAt(spans, 1.5, 2)).toBe(0);
  });
});

describe('the driver on a fake audio clock (Listen at 60 bpm, 3/4, pickup and a rest, 150 ms output latency)', () => {
  it('each note lights at its audible time and goes off at its written end; the rest lights nothing', async () => {
    const lag = 0.15;
    const a = fakeAudio(lag);
    const prepared = pickupExcerpt();
    const plan = planListen(listenSourceOf(prepared, cfg), { bpm: 60, a4Hz: 440, accent: true });
    const player = new SoundPlayer(a.audio, a.timers);
    let origin = 0;
    await player.play({
      kind: 'listen',
      durSec: plan.endSec,
      segments: [{ atSec: 0, caption: { kind: 'lead-in', bpm: 60 } }],
      notes: plan.notes.map((n) => ({ idx: n.idx, eventIds: n.eventIds, atSec: n.startSec, untilSec: n.startSec + n.writtenSec })),
      schedule: async (o) => {
        origin = o;
      },
    });
    const source = player.view.getState().notes as SoundingSource;
    expect(source.spans.map((s) => s.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    // Changes as (scheduling clock, index) pairs.
    const changes: [number, number][] = [];
    const driver = new SoundingNoteDriver(source, a.loop, (i) => changes.push([a.now(), i]));
    driver.start();
    a.run(plan.endSec + 1);
    // Written: pickup G3 on beat 3 of the lead-in bar (2 s after the first click), then bar 1 at 3 s.
    const writtenOn = [2, 3, 5, 6, 8, 9].map((s) => origin + s + lag);
    const writtenOff = [3, 5, 6, 7, 9, 12].map((s) => origin + s + lag);
    const on = changes.filter(([, i]) => i >= 0);
    expect(on.map(([, i]) => i)).toEqual([0, 1, 2, 3, 4, 5]);
    on.forEach(([t], k) => {
      // Lit on the first frame at or after the audible time, never before it.
      expect(t).toBeGreaterThanOrEqual(writtenOn[k]! - 1e-9);
      expect(t - writtenOn[k]!).toBeLessThan(0.0051);
    });
    // Off: back to -1 only at the rest (B3 ends at 7 s, G3 starts at 8 s) and after the last note.
    const offs = changes.filter(([, i]) => i === -1).map(([t]) => t);
    expect(offs).toHaveLength(2);
    expect(offs[0]! - writtenOff[3]!).toBeGreaterThanOrEqual(-1e-9);
    expect(offs[0]! - writtenOff[3]!).toBeLessThan(0.0051);
    expect(offs[1]! - writtenOff[5]!).toBeLessThan(0.0051);
    // Inside the rest nothing is lit, and the pickup lit inside the lead-in bar (before bar 1's downbeat).
    expect(spanAt(source.spans, origin + 7.5)).toBe(-1);
    expect(writtenOn[0]! - lag).toBeLessThan(origin + plan.leadInSec);
    expect(origin).toBeCloseTo(20 + SOUND_LEAD_SEC, 6);
  });

  it('Stop clears at once and the loop ends', async () => {
    const a = fakeAudio(0.02);
    const changes: number[] = [];
    const source: SoundingSource = { spans: [{ idx: 0, eventIds: ['x'], startsAt: 20.01, endsAt: 30 }], clock: () => a.audio.audibleNow() as number };
    const driver = new SoundingNoteDriver(source, a.loop, (i) => changes.push(i));
    driver.start();
    a.run(0.1);
    expect(changes).toEqual([0]);
    driver.stop();
    a.run(0.1);
    expect(changes).toEqual([0, -1]);
    expect(driver.index).toBe(-1);
  });
});

// ---- the layer in a real frame -----------------------------------------------------------------------------------

const notation = bindNotation(notationModule);
let doc: ExcerptDoc;
beforeAll(() => {
  doc = fixtureDoc(FRAME_FIXTURE_ID);
});
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

function laidFrame(arrangement: 'slots' | 'all') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const c = new ScoreFrameController(host, notation, { appearance: { reducedMotion: () => true, highContrast: () => false } });
  c.setArrangement(arrangement);
  const p = barsExcerpt(doc, 12);
  c.layout(p, { viewport: { width: 390, height: 844 }, insets: { top: 47, bottom: 34 }, widthPx: 390, bpm: 120 }, notation.tickablesPerBar(p));
  return { host, c, p };
}

describe('SoundingNoteLayer in a laid-out frame', () => {
  it('draws one brass disc behind the note and inks its head brass; a system break moves it to the next system', () => {
    const { host, c, p } = laidFrame('all');
    const lay = c.info!.layout;
    const notes = p.measures.flatMap((m) => m.events).filter((e) => e.kind === 'note');
    const first = notes[0]!;
    const onNext = notes.find((e) => lay.noteBoxes.get(e.id)!.system === 1)!;
    const layer = new SoundingNoteLayer(c, host);

    layer.show({ idx: 0, eventIds: [first.id] }, { animate: false, follow: false });
    let discs = host.querySelectorAll('.sf-sounding');
    expect(discs).toHaveLength(1);
    expect(discs[0]!.closest('svg.sr-system')?.getAttribute('data-system')).toBe('0');
    expect(discs[0]!.getAttribute('fill')).toBe('var(--brass-wash)');
    expect(discs[0]!.getAttribute('stroke')).toBe('var(--brass)');
    // Reduced motion: no animation class.
    expect(discs[0]!.classList.contains('sf-sounding-in')).toBe(false);
    expect(host.getAttribute('data-sounding-note')).toBe('0');
    const inked = host.querySelectorAll<SVGElement>(`[data-event-id="${first.id}"]`);
    expect(inked.length).toBeGreaterThan(0);
    for (const g of inked) expect(g.style.color).toBe('var(--brass-ink)');

    layer.show({ idx: 9, eventIds: [onNext.id] }, { animate: true, follow: false });
    discs = host.querySelectorAll('.sf-sounding');
    expect(discs).toHaveLength(1);
    expect(discs[0]!.closest('svg.sr-system')?.getAttribute('data-system')).toBe('1');
    expect(discs[0]!.classList.contains('sf-sounding-in')).toBe(true);
    for (const g of inked) expect(g.style.color).toBe('');

    // A rest (no note) and the end clear everything; nothing else in the frame is touched.
    const before = host.querySelectorAll('.sf-hl, .sf-beat-line').length;
    layer.show(null, { animate: false, follow: false });
    expect(host.querySelectorAll('.sf-sounding')).toHaveLength(0);
    expect(host.hasAttribute('data-sounding-note')).toBe(false);
    expect(host.querySelectorAll('[data-sounding]')).toHaveLength(0);
    expect(host.querySelectorAll('.sf-hl, .sf-beat-line').length).toBe(before);
  });

  it('follows the line in the scrolling arrangement when the next system is off screen; never in the slots', () => {
    for (const arrangement of ['all', 'slots'] as const) {
      const { host, c, p } = laidFrame(arrangement);
      const lay = c.info!.layout;
      const onNext = p.measures.flatMap((m) => m.events).find((e) => e.kind === 'note' && lay.noteBoxes.get(e.id)!.system === 1)!;
      const svg = host.querySelector<SVGSVGElement>('svg.sr-system[data-system="1"]')!;
      const scrolled: unknown[] = [];
      svg.scrollIntoView = ((o?: unknown) => void scrolled.push(o)) as typeof svg.scrollIntoView;
      svg.getBoundingClientRect = () => ({ top: 2000, bottom: 2100, height: 100, left: 0, right: 390, width: 390, x: 0, y: 2000, toJSON: () => ({}) }) as DOMRect;
      const layer = new SoundingNoteLayer(c, host);
      layer.show({ eventIds: [onNext.id] }, { animate: false, follow: true });
      if (arrangement === 'all') expect(scrolled).toEqual([{ block: 'center', inline: 'nearest', behavior: 'auto' }]);
      else expect(scrolled).toEqual([]);
      // The same system again does not scroll again.
      layer.show({ eventIds: [onNext.id] }, { animate: false, follow: true });
      expect(scrolled.length).toBeLessThanOrEqual(1);
    }
  });
});
