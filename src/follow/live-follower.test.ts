// Unit behaviour of the live follower beyond the fixture predicates: provisional sharp/flat reverting (R19, R36),
// event rate caps (01 §9.9), no-signal, end handling, key inference for ghost spelling, voice drift, octave
// correction and the shared cost function.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, DetectedNote, FollowerEvent, FollowFixture, FollowStreamItem, LiveJudgment } from '../core/types.ts';
import { configs, corpusDoc } from '../../fixtures/follow/gen/io.ts';
import { resolveTolerances } from '../rules/index.ts';
import { followConfigFor, runFollowStream } from '../testkit/predicates/index.ts';
import { correctedMidi, inferWrittenKey, LiveFollower, matchCost, PITCH_COST_WRONG } from './index.ts';

const fixture = (id: string): FollowFixture => JSON.parse(readFileSync(new URL(`../../fixtures/follow/${id}.json`, import.meta.url), 'utf8')) as FollowFixture;

function configFor(fx: FollowFixture) {
  const cfg = configs();
  const instrument = cfg.instrumentById[fx.instrumentId]!;
  const tol = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter: corpusDoc(fx.excerptId).meter }, cfg);
  return followConfigFor(fx, instrument, cfg, tol);
}

const noteEvents = (stream: FollowStreamItem[], id: number) =>
  stream.filter((it): it is Extract<FollowStreamItem, { kind: 'dsp' }> => it.kind === 'dsp' && 'note' in it.event && it.event.note.id === id);

describe('provisional sharp that the player corrects (R19, R36)', () => {
  const fx = fixture('sharp');
  const config = configFor(fx);
  // Note 22 is played +48 c (live and final sharp). Rewrite its later updates and its note-off to +2 c.
  const id22 = (fx.stream.find((it) => it.kind === 'dsp' && it.event.type === 'note-on' && Math.abs(it.event.note.onset - (fx.t0 + fx.latencyCompensationSec + fx.expected[22]!.onsetSec)) < 0.03) as Extract<FollowStreamItem, { kind: 'dsp' }>).event as { note: DetectedNote };
  const id = id22.note.id;
  const target = fx.expected[22]!.concertMidi;
  const updates = noteEvents(fx.stream, id).filter((it) => it.event.type !== 'note-on');
  const stream = fx.stream.map((it) => {
    if (it.kind !== 'dsp' || !('note' in it.event) || it.event.note.id !== id || it.event.type === 'note-on') return it;
    const k = updates.indexOf(it as (typeof updates)[number]);
    if (k < 3) return it; // the first updates still read +48 c: the sharp mark appears
    const note = { ...it.event.note, midi: target + 0.02, stableMedianCents: 2 };
    return { ...it, event: { ...it.event, note } } as FollowStreamItem;
  });
  const events = runFollowStream(stream, new LiveFollower(config));
  const js = events.flatMap((e) => (e.type === 'judgment' && e.judgment.expectedIdx === 22 ? [e.judgment] : []));

  it('shows sharp provisionally, then sends the corrected state; the last state is in tune and final', () => {
    expect(js.some((j) => j.pitch === 'sharp' && j.provisional)).toBe(true);
    const last = js[js.length - 1]!;
    expect(last.pitch).toBe('in-tune');
    expect(last.provisional).toBe(false);
    expect(js.findIndex((j) => j.pitch === 'sharp')).toBeLessThan(js.findIndex((j, k) => k > 0 && j.pitch === 'in-tune'));
  });

  it('sends one sharp ghost and no removal event: the new note state replaces it (R36)', () => {
    const ghosts = events.filter((e) => e.type === 'ghost' && e.ghost.detectedId === id);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.type === 'ghost' && ghosts[0]!.ghost.kind).toBe('sharp');
  });

  it('keeps the timing verdict from the onset', () => {
    expect(new Set(js.map((j) => j.timing))).toEqual(new Set(['on-time']));
  });
});

describe('event stream housekeeping (01 §9.9)', () => {
  const fx = fixture('on-time');
  const config = configFor(fx);

  it('clock events at most 60 Hz and level events at most 30 Hz, even with a clock every 8 ms hop', () => {
    const f = new LiveFollower(config);
    const t0 = fx.t0;
    const out: { t: number; ev: FollowerEvent }[] = [];
    for (let k = 0; k < 500; k++) {
      const t = (t0 + k * 0.008) as ClockSeconds;
      for (const ev of f.onClock(t)) out.push({ t, ev });
      if (k % 4 === 0) for (const ev of f.onDsp({ type: 'signal', levelDb: -20, clipping: false, voiced: true })) out.push({ t, ev });
    }
    const gaps = (type: string) => {
      const ts = out.filter((x) => x.ev.type === type).map((x) => x.t);
      return ts.slice(1).map((t, k) => t - ts[k]!);
    };
    expect(Math.min(...gaps('clock'))).toBeGreaterThanOrEqual(1 / 60 - 1e-9);
    expect(Math.min(...gaps('level'))).toBeGreaterThanOrEqual(1 / 30 - 1e-9);
    expect(out.filter((x) => x.ev.type === 'clock').length).toBeGreaterThan(150); // 8 ms hops: one clock every 3 hops (41.7 Hz)
  });

  it('reports no-signal once when nothing voiced arrives for voidNoSignalSec after the first written onset', () => {
    const f = new LiveFollower(config);
    const ev: FollowerEvent[] = [];
    for (let k = 0; k < 1000; k++) {
      const t = (fx.t0 + k * 0.008) as ClockSeconds;
      ev.push(...f.onClock(t));
      if (k % 4 === 0) ev.push(...f.onDsp({ type: 'signal', levelDb: -70, clipping: false, voiced: false }));
    }
    expect(ev.filter((e) => e.type === 'status' && e.kind === 'no-signal')).toHaveLength(1);
  });

  it('end is emitted once; later calls emit nothing', () => {
    const f = new LiveFollower(config);
    expect(f.end(fx.t0 as ClockSeconds, { reason: 'stopped' })).toEqual(expect.arrayContaining([{ type: 'end', reason: 'stopped' }]));
    expect(f.end(fx.t0 as ClockSeconds, { reason: 'stopped' })).toEqual([]);
    expect(f.onClock((fx.t0 + 1) as ClockSeconds)).toEqual([]);
  });

  it('end marks notes whose window has passed as missed, and carries the void reason', () => {
    const f = new LiveFollower(config);
    const ev = f.end((fx.t0 + 3) as ClockSeconds, { reason: 'void', voidReason: 'interrupted' });
    expect(ev[ev.length - 1]).toEqual({ type: 'end', reason: 'void', voidReason: 'interrupted' });
    expect(ev.filter((e) => e.type === 'missed').length).toBeGreaterThan(0);
  });

  it('rejects tolerances that do not line up with the expected notes', () => {
    expect(() => new LiveFollower({ ...config, tolerances: config.tolerances.slice(1) })).toThrow(RangeError);
  });
});

describe('ghost spelling key (02 §4.8)', () => {
  it('recovers the key signature direction of every follow fixture from its expected notes', () => {
    const dir = new URL('../../fixtures/follow/', import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const fx = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as FollowFixture;
      expect(Math.sign(inferWrittenKey(fx.expected).fifths), f).toBe(Math.sign(fx.writtenKey.fifths));
    }
  });
});

describe('voice drift reference (02 §4.5)', () => {
  it('a singer uniformly 30 c flat is judged in tune once the reference has followed', () => {
    const fx = fixture('octave-voice');
    const config = configFor(fx);
    const flat = fx.stream.map((it) => {
      if (it.kind !== 'dsp' || !('note' in it.event)) return it;
      const n = it.event.note;
      return { ...it, event: { ...it.event, note: { ...n, midi: n.midi - 0.3, provisionalMidi: n.provisionalMidi - 0.3 } } } as FollowStreamItem;
    });
    const ev = runFollowStream(flat, new LiveFollower(config));
    const last = new Map<number, LiveJudgment>();
    for (const e of ev) if (e.type === 'judgment') last.set(e.judgment.expectedIdx, e.judgment);
    const late = [...last.values()].filter((j) => j.expectedIdx >= 10);
    expect(late.length).toBeGreaterThan(10);
    for (const j of late) {
      expect(j.pitch === 'in-tune' || j.pitch === 'not-graded', `note ${j.expectedIdx} ${j.pitch}`).toBe(true);
      expect(Math.abs(j.centsError!)).toBeLessThan(10);
    }
  });
});

describe('cost function and octave correction (01 §9.2, §9.3 step 5)', () => {
  const fx = fixture('on-time');
  const config = configFor(fx);
  const e = fx.expected[5]!;
  const tol = config.tolerances[5]!;

  it('4 × (Δt / W)² + P inside the window, null outside', () => {
    expect(matchCost(0, tol, 0)).toBe(0);
    expect(matchCost(tol.matchWindowSec / 2, tol, PITCH_COST_WRONG)).toBeCloseTo(1 + PITCH_COST_WRONG, 9);
    expect(matchCost(tol.matchWindowSec * 1.01, tol, 0)).toBeNull();
  });

  it('reads a non-voice note one octave off in the expected octave only with enough alternate-octave clarity', () => {
    const low = { midi: e.concertMidi - 12, clarity: 0.95 };
    expect(correctedMidi(e, { ...low, altOctaveClarity: 0.9 }, 0, config.instrument, config.cfg)).toBe(e.concertMidi);
    expect(correctedMidi(e, { ...low, altOctaveClarity: 0.3 }, 0, config.instrument, config.cfg)).toBe(e.concertMidi - 12);
    expect(correctedMidi(e, { ...low, altOctaveClarity: null }, 0, config.instrument, config.cfg)).toBe(e.concertMidi - 12);
    expect(correctedMidi(e, { midi: e.concertMidi - 24, clarity: 0.95, altOctaveClarity: 0.95 }, 0, config.instrument, config.cfg)).toBe(e.concertMidi - 24);
  });
});
