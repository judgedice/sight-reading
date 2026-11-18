/**
 * P4c acceptance (01 section 15): onset F1 >= 0.97 at +-30 ms on clean launch timbres; 6 dB tonguing dips split;
 * +-30 c vibrato with 5 dB AM never splits; hints act only inside windows. Plus onset-time accuracy against the
 * 7.4 definition as the P3 synth applies it (ground truth on the dry signal).
 *
 * The F1 gate renders `SCENARIOS_PER_TIMBRE` corpus scenarios per launch timbre from `createScenarioSet` with clean
 * capture conditions (no phone mic, room, AGC, noise or click bleed; 48 kHz). Set P4C_FULL=1 to run every scenario
 * of the 300-scenario set (about 33 per timbre).
 */
import { describe, expect, it } from 'vitest';
import type { DetectedNote, DspConfig, DspEvent, TestkitTimbre } from '../core/types.ts';
import { createScenarioSet, scenarioConfigs, type ScenarioRender } from '../testkit/scenarios/index.ts';
import { renderPerformance, type SynthNoteSpec, type VibratoSpec } from '../testkit/synth/index.ts';
import { TIMBRE_IDS } from '../testkit/synth/timbres.ts';
import { runOffline } from './pipeline.ts';
import { segmenterOptions } from './segmenter.ts';

const cfgs = scenarioConfigs();

function dspConfig(instrumentId: string, repeatHints: DspConfig['repeatHints'] = []): DspConfig {
  const inst = cfgs.instrumentById[instrumentId];
  if (!inst) throw new Error(`no instrument ${instrumentId}`);
  const d = inst.detection;
  return {
    analysisRate: 16000,
    windowSamples: d.windowSamples,
    hopSamples: 128,
    minHz: d.minHz,
    maxHz: d.maxHz,
    a4Hz: 440,
    clarityThreshold: d.clarityThreshold,
    changeCents: d.changeCents,
    onsetProfile: d.onsetProfile,
    vibratoClass: d.vibratoClass,
    outputMode: 'wired',
    clicks: [],
    clickTemplate: null,
    repeatHints,
  };
}

const notesOf = (events: DspEvent[], type: 'note-on' | 'note-off' = 'note-on'): DetectedNote[] =>
  events.flatMap((e) => (e.type === type ? [e.note] : []));

const LAUNCH: readonly { timbre: TestkitTimbre; instrument: string; pitches: [number, number] }[] = [
  { timbre: 'flute', instrument: 'flute', pitches: [64, 84] },
  { timbre: 'clarinet', instrument: 'clarinet-bb', pitches: [52, 72] },
  { timbre: 'sax', instrument: 'sax-alto', pitches: [50, 68] },
  { timbre: 'trumpet', instrument: 'trumpet-bb', pitches: [55, 72] },
  { timbre: 'violin', instrument: 'violin', pitches: [57, 81] },
  { timbre: 'cello', instrument: 'cello', pitches: [38, 60] },
  { timbre: 'voice', instrument: 'voice-alto', pitches: [55, 70] },
  { timbre: 'piano', instrument: 'piano-rh', pitches: [50, 74] },
];

function render(timbre: TestkitTimbre, notes: SynthNoteSpec[], o: { vibrato?: VibratoSpec | null; breathDb?: number | null } = {}) {
  return renderPerformance({ timbre, notes, sampleRate: 48000, ...o });
}

// ------------------------------------------------------------------------------------- F1 gate

const TOL_SEC = 0.03;
const SCENARIOS_PER_TIMBRE = process.env.P4C_FULL ? 34 : 4;

interface F1Result {
  tp: number;
  fp: number;
  fn: number;
  f1: number;
  errorsMs: number[];
}

/**
 * Greedy one-to-one matching in onset order at +-30 ms. Truth notes the 7.4 rule calls undetectable (a dip too
 * shallow to tell from one held note) are neither required nor counted as false positives when matched.
 */
function scoreOnsets(r: ScenarioRender, detected: DetectedNote[]): F1Result {
  const required = r.truth.filter((t) => t.detectable).sort((a, b) => a.onsetSec - b.onsetSec);
  const optional = r.truth.filter((t) => !t.detectable);
  const used = new Set<number>();
  let tp = 0;
  let fn = 0;
  const errorsMs: number[] = [];
  for (const t of required) {
    let best = -1;
    let bd = Infinity;
    detected.forEach((n, j) => {
      if (used.has(j)) return;
      const d = Math.abs(n.onset - t.onsetSec);
      if (d < bd) {
        bd = d;
        best = j;
      }
    });
    if (best >= 0 && bd <= TOL_SEC) {
      used.add(best);
      tp++;
      errorsMs.push(((detected[best] as DetectedNote).onset - t.onsetSec) * 1000);
    } else fn++;
  }
  let fp = 0;
  detected.forEach((n, j) => {
    if (used.has(j)) return;
    if (optional.some((t) => Math.abs(t.onsetSec - n.onset) <= TOL_SEC)) return;
    fp++;
  });
  const p = tp / Math.max(1, tp + fp);
  const rc = tp / Math.max(1, tp + fn);
  return { tp, fp, fn, f1: p + rc > 0 ? (2 * p * rc) / (p + rc) : 0, errorsMs };
}

const CLEAN = {
  capture: { phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null },
  click: { bleedDb: null },
} as const;

describe('onset F1 on clean launch timbres (P4c acceptance)', () => {
  const set = createScenarioSet();
  const launchIdx = TIMBRE_IDS.slice(0, 8).map((t, i) => ({ timbre: t, i }));
  it.each(launchIdx)('$timbre: F1 >= 0.97 at +-30 ms', ({ timbre, i }) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const errs: number[] = [];
    for (let k = 0; k < SCENARIOS_PER_TIMBRE; k++) {
      const idx = i + 9 * k;
      if (idx >= set.count) break;
      const r = set.render(idx, CLEAN);
      expect(r.plan.base.timbre).toBe(timbre);
      const { events } = runOffline(r.samples, r.sampleRate, dspConfig(r.plan.base.instrumentId));
      const s = scoreOnsets(r, notesOf(events));
      tp += s.tp;
      fp += s.fp;
      fn += s.fn;
      errs.push(...s.errorsMs);
    }
    const p = tp / (tp + fp);
    const rc = tp / (tp + fn);
    const f1 = (2 * p * rc) / (p + rc);
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const e90 = abs[Math.floor(0.9 * (abs.length - 1))] as number;
    process.stdout.write(`P4c F1 ${timbre}: ${f1.toFixed(4)} (tp ${tp}, fp ${fp}, fn ${fn}); onset error mean ${mean.toFixed(2)} ms, e90 ${e90.toFixed(2)} ms\n`);
    expect(tp).toBeGreaterThan(20);
    expect(f1).toBeGreaterThanOrEqual(0.97);
    // Matched onsets agree with the 7.4 truth far inside the tolerance (01 section 8.1 budgets 6 to 18 ms sigma).
    expect(e90).toBeLessThan(10);
  }, 240_000);
});

// ------------------------------------------------------------------------------------- re-articulation rules

describe('re-articulation (01 section 7.4 item 4, 7.5)', () => {
  it.each(LAUNCH)('$timbre: 6 dB tonguing dips split, onsets within 5 ms of the 7.4 half-rise', ({ timbre, instrument, pitches }) => {
    for (const midi of pitches) {
      const notes = [0, 1, 2, 3].map((k) => ({ midi, onsetSec: 0.3 + 0.4 * k, durSec: 0.4, dipDb: 6 }));
      const r = render(timbre, notes, { vibrato: null });
      const on = notesOf(runOffline(r.samples, r.sampleRate, dspConfig(instrument)).events);
      expect(on.map((n) => n.onset.toFixed(2)), `${timbre} ${midi}`).toEqual(r.truth.map((t) => t.onsetSec.toFixed(2)));
      on.forEach((n, k) => expect(Math.abs(n.onset - (r.truth[k]?.onsetSec as number))).toBeLessThan(0.005));
      if (timbre !== 'piano') expect(on.slice(1).every((n) => n.onsetCause === 'repeat')).toBe(true);
    }
  }, 60_000);

  it.each(LAUNCH)('$timbre: +-30 c vibrato with 5 dB AM never splits a held note', ({ timbre, instrument, pitches }) => {
    const vib: VibratoSpec = { hz: 5.5, cents: 30, amDb: 5, delaySec: 0.15 };
    for (const [a, b] of [pitches, [pitches[0] + 5, pitches[1] - 3]]) {
      const notes = [
        { midi: a as number, onsetSec: 0.3, durSec: 1.6 },
        { midi: b as number, onsetSec: 2.2, durSec: 1.6 },
      ];
      const r = render(timbre, notes, { vibrato: vib });
      const on = notesOf(runOffline(r.samples, r.sampleRate, dspConfig(instrument)).events);
      expect(on.length, `${timbre} ${a} ${b}: ${on.map((n) => n.onset.toFixed(3)).join(' ')}`).toBe(2);
      expect(Math.abs((on[0]?.onset as number) - (r.truth[0]?.onsetSec as number))).toBeLessThan(0.01);
      expect(Math.abs((on[1]?.onset as number) - (r.truth[1]?.onsetSec as number))).toBeLessThan(0.01);
    }
  }, 60_000);

  it.each([
    { timbre: 'flute' as const, instrument: 'flute', midi: 74 },
    { timbre: 'clarinet' as const, instrument: 'clarinet-bb', midi: 64 },
    { timbre: 'trumpet' as const, instrument: 'trumpet-bb', midi: 64 },
    { timbre: 'violin' as const, instrument: 'violin', midi: 69 },
    { timbre: 'voice' as const, instrument: 'voice-alto', midi: 62 },
  ])('$timbre: repeat hints lower the dip threshold only inside their windows', ({ timbre, instrument, midi }) => {
    // 2.5 dB dips: below the strict 3 dB floor, above the 2 dB hint floor (7.5).
    const notes = [0, 1, 2].map((k) => ({ midi, onsetSec: 0.3 + 0.5 * k, durSec: 0.5, dipDb: 2.5 }));
    const r = render(timbre, notes, { vibrato: null, breathDb: null });
    const t1 = r.truth[1]?.onsetSec as number;
    const t2 = r.truth[2]?.onsetSec as number;
    expect(r.truth.slice(1).every((t) => !t.detectable)).toBe(true);
    const onsets = (hints: DspConfig['repeatHints']): number[] =>
      notesOf(runOffline(r.samples, r.sampleRate, dspConfig(instrument, hints)).events).map((n) => n.onset);

    expect(onsets([])).toHaveLength(1);
    const hinted = onsets([{ t: t2 as never, halfWidthSec: 0.1 }]);
    expect(hinted).toHaveLength(2);
    expect(Math.abs((hinted[1] as number) - t2)).toBeLessThan(0.005);
    // A window that misses the dip (centre 250 ms away, half-width 100 ms) does nothing.
    expect(onsets([{ t: (t1 + 0.25) as never, halfWidthSec: 0.1 }])).toHaveLength(1);
    // Both windows: both split.
    expect(onsets([{ t: t1 as never, halfWidthSec: 0.1 }, { t: t2 as never, halfWidthSec: 0.1 }])).toHaveLength(3);
  }, 60_000);

  it('dips below the 2 dB hint floor never split, even inside a hint window', () => {
    const notes = [0, 1, 2].map((k) => ({ midi: 74, onsetSec: 0.3 + 0.5 * k, durSec: 0.5, dipDb: 1.6 }));
    const r = render('flute', notes, { vibrato: null, breathDb: null });
    const hints = r.truth.slice(1).map((t) => ({ t: t.onsetSec as never, halfWidthSec: 0.1 }));
    expect(notesOf(runOffline(r.samples, r.sampleRate, dspConfig('flute', hints)).events)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------- onset kinds and statistics

describe('onset kinds', () => {
  it('slurred pitch changes: onset at the cents-midpoint crossing (within the P4b crossing bias budget)', () => {
    const notes = [62, 64, 66, 67, 69, 71].map((midi, k) => ({ midi, onsetSec: 0.3 + 0.3 * k, durSec: 0.3, slur: k > 0 }));
    for (const [timbre, instrument] of [['flute', 'flute'], ['clarinet', 'clarinet-bb'], ['violin', 'violin']] as const) {
      const r = render(timbre, notes, { vibrato: null });
      const on = notesOf(runOffline(r.samples, r.sampleRate, dspConfig(instrument)).events);
      expect(on).toHaveLength(notes.length);
      r.truth.forEach((t, k) => {
        const n = on[k] as DetectedNote;
        expect(Math.abs(n.onset - t.onsetSec), `${timbre} note ${k}`).toBeLessThan(0.006);
        expect(Math.round(n.midi)).toBe(t.midi);
        if (k > 0) expect(n.onsetCause).toBe('pitch-change');
      });
      expect(on[0]?.onsetCause).toBe('from-silence');
    }
  });

  it('tongued changes of pitch take the dip half-rise, struck notes the attack', () => {
    const notes = [60, 64, 62, 67].map((midi, k) => ({ midi, onsetSec: 0.3 + 0.35 * k, durSec: 0.35 }));
    for (const [timbre, instrument] of [['trumpet', 'trumpet-bb'], ['piano', 'piano-rh']] as const) {
      const r = render(timbre, notes, { vibrato: null });
      const on = notesOf(runOffline(r.samples, r.sampleRate, dspConfig(instrument)).events);
      expect(on).toHaveLength(4);
      r.truth.forEach((t, k) => expect(Math.abs((on[k] as DetectedNote).onset - t.onsetSec), `${timbre} ${k}`).toBeLessThan(0.004));
    }
  });

  it('notes separated by silence start from silence and end with an offset near the release', () => {
    const notes = [0, 1, 2].map((k) => ({ midi: 69, onsetSec: 0.3 + 0.6 * k, durSec: 0.3 }));
    const r = render('clarinet', notes);
    const ev = runOffline(r.samples, r.sampleRate, dspConfig('clarinet-bb')).events;
    const off = notesOf(ev, 'note-off');
    expect(off).toHaveLength(3);
    off.forEach((n, k) => {
      expect(n.onsetCause).toBe('from-silence');
      expect(Math.abs(n.onset - (r.truth[k]?.onsetSec as number))).toBeLessThan(0.005);
      expect(n.offset).not.toBeNull();
      expect(Math.abs((n.offset as number) - (r.truth[k]?.offsetSec as number))).toBeLessThan(0.06);
    });
  });
});

describe('DetectedNote statistics (01 section 7.5)', () => {
  it('reports the steady median in cents, a small SD, steadyMs and clarity for a held note', () => {
    const r = render('clarinet', [{ midi: 69, cents: 20, onsetSec: 0.3, durSec: 1.0 }], { vibrato: null });
    const ev = runOffline(r.samples, r.sampleRate, dspConfig('clarinet-bb')).events;
    const [n] = notesOf(ev, 'note-off');
    expect(n).toBeDefined();
    const note = n as DetectedNote;
    expect(Math.round(note.midi)).toBe(69);
    expect(note.stableMedianCents).toBeGreaterThan(15);
    expect(note.stableMedianCents).toBeLessThan(25);
    expect(note.pitchSdCents).toBeLessThan(5);
    expect(Math.abs(note.provisionalMidi - 69.2)).toBeLessThan(0.15);
    // steady = to the last voiced frame, from onset + 50 ms attack exclusion, minus 30 ms.
    expect(note.steadyMs).toBeGreaterThan(800);
    expect(note.steadyMs).toBeLessThan(1000);
    expect(note.clarity).toBeGreaterThan(0.9);
    expect(note.altOctaveClarity).not.toBeNull();
  });

  it('segmenterOptions converts seconds with the hop and sets profile parameters', () => {
    const a = segmenterOptions(0.008, { windowSec: 0.064, clarityThreshold: 0.85, changeCents: 60, onsetProfile: 'tongued-wind' });
    expect([a.onsetConfirmFrames, a.changeConfirmFrames, a.offsetFrames]).toEqual([3, 3, 8]);
    expect(a.attackExcludeSec).toBeCloseTo(0.05, 12);
    const v = segmenterOptions(128 / 14700, { windowSec: 0.07, clarityThreshold: 0.8, changeCents: 80, onsetProfile: 'voice' });
    expect([v.onsetConfirmFrames, v.changeConfirmFrames, v.offsetFrames]).toEqual([3, 4, 7]);
    expect(v.fluxRouteFactor).toBeGreaterThan(a.fluxRouteFactor);
    const p = segmenterOptions(0.008, { windowSec: 0.064, clarityThreshold: 0.8, changeCents: 40, onsetProfile: 'struck' });
    expect(p.struck).toBe(true);
    expect(p.fluxRouteFactor).toBeLessThan(a.fluxRouteFactor);
  });
});
