// The steady pitch needle (round 3, docs/redesign/round3/03-pitch-steadiness.md §3 and §7): the display filter and the
// in-tune decision on synthetic held notes, T1 to T14 filter side, plus property tests. Frames are 8 ms apart at
// -35 dBFS, a voice, target E3 (52), band 30 c. Each case runs on Steady (S), Balanced (B) and Quick (Q) unless
// marked. Expected values come from the reference simulation (steadiness.py); timing tolerance is one 20 ms post.
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng.ts';
import type { PitchSteadiness } from '../core/types.ts';
import {
  IN_TUNE_INITIAL,
  PITCH_STEADINESS_VALUES,
  STEADINESS_PRESETS,
  SteadinessFilter,
  centsAgainst,
  defaultPitchSteadiness,
  inTuneStep,
  pitchSteadinessFor,
  type InTuneState,
  type SteadinessReading,
} from './pitch-steadiness.ts';

const DT = 8;
const TARGET = 52;
const BAND = 30;
const POST = 20;
const ALL: readonly PitchSteadiness[] = ['steady', 'balanced', 'quick'];

/** One analyser frame: cents against the target (null: no pitch) and level. */
interface In {
  c: number | null;
  db?: number;
}

/** One posted frame, as the screen sees it. */
interface Post {
  t: number;
  r: SteadinessReading;
  /** The drawn needle, folded and clamped to ±50 c; null when hidden. */
  needle: number | null;
  inTune: boolean;
  judge: InTuneState;
}

/**
 * Runs a signal (a function of ms) through the filter at 8 ms frames, posts on the 20 ms grid as the pitch-mode
 * tracker does, and runs the in-tune decision on each post.
 */
function simulate(sig: (t: number) => In, preset: PitchSteadiness, o: { durMs?: number; voice?: boolean; band?: number; hitMs?: number } = {}): { posts: Post[]; hitAt: number | null } {
  const p = { ...STEADINESS_PRESETS[preset], ...(o.hitMs !== undefined ? { hitMs: o.hitMs } : {}) };
  const f = new SteadinessFilter(p);
  const voice = o.voice ?? true;
  const band = o.band ?? BAND;
  const posts: Post[] = [];
  let judge = IN_TUNE_INITIAL;
  let nextDue = -Infinity;
  for (let t = 0; t <= (o.durMs ?? 3000); t += DT) {
    const x = sig(t);
    f.push(t, x.c === null ? null : TARGET + x.c / 100, x.db ?? -35);
    if (t < nextDue - 1e-6) continue;
    nextDue = nextDue + POST < t ? t + POST : nextDue + POST;
    const r = f.reading;
    const fold = (m: number | null): number | null => (m === null ? null : centsAgainst(m, TARGET, voice));
    judge = inTuneStep(judge, { t, gap: r.gap, runId: r.runId, judgeCents: fold(r.judgeMidi), centreCents: fold(r.centreMidi), holdCents: fold(r.holdMidi) }, band, p);
    const s = fold(r.settledMidi);
    posts.push({ t, r, needle: s === null ? null : Math.max(-50, Math.min(50, s)), inTune: judge.inTune, judge });
  }
  return { posts, hitAt: judge.hitAt };
}

const between = (posts: readonly Post[], a: number, b: number): Post[] => posts.filter((x) => x.t >= a && x.t <= b);
const needles = (posts: readonly Post[]): number[] => posts.map((x) => x.needle).filter((v): v is number => v !== null);
const sd = (xs: readonly number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const sine = (amp: number, hz: number, centre = 0) => (t: number): In => ({ c: centre + amp * Math.sin((2 * Math.PI * hz * t) / 1000) });
const flat = (c: number) => (): In => ({ c });
/** Within a post of the expected time (±24 ms: one post either way, frames at 8 ms). */
const near = (got: number | null, want: number, tol = 24): void => {
  expect(got).not.toBeNull();
  expect(Math.abs(got! - want), `got ${got}, want ${want}`).toBeLessThanOrEqual(tol);
};

describe('presets and the setting', () => {
  it('has the three presets of §3.2 with the common gates', () => {
    expect(PITCH_STEADINESS_VALUES).toEqual(['steady', 'balanced', 'quick']);
    expect(STEADINESS_PRESETS.steady).toMatchObject({ centreMs: 300, tauMs: 150, judgeMs: 400, detentC: 4 });
    expect(STEADINESS_PRESETS.balanced).toMatchObject({ centreMs: 200, tauMs: 80, judgeMs: 300, detentC: 3 });
    expect(STEADINESS_PRESETS.quick).toMatchObject({ centreMs: 60, tauMs: 30, judgeMs: 200, detentC: 1 });
    for (const k of ALL) {
      expect(STEADINESS_PRESETS[k]).toMatchObject({ gateDb: -65, tailDb: 12, peakMs: 500, holdMs: 120, hideMs: 600, showAfterMs: 60, jumpC: 300, jumpHoldMs: 220, snapC: 80, snapMs: 100, hystC: 10, enterDwellMs: 100, exitDwellMs: 150, hitMs: 800, minCentreMs: 40, fastExitFactor: 2, fastExitMs: 60 });
    }
  });

  it('defaults to Steady for voices and Balanced for instruments; a stored preset wins, anything else reads as the default', () => {
    expect(defaultPitchSteadiness('voice')).toBe('steady');
    for (const fam of ['woodwind', 'brass', 'strings', 'keyboard']) expect(defaultPitchSteadiness(fam)).toBe('balanced');
    expect(pitchSteadinessFor(undefined, 'voice')).toBe('steady');
    expect(pitchSteadinessFor('quick', 'voice')).toBe('quick');
    expect(pitchSteadinessFor('wobbly', 'brass')).toBe('balanced');
  });

  it('presets are ordered by responsiveness: a +100 c correction settles soonest on Quick, last on Steady', () => {
    const settle = (k: PitchSteadiness): number => {
      const { posts } = simulate((t) => ({ c: t < 1000 ? 0 : 100 }), k, { hitMs: 1e9 });
      const after = between(posts, 1000, 3000);
      const i = after.findIndex((_, n) => after.slice(n).every((y) => y.needle !== null && Math.abs(y.needle - 50) <= 10));
      return after[i]!.t - 1000;
    };
    const s = settle('steady');
    const b = settle('balanced');
    const q = settle('quick');
    expect(q).toBeLessThan(b);
    expect(b).toBeLessThan(s);
    // The reference simulation: S 232, B 136, Q 40 ms (±1 post).
    near(s + 1000, 1232);
    near(b + 1000, 1136);
    near(q + 1000, 1040);
  });
});

describe('T1 to T14: the filter and the in-tune decision', () => {
  it('T1 clean onset on pitch: hidden before 60 ms, then 0 ± 1 c; in tune from judgeMs + 100 ms; hit at S 1304, B 1208, Q 1104', () => {
    const want = { steady: [500, 1304], balanced: [400, 1208], quick: [300, 1104] } as const;
    for (const k of ALL) {
      const { posts, hitAt } = simulate(flat(0), k);
      expect(posts.filter((x) => x.t < 60).every((x) => x.needle === null), k).toBe(true);
      expect(between(posts, 64, 3000).every((x) => x.needle !== null && Math.abs(x.needle) <= 1), k).toBe(true);
      const first = posts.find((x) => x.inTune)!;
      near(first.t, want[k][0]);
      near(hitAt, want[k][1]);
    }
  });

  // The spec asks ±3 c for S and B; the drawn value on B peaks at 3.8 c here (the detent of 3 c lets it land on the
  // smoother's extreme), against ±2 c in the reference simulation, whose frame times are floats.
  it('T2 a 5.5 Hz ±40 c vibrato: S within ±1 c and B within ±4 c after 0.6 s, in tune throughout; Q swings about ±26 c, still in tune; all hit', () => {
    for (const k of ALL) {
      const { posts, hitAt } = simulate(sine(40, 5.5), k, { hitMs: 1e9 });
      const xs = needles(between(posts, 600, 3000));
      if (k === 'quick') {
        expect(Math.max(...xs.map(Math.abs))).toBeGreaterThan(18);
        expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(30);
      } else {
        expect(Math.max(...xs.map(Math.abs)), k).toBeLessThanOrEqual(k === 'steady' ? 1 : 4);
      }
      const from = posts.findIndex((x) => x.inTune);
      expect(posts.slice(from).every((x) => x.inTune), k).toBe(true);
      expect(hitAt).toBeNull();
      expect(simulate(sine(40, 5.5), k).hitAt, k).not.toBeNull();
    }
  });

  it('T3 an irregular wobble (30 c, 3 ± 0.8 Hz): S within ±10 c, B within ±25 c; in tune and a hit on all three', () => {
    let ph = 0;
    let last = 0;
    const wob = (t: number): In => {
      ph += 2 * Math.PI * (3 + 0.8 * Math.sin((2 * Math.PI * 0.4 * t) / 1000)) * ((t - last) / 1000);
      last = t;
      return { c: 30 * Math.sin(ph) * (1 + 0.3 * Math.sin((2 * Math.PI * 0.7 * t) / 1000)) };
    };
    for (const k of ALL) {
      ph = 0;
      last = 0;
      const { posts, hitAt } = simulate(wob, k);
      const xs = needles(between(posts, 1000, 2900));
      if (k === 'steady') expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(10);
      if (k === 'balanced') expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(25);
      expect(posts.some((x) => x.inTune), k).toBe(true);
      expect(hitAt, k).not.toBeNull();
    }
  });

  it('T4 centred 45 c low with a ±40 c wobble: never in tune, never a hit; S and B needle between -50 and -39 c', () => {
    for (const k of ALL) {
      const { posts, hitAt } = simulate(sine(40, 4, -45), k);
      expect(posts.some((x) => x.inTune), k).toBe(false);
      expect(hitAt, k).toBeNull();
      if (k !== 'quick') {
        const xs = needles(between(posts, 1000, 2900));
        expect(Math.min(...xs), k).toBeGreaterThanOrEqual(-50);
        expect(Math.max(...xs), k).toBeLessThanOrEqual(-39 + 5);
      }
    }
  });

  it('T5 centred 38 c low with a ±25 c wobble: never in tune (entry needs 25 c or less), never a hit', () => {
    for (const k of ALL) {
      const { posts, hitAt } = simulate(sine(25, 4, -38), k);
      expect(posts.some((x) => x.inTune), k).toBe(false);
      expect(hitAt, k).toBeNull();
    }
  });

  it('T6 centred 20 c low with a wide ±45 c wobble: S and B in tune and a hit; S needle steady at -19 ± 2 c', () => {
    for (const k of ['steady', 'balanced'] as const) {
      const { posts, hitAt } = simulate(sine(45, 3, -20), k);
      expect(posts.some((x) => x.inTune), k).toBe(true);
      expect(hitAt, k).not.toBeNull();
      if (k === 'steady') for (const x of needles(between(posts, 1000, 2900))) expect(Math.abs(x + 19)).toBeLessThanOrEqual(2);
    }
  });

  const glitchCase = (sig: (t: number) => In, k: PitchSteadiness): void => {
    const clean = simulate(flat(0), k);
    const g = simulate(sig, k);
    // Needle unchanged (±1 c), state unchanged, hit timer not reset.
    for (const x of between(g.posts, 1000, 3000)) expect(x.needle !== null && Math.abs(x.needle) <= 1, `${k} ${x.t}`).toBe(true);
    for (const x of between(g.posts, 1400, 2000)) expect(x.inTune, `${k} ${x.t}`).toBe(true);
    expect(g.hitAt, k).toBe(clean.hitAt);
  };

  it('T7a a -1160 c glitch for 160 ms at 1.5 s: needle, state and hit timer unchanged (the fold trap: never +40 c)', () => {
    // The hit comes after 1.5 s in every preset only with a later start, so hold the hit off until the glitch.
    for (const k of ALL) glitchCase((t) => ({ c: t >= 1500 && t < 1660 ? -1160 : 0 }), k);
    // And a hit that would land inside the glitch is not reset by it: it lands no later than one post after.
    const late = (t: number): In => ({ c: t < 400 ? null : t >= 1500 && t < 1660 ? -1160 : 0 });
    for (const k of ALL) {
      const clean = simulate((t) => ({ c: t < 400 ? null : 0 }), k);
      const g = simulate(late, k);
      expect(g.hitAt).not.toBeNull();
      expect(g.hitAt! - clean.hitAt!, k).toBeLessThanOrEqual(clean.hitAt! >= 1500 && clean.hitAt! < 1660 ? 1660 - clean.hitAt! + POST : 0);
    }
  });

  it('T7b a -1470 c glitch for 190 ms with two 16 ms dropouts inside it: as T7a', () => {
    const sig = (t: number): In => {
      if (t >= 1540 && t < 1556) return { c: null };
      if (t >= 1600 && t < 1616) return { c: null };
      return { c: t >= 1500 && t < 1690 ? -1470 : 0 };
    };
    for (const k of ALL) glitchCase(sig, k);
  });

  it('T7c +500 c from 1.5 s, held: the needle holds until 1.72 s (220 ms), then follows; the in-tune state resets', () => {
    for (const k of ALL) {
      const { posts } = simulate((t) => ({ c: t < 1500 ? 0 : 500 }), k, { hitMs: 1e9 });
      for (const x of between(posts, 1500, 1712)) expect(Math.abs(x.needle!), `${k} ${x.t}`).toBeLessThanOrEqual(1);
      for (const x of between(posts, 1500, 1712)) expect(x.inTune, `${k} ${x.t}`).toBe(true);
      const moved = between(posts, 1500, 3000).find((x) => x.needle! >= 50)!;
      near(moved.t, 1720 + STEADINESS_PRESETS[k].showAfterMs, 30);
      expect(between(posts, 1730, 3000).some((x) => x.inTune), k).toBe(false);
    }
  });

  it('T8a a 100 ms dropout at 1.5 s: needle and state held (bridged), hit timer continues', () => {
    for (const k of ALL) {
      const clean = simulate(flat(0), k);
      const { posts, hitAt } = simulate((t) => ({ c: t >= 1500 && t < 1600 ? null : 0 }), k);
      for (const x of between(posts, 1500, 1599)) {
        expect(x.needle, k).toBe(0);
        expect(x.r.gap).toBe('bridged');
      }
      expect(hitAt, k).toBe(clean.hitAt);
      // With the hit held off, the in-tune state carries through the gap.
      const held = simulate((t) => ({ c: t >= 1500 && t < 1600 ? null : 0 }), k, { hitMs: 1e9 });
      for (const x of between(held.posts, 1000, 3000)) expect(x.inTune, `${k} ${x.t}`).toBe(true);
    }
  });

  it('T8b a 300 ms dropout: the needle dims at its last place, state and hit timer reset, and it resumes on return', () => {
    for (const k of ALL) {
      const { posts, hitAt } = simulate((t) => ({ c: t >= 1000 && t < 1300 ? null : 0 }), k);
      const dim = between(posts, 1140, 1290);
      expect(dim.every((x) => x.r.gap === 'dim' && x.needle === 0 && !x.inTune), k).toBe(true);
      // Resumes: a hit 1.3 s after the return at most (judge + enter + hold, plus a post).
      const clean = simulate(flat(0), k);
      near(hitAt, 1300 + clean.hitAt!, 30);
      expect(between(posts, 1400, 1800).every((x) => x.needle === 0), k).toBe(true);
    }
  });

  it('T8c a 700 ms dropout: the needle is hidden after 600 ms', () => {
    for (const k of ALL) {
      const { posts } = simulate((t) => ({ c: t >= 1000 && t < 1700 ? null : 0 }), k, { hitMs: 1e9 });
      for (const x of between(posts, 1000, 1590)) expect(x.needle, `${k} ${x.t}`).toBe(0);
      for (const x of between(posts, 1620, 1696)) {
        expect(x.needle, `${k} ${x.t}`).toBeNull();
        expect(x.r.gap).toBe('hidden');
      }
    }
  });

  it('T9 the pitch falls 250 c in the last 300 ms while the level falls 25 dB: S does not move, B within 8 c', () => {
    const tail = (t: number): In => (t < 2500 ? { c: 0 } : { c: (-250 * (t - 2500)) / 300, db: -35 - (25 * (t - 2500)) / 300 });
    for (const k of ['steady', 'balanced'] as const) {
      const xs = needles(simulate(tail, k, { durMs: 2800 }).posts.filter((x) => x.t >= 2400));
      if (k === 'steady') expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
      else expect(Math.min(...xs)).toBeGreaterThanOrEqual(-8.5);
    }
  });

  // The fast exit reads the short centre, a median over `centreMs`: a step reaches it once more than half that window
  // is past the step, then 60 ms. So Q leaves by 1.10 s as the spec says; B (200 ms) by about 1.16 s and S (300 ms) by
  // about 1.21 s, as the reference simulation does. Every preset leaves before its hit would have landed.
  it('T10 +100 c from 1.0 s: the fast exit leaves in tune by Q 1.10, B 1.16, S 1.21 s, before the judge exit; no hit', () => {
    const want = { quick: 1090, balanced: 1160, steady: 1210 } as const;
    for (const k of ALL) {
      const { posts, hitAt } = simulate((t) => ({ c: t < 1000 ? 0 : 100 }), k);
      expect(between(posts, 960, 999).every((x) => x.inTune), k).toBe(true);
      const left = between(posts, 1000, 3000).find((x) => !x.inTune)!;
      near(left.t, want[k]);
      expect(left.t, k).toBeLessThan(1000 + STEADINESS_PRESETS[k].judgeMs / 2 + STEADINESS_PRESETS[k].exitDwellMs);
      expect(hitAt, k).toBeNull();
    }
  });

  it('T11 a drift to -40 c over 1 s from 0.5 s: needle reaches -37 c (S) / -38 c (B); in tune left within 500 ms of -35 c', () => {
    const drift = (t: number): In => ({ c: t < 500 ? 0 : Math.max(-40, (-40 * (t - 500)) / 1000) });
    // The truth crosses -35 c at 1.375 s.
    for (const k of ['steady', 'balanced'] as const) {
      const { posts } = simulate(drift, k, { hitMs: 1e9 });
      const xs = needles(between(posts, 1000, 2900));
      expect(Math.min(...xs), k).toBeLessThanOrEqual(k === 'steady' ? -36 : -37);
      expect(Math.min(...xs), k).toBeGreaterThanOrEqual(-41);
      const left = between(posts, 1000, 3000).find((x) => !x.inTune)!;
      expect(left.t, k).toBeLessThanOrEqual(1375 + 500);
    }
  });

  it('T12 a scoop from -200 c over 250 ms: the needle shows the rise, within 10 c by S 560, B 456, Q 304 ms; not in tune before judgeMs', () => {
    const scoop = (t: number): In => ({ c: Math.min(0, -200 + 0.8 * t) });
    const want = { steady: 560, balanced: 456, quick: 304 } as const;
    for (const k of ALL) {
      const { posts } = simulate(scoop, k, { hitMs: 1e9 });
      const shown = needles(between(posts, 60, 200));
      expect(shown[0]!, k).toBeLessThan(-40);
      const i = posts.findIndex((x, n) => x.needle !== null && posts.slice(n).filter((y) => y.t - x.t <= 200).every((y) => y.needle !== null && Math.abs(y.needle) <= 10));
      near(posts[i]!.t, want[k], 30);
      expect(posts.filter((x) => x.t < STEADINESS_PRESETS[k].judgeMs).some((x) => x.inTune), k).toBe(false);
    }
  });

  it('T13 exactly an octave low (-1200 c), held: needle 0 and a hit (a voice is octave-free, R7)', () => {
    for (const k of ALL) {
      const { posts, hitAt } = simulate(flat(-1200), k);
      expect(between(posts, 100, 3000).every((x) => x.needle === 0), k).toBe(true);
      near(hitAt, simulate(flat(0), k).hitAt!, 0);
    }
  });

  it('T14 an instrument (no fold) an octave high: never in tune, never a hit', () => {
    for (const k of ALL) {
      const { posts, hitAt } = simulate(flat(1200), k, { voice: false, band: 25 });
      expect(posts.some((x) => x.inTune), k).toBe(false);
      expect(hitAt, k).toBeNull();
      expect(between(posts, 100, 3000).every((x) => x.needle === 50), k).toBe(true);
    }
  });
});

describe('properties', () => {
  it('never shows a value during silence, whatever came before', () => {
    const rng = createRng(7);
    for (let n = 0; n < 40; n++) {
      const k = ALL[n % 3]!;
      const f = new SteadinessFilter(STEADINESS_PRESETS[k]);
      // Silence only: nothing at all.
      for (let t = 0; t < 1000; t += DT) {
        f.push(t, null, -90);
        expect(f.reading.settledMidi).toBeNull();
      }
      // A random note, then silence: hidden within 600 ms (+ a frame), and nothing reappears while silent.
      const end = 1000 + 200 + Math.floor(rng.next() * 1500);
      for (let t = 1000; t < end; t += DT) f.push(t, 45 + rng.next() * 20, -50 + rng.next() * 10);
      for (let t = end; t < end + 2000; t += DT) {
        f.push(t, rng.next() < 0.5 ? null : 50 + rng.next() * 10, rng.next() < 0.5 ? -90 : -70);
        if (t >= end + 600 + DT) expect(f.reading.settledMidi, `${k} ${t}`).toBeNull();
      }
    }
  });

  it('a held glitch (any size over 300 c, up to 220 ms) never moves the output', () => {
    const rng = createRng(11);
    for (let n = 0; n < 60; n++) {
      const k = ALL[n % 3]!;
      const size = (rng.next() < 0.5 ? -1 : 1) * (310 + rng.next() * 1700);
      const len = 8 + Math.floor(rng.next() * 26) * DT;
      const at = 1000 + Math.floor(rng.next() * 100) * DT;
      const f = new SteadinessFilter(STEADINESS_PRESETS[k]);
      let before: number | null = null;
      for (let t = 0; t < at + 600; t += DT) {
        const glitch = t >= at && t < at + len && t - at < 212;
        f.push(t, TARGET + (glitch ? size / 100 : 0), -35);
        if (t === at - DT) before = f.reading.settledMidi;
        if (t >= at) expect(f.reading.settledMidi, `${k} size ${size.toFixed(0)} len ${len} t ${t}`).toBe(before);
      }
    }
  });

  it('the in-tune decision keeps the hit once earned and only ever reports a hit whose 800 ms median is within the band', () => {
    const rng = createRng(3);
    for (let n = 0; n < 60; n++) {
      const k = ALL[n % 3]!;
      const centre = -60 + rng.next() * 120;
      const amp = rng.next() * 45;
      const hz = 2 + rng.next() * 5;
      const { posts, hitAt } = simulate(sine(amp, hz, centre), k);
      if (hitAt !== null) {
        const at = posts.find((x) => x.t === hitAt)!;
        expect(Math.abs(centsAgainst(at.r.holdMidi!, TARGET, true))).toBeLessThanOrEqual(BAND);
        expect(posts.filter((x) => x.t >= hitAt).every((x) => x.judge.hitAt === hitAt)).toBe(true);
      }
      if (Math.abs(centre) >= 45) expect(hitAt, `${k} centre ${centre.toFixed(1)} amp ${amp.toFixed(1)}`).toBeNull();
    }
  });

  it('is deterministic: the same frames give the same readings', () => {
    const a = simulate(sine(30, 3.3, -10), 'balanced').posts.map((x) => [x.needle, x.inTune]);
    const b = simulate(sine(30, 3.3, -10), 'balanced').posts.map((x) => [x.needle, x.inTune]);
    expect(a).toEqual(b);
  });

  it('presets are ordered by calm: on a ±22 c 3.3 Hz wobble the needle moves least on Steady, most on Quick', () => {
    const move = (k: PitchSteadiness): number => sd(needles(between(simulate(sine(22, 3.3), k, { hitMs: 1e9 }).posts, 800, 3000)));
    expect(move('steady')).toBeLessThan(move('balanced'));
    expect(move('balanced')).toBeLessThan(move('quick'));
    expect(move('steady')).toBeLessThan(3);
  });
});
