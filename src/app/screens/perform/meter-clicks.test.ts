// The audio side of "is the metronome following the tempo" (round 2, beat line): for every meter in
// config/levels.json the take's clicks sound at t0 + k * 60 / bpm (count-in beats negative), accented on each bar's
// first beat, with the same times from the production metronome (Web Audio buffer starts) and the fake backend.
// Compound meters click the dotted beat (02 conventions: dotted quarter in 6/8, 9/8, 12/8), and the tempo the screen
// shows is the tempo that is scheduled, in the unit that clicks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TakeSchedule } from '../../../core/platform.ts';
import type { Meter, PreparedExcerpt, SelectionResult } from '../../../core/types.ts';
import { makeMeter } from '../../../core/time.ts';
import { fixtureDoc } from '../../../notation/testing/corpus-node.ts';
import { preparedFromDoc } from '../../../notation/testing/prepared.ts';
import { Metronome, planTakeClicks } from '../../../platform/web/audio/metronome.ts';
import { FakeAudioWorld } from '../../../platform/web/audio/testing/fake-web-audio.ts';
import { planTake } from '../../../session/take-plan.ts';
import { FakeAudioBackend } from '../../../testkit/fake-backend.ts';
import { tempoOf } from '../scan/read-model.ts';
import { beatUnit } from '../setup/model.ts';
import { cfg } from '../scan/test-support.tsx';

const levels = JSON.parse(readFileSync(join(process.cwd(), 'config/levels.json'), 'utf8')) as { levels: { level: number; meters: string[] }[] };
const METERS = [...new Set(levels.levels.flatMap((l) => l.meters))].sort();

const schedule = (m: Meter, bpm: number): TakeSchedule => ({
  leadSec: 0.5,
  bpm,
  beatsPerBar: m.countsPerBar,
  countInBeats: 2 * m.countsPerBar,
  totalBeats: 8 * m.countsPerBar,
  mode: 'audible',
  timbre: 'classic',
  accentDb: 5,
  accent: true,
});

describe('take clicks for every meter in config/levels.json', () => {
  it('covers the meters the levels list', () => {
    expect(METERS).toEqual(expect.arrayContaining(['2/4', '3/4', '4/4', '6/8', '9/8', '12/8', '3/8', '2/2']));
  });

  for (const meter of METERS) {
    it(`${meter}: t0 + k beats, accents on each downbeat, the same from the metronome and the fake backend`, async () => {
      const [beats, beatType] = meter.split('/').map(Number) as [number, Meter['beatType']];
      const m = makeMeter(beats, beatType);
      for (const bpm of [40, 72, 132]) {
        const p = schedule(m, bpm);
        const beatSec = 60 / bpm;
        // Production metronome on a Web Audio fake: the buffer sources start at the planned times.
        const world = new FakeAudioWorld();
        const ctx = world.deps.createContext({ latencyHint: 'interactive' });
        const metronome = new Metronome(ctx, ctx.createGain());
        const real = metronome.scheduleTake(p);
        const t0 = real.t0 as number;
        expect(real.clicks).toEqual(planTakeClicks(p, t0));
        expect(real.clicks).toHaveLength(p.countInBeats + p.totalBeats);
        const starts = world.ctx.bufferSources.map((s) => s.startedAt).filter((x): x is number => x !== null);
        expect(starts).toHaveLength(real.clicks.length);
        real.clicks.forEach((c, i) => {
          const k = i - p.countInBeats;
          expect(c.t as number).toBeCloseTo(t0 + k * beatSec, 9);
          expect(starts[i]).toBeCloseTo(c.t as number, 9);
          expect(c.accent).toBe(((k % m.countsPerBar) + m.countsPerBar) % m.countsPerBar === 0);
          expect(c.countIn).toBe(k < 0);
        });
        // The fake backend the unit tests use schedules the same grid.
        const be = new FakeAudioBackend();
        const fake = await be.scheduleTake(p);
        fake.clicks.forEach((c, i) => {
          expect(c.t as number).toBeCloseTo((fake.t0 as number) + (i - p.countInBeats) * beatSec, 9);
          expect(c.accent).toBe(real.clicks[i]!.accent);
        });
      }
    });
  }

  it('compound meters click the dotted beat: 6/8 in 2, 9/8 in 3, 12/8 in 4 dotted quarters', () => {
    for (const [meter, counts] of [['6/8', 2], ['9/8', 3], ['12/8', 4]] as const) {
      const [b, t] = meter.split('/').map(Number) as [number, Meter['beatType']];
      const m = makeMeter(b, t);
      expect(m.countUnitTicks, meter).toBe(720); // a dotted quarter (TPQ 480)
      expect(m.countsPerBar, meter).toBe(counts);
      expect(beatUnit(meter), meter).toBe('♩.');
    }
    // 3/8 and the odd eighth meters count eighths; x/2 count halves; x/4 count quarters (02 conventions).
    expect(makeMeter(3, 8)).toMatchObject({ countUnitTicks: 240, countsPerBar: 3 });
    expect(beatUnit('3/8')).toBe('♪');
    expect(makeMeter(2, 2)).toMatchObject({ countUnitTicks: 960, countsPerBar: 2 });
    expect(beatUnit('2/2').normalize('NFD')).toBe('\u{1D15E}'.normalize('NFD'));
    expect(beatUnit('3/4')).toBe('♩');
  });

  it('the tempo the try screen shows is the scheduled tempo, for simple, compound and pickup excerpts', () => {
    const ids = ['mayer-sq7588853-violin1-mv4-m253-260', 'holmes-lc5669865-voice-m55-62', 'holmes-lc5855050-voice-m1-8', 'gouvy-sq10406164-cello-mv3-m1-10', 'mozart-sq7353137-violin1-mv1-mp0-8'];
    for (const id of ids) {
      const base = preparedFromDoc(fixtureDoc(id), 'treble');
      const bpm = 54;
      const p: PreparedExcerpt = { ...base, instrumentId: 'flute', levelServed: 4, selection: { settings: { bpm, meter: `${base.meter.beats}/${base.meter.beatType}` } } as unknown as SelectionResult };
      const plan = planTake(p, cfg);
      expect(plan.bpm).toBe(bpm);
      expect(plan.beatsPerBar).toBe(p.meter.countsPerBar);
      expect(tempoOf(p).bpm).toBe(bpm);
      // The marking's unit is the clicking unit: a dotted quarter in 6/8, a quarter in x/4.
      expect(tempoOf(p).unit).toBe(p.meter.beatType === 8 && p.meter.countsPerBar * 3 === p.meter.beats ? '♩.' : '♩');
      // Written onsets sit on the click grid: a note on count n is n beats after bar 1 beat 1.
      for (const e of plan.expected) expect(e.onsetSec).toBeCloseTo(e.onsetBeat * (60 / bpm), 9);
    }
  });
});
