// @vitest-environment jsdom
// Beat line (round 2): with the fake backend's clock, at the moment each click is heard (`audibleNow() === click.t`)
// the beat line sits on that beat's x within 1 px, for 2/4, 3/4, 4/4, 6/8 and pickups, at output latencies of 0, 30
// and 100 ms. On a beat where a note starts, "that beat's x" is the notehead's centre from the engraved layout, so
// the line crosses each note at its written time. The count-in track counts the clicks as they are heard, the line
// waits at the first note through the count-in, and under reduced motion it steps beat by beat.
import { afterEach, describe, expect, it } from 'vitest';
import type { ClickSpec } from '../../../core/platform.ts';
import type { PreparedExcerpt } from '../../../core/types.ts';
import * as notationModule from '../../../notation/index.ts';
import { fixtureDoc } from '../../../notation/testing/corpus-node.ts';
import { preparedFromDoc } from '../../../notation/testing/prepared.ts';
import { FakeAudioBackend } from '../../../testkit/fake-backend.ts';
import { ScoreFrameController, bindNotation } from '../../../ui/score-frame/index.ts';
import { musicFacts, timingOf, visualAt } from './beat-clock.ts';
import { BeatDriver, type BeatView } from './beat-driver.ts';

const notation = bindNotation(notationModule);

const FIXTURES = [
  { meter: '2/4', id: 'mayer-sq7588853-violin1-mv4-m253-260', pickup: false },
  { meter: '3/4', id: 'holmes-lc5669865-voice-m55-62', pickup: false },
  { meter: '4/4', id: 'holmes-lc5855050-voice-m1-8', pickup: false },
  { meter: '6/8', id: 'gouvy-sq10406164-cello-mv3-m1-10', pickup: false },
  { meter: '4/4 with a pickup', id: 'le-beau-lc5883655-voice-mp1-9', pickup: true },
  { meter: '6/8 with a pickup', id: 'mozart-sq7353137-violin1-mv1-mp0-8', pickup: true },
  { meter: '3/4 with a pickup', id: 'haydn-sq9961690-violin2-mv2-mp0-8', pickup: true },
] as const;
const LATENCIES_SEC = [0, 0.03, 0.1] as const;
const BPM = 72;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
  document.documentElement.removeAttribute('data-score-frozen');
});

function laidOut(p: PreparedExcerpt): { c: ScoreFrameController; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const c = new ScoreFrameController(host, notation, { appearance: { reducedMotion: () => false, highContrast: () => false } });
  c.layout(p, { viewport: { width: 1440, height: 900 }, insets: { top: 0, bottom: 0 }, widthPx: 1200, bpm: BPM, purpose: 'take', heightPx: 2000 }, notation.tickablesPerBar(p));
  c.freeze({ width: 1200, height: 2000 });
  return { c, host };
}

/** The drawn line: its system and x (the transform), or null when hidden. */
function lineOf(host: HTMLElement): { system: number; x: number } | null {
  const el = host.querySelector('line.sf-beat-line');
  if (!el || el.getAttribute('visibility') !== 'visible') return null;
  const m = /translate\(([-\d.]+) 0\)/.exec(el.getAttribute('transform') ?? '');
  return { system: Number(el.closest('svg')!.getAttribute('data-system')), x: Number(m![1]) };
}

/** Score beat → the centre of the notehead that starts on it (first piece of each note), from the layout. */
function onsetCentres(c: ScoreFrameController, p: PreparedExcerpt): Map<number, { system: number; x: number }> {
  const out = new Map<number, { system: number; x: number }>();
  const lay = c.info!.layout;
  for (const m of p.measures) {
    for (const e of m.events) {
      if (e.kind !== 'note') continue;
      const box = lay.noteBoxes.get(e.id);
      const beat = (e.tick - p.pickupTicks) / p.meter.countUnitTicks;
      if (box && !out.has(beat)) out.set(beat, { system: box.system, x: box.x + box.w / 2 });
    }
  }
  return out;
}

async function scheduled(p: PreparedExcerpt, latencySec: number) {
  const be = new FakeAudioBackend({ route: { reportedLatencySec: latencySec } });
  const bpb = p.meter.countsPerBar;
  const lastBar = p.measures.at(-1)!;
  const totalBeats = (lastBar.startTick - p.pickupTicks) / p.meter.countUnitTicks + bpb;
  const r = await be.scheduleTake({ leadSec: 0.5, bpm: BPM, beatsPerBar: bpb, countInBeats: 2 * bpb, totalBeats, mode: 'audible', timbre: 'classic', accentDb: 5 });
  return { be, t0: r.t0 as number, clicks: r.clicks, countInBeats: 2 * bpb, totalBeats };
}

describe('the beat line meets each click as the player hears it', () => {
  for (const f of FIXTURES) {
    for (const lat of LATENCIES_SEC) {
      it(`${f.meter}, output latency ${lat * 1000} ms`, async () => {
        const p = preparedFromDoc(fixtureDoc(f.id), 'treble');
        expect(p.pickupTicks > 0).toBe(f.pickup);
        const { c, host } = laidOut(p);
        const { be, t0, clicks, countInBeats, totalBeats } = await scheduled(p, lat);
        const timing = timingOf({ t0, bpm: BPM, countInBeats })!;
        const facts = musicFacts(p, totalBeats);
        const views: BeatView[] = [];
        const driver = new BeatDriver({
          audibleNow: () => be.audibleNow() as number,
          timing: () => timing,
          facts,
          frame: c,
          lineOn: () => true,
          reducedMotion: () => false,
          onView: (v) => views.push(v),
          requestFrame: () => 0,
          cancelFrame: () => undefined,
        });
        const centres = onsetCentres(c, p);
        const firstBeat = Math.min(...centres.keys());
        const wait = centres.get(Math.min(firstBeat, 0)) ?? c.beatLineAt(Math.min(firstBeat, 0))!;
        let onsetsChecked = 0;
        let pickupOnsets = 0;
        // Pickup notes that fall between clicks (a 6/8 eighth-note pickup) are checked at their own written time.
        const beatSec = 60 / BPM;
        const offBeatPickups = [...centres.keys()].filter((b) => b < 0 && !Number.isInteger(b));
        for (const k of clicks as ClickSpec[]) {
          const beat = k.beatIndex - countInBeats;
          for (const pb of offBeatPickups.filter((b) => b < beat && b > beat - 1)) {
            be.advanceTo(t0 + pb * beatSec + lat);
            driver.tick();
            expect(Math.abs(lineOf(host)!.x - centres.get(pb)!.x), `pickup note at beat ${pb}`).toBeLessThanOrEqual(1);
            pickupOnsets++;
          }
          // The click is heard `lat` after its scheduled time: move the context clock there.
          be.advanceTo((k.t as number) + lat);
          expect(be.audibleNow() as number).toBeCloseTo(k.t as number, 9);
          driver.tick();
          const line = lineOf(host);
          expect(line, `beat ${beat}`).not.toBeNull();
          if (k.countIn) {
            // The track shows the click being heard; the line waits at the first note (or the pickup) until it starts.
            expect(views.at(-1)!.click).toBe(k.beatIndex + 1);
            const at = beat < firstBeat ? wait : (centres.get(beat) ?? c.beatLineAt(beat)!);
            if (beat < Math.min(firstBeat, 0)) {
              expect(line!.system).toBe(wait.system);
              expect(Math.abs(line!.x - wait.x), `count-in beat ${beat}`).toBeLessThanOrEqual(1);
            } else {
              expect(Math.abs(line!.x - at.x), `pickup beat ${beat}`).toBeLessThanOrEqual(1);
              if (centres.has(beat)) pickupOnsets++;
            }
            continue;
          }
          const note = centres.get(beat);
          const want = note ?? c.beatLineAt(beat)!;
          expect(line!.system, `beat ${beat}`).toBe(want.system);
          expect(Math.abs(line!.x - want.x), `beat ${beat}: line ${line!.x}, beat ${want.x}`).toBeLessThanOrEqual(1);
          if (note) onsetsChecked++;
          // Bar and beat numbers in the strip agree with the click: bar 1 beat 1 is t0.
          const v = views.at(-1)!;
          expect(v.music).toBe(true);
          expect(v.bar).toBe(Math.floor(beat / p.meter.countsPerBar) + 1);
          expect(v.beatInBar).toBe((beat % p.meter.countsPerBar) + 1);
        }
        expect(onsetsChecked).toBeGreaterThan(4);
        // Pickup notes on a count-in click are crossed at their written time too.
        if (f.pickup) expect(pickupOnsets).toBeGreaterThan(0);
      });
    }
  }
});

describe('the screen does not run ahead of the sound', () => {
  it('at a click\'s scheduled time, with 100 ms of output latency, the line is still 100 ms short of the beat', async () => {
    const p = preparedFromDoc(fixtureDoc('holmes-lc5855050-voice-m1-8'), 'treble');
    const { c, host } = laidOut(p);
    const { be, t0, clicks, countInBeats } = await scheduled(p, 0.1);
    const timing = timingOf({ t0, bpm: BPM, countInBeats })!;
    const driver = new BeatDriver({
      audibleNow: () => be.audibleNow() as number,
      timing: () => timing,
      facts: musicFacts(p, 40),
      frame: c,
      lineOn: () => true,
      reducedMotion: () => false,
      onView: () => undefined,
      requestFrame: () => 0,
      cancelFrame: () => undefined,
    });
    const k = clicks.find((x) => x.beatIndex === countInBeats + 5)!;
    be.advanceTo(k.t as number); // the context clock reached the click; the speaker plays it 100 ms later
    driver.tick();
    const lagBeats = 0.1 / (60 / BPM);
    expect(Math.abs(lineOf(host)!.x - c.beatLineAt(5 - lagBeats)!.x)).toBeLessThanOrEqual(1);
    expect(lineOf(host)!.x).toBeLessThan(c.beatLineAt(5)!.x - 1);
  });

  it('the count-in track lights a click only when it is heard', () => {
    const t = { t0: 100, beatSec: 0.5, countInBeats: 8 };
    const m = { firstNoteBeat: 0, waitBeat: 0, beatsPerBar: 4, hasPickup: false, endBeat: 32 };
    expect(visualAt(t, m, 96 - 1e-3, false).click).toBe(0);
    expect(visualAt(t, m, 96, false).click).toBe(1);
    expect(visualAt(t, m, 99.5 - 1e-3, false).click).toBe(7);
    expect(visualAt(t, m, 99.5, false).click).toBe(8);
    expect(visualAt(t, m, 100 - 1e-3, false).music).toBe(false);
    expect(visualAt(t, m, 100, false)).toMatchObject({ music: true, bar: 1, beatInBar: 1, line: 0 });
    // A one-beat pickup: the music (and the line) start on the pickup, in bar 0, in the count-in's last bar.
    const pick = { ...m, firstNoteBeat: -1, waitBeat: -1, hasPickup: true };
    expect(visualAt(t, pick, 99.5, false)).toMatchObject({ click: 8, music: true, bar: 0, beatInBar: 4, line: -1 });
    expect(visualAt(t, pick, 99.75, false).line).toBe(-0.5);
    expect(visualAt(t, pick, 99.25, false).line).toBe(-1);
    expect(visualAt(t, pick, 99.0, false).line).toBe(-1);
  });

  it('under reduced motion the line steps beat by beat and never glides', () => {
    const t = { t0: 100, beatSec: 0.5, countInBeats: 4 };
    const m = { firstNoteBeat: 0, waitBeat: 0, beatsPerBar: 4, hasPickup: false, endBeat: 32 };
    expect(visualAt(t, m, 100.2, true).line).toBe(0);
    expect(visualAt(t, m, 100.49, true).line).toBe(0);
    expect(visualAt(t, m, 100.5, true).line).toBe(1);
    expect(visualAt(t, m, 101.7, true).line).toBe(3);
    expect(visualAt(t, m, 101.7, false).line).toBeCloseTo(3.4, 9);
  });

  it('jumps to the next system at a system break and hides when the setting is off', async () => {
    const p = preparedFromDoc(fixtureDoc('mozart-sq35524196-violin1-mv2-mp16-28'), 'treble');
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const c = new ScoreFrameController(host, notation, { appearance: { reducedMotion: () => false, highContrast: () => false } });
    c.layout(p, { viewport: { width: 390, height: 844 }, insets: { top: 0, bottom: 0 }, widthPx: 390, bpm: BPM, purpose: 'take', heightPx: 3000 }, notation.tickablesPerBar(p));
    const systems = c.info!.layout.systems;
    expect(systems.length).toBeGreaterThan(1);
    const second = p.measures.find((m) => m.displayBar === systems[1]!.firstBar)!;
    const breakBeat = (second.startTick - p.pickupTicks) / p.meter.countUnitTicks;
    c.setBeatLine(breakBeat - 0.01);
    expect(lineOf(host)!.system).toBe(0);
    c.setBeatLine(breakBeat);
    expect(lineOf(host)!.system).toBe(1);
    expect(host.querySelectorAll('line.sf-beat-line')).toHaveLength(1);
    c.setBeatLine(null);
    expect(lineOf(host)).toBeNull();
  });
});
