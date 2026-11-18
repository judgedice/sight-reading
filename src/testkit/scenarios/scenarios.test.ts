import { describe, expect, it } from 'vitest';
import { FOLLOW_SCENARIOS } from '../../../fixtures/follow/gen/follow-scenarios.ts';
import type { TestkitTimbre } from '../../core/types.ts';
import { fingerprint } from '../synth/dsp-util.ts';
import { TIMBRE_IDS } from '../synth/timbres.ts';
import {
  createScenarioSet,
  DEFAULT_SCENARIO_COUNT,
  GOLDEN_CASES,
  GOLDEN_SPECS,
  planGoldenDisplacement,
  planScenario,
  renderScenario,
  scenarioConfigs,
  scheduledClicks,
  type ScenarioPlan,
} from './index.ts';

const set = createScenarioSet();
const plans: ScenarioPlan[] = [...set.plans()];
const CLEAN = { capture: { room: null, phoneMic: null, agc: null, captureRateHz: 48000, noiseDbfs: null }, click: { bleedDb: null } } as const;

describe('scenario set (01 section 13.2: 300 seeded scenarios from the fixture corpus)', () => {
  it('has 300 scenarios', () => {
    expect(set.count).toBe(300);
    expect(DEFAULT_SCENARIO_COUNT).toBe(300);
    expect(plans).toHaveLength(300);
  });

  it('is deterministic by seed and lazily random-access', () => {
    const again = createScenarioSet();
    // Random access first: no earlier plan is needed to build plan 217.
    expect(JSON.stringify(again.plan(217))).toBe(JSON.stringify(plans[217]));
    expect(JSON.stringify([...again.plans()])).toBe(JSON.stringify(plans));
    expect(JSON.stringify(planScenario(set.seed, 42))).toBe(JSON.stringify(plans[42]));
    const other = createScenarioSet({ seed: 7 });
    const diff = plans.filter((p, i) => JSON.stringify(p) !== JSON.stringify(other.plan(i))).length;
    expect(diff).toBeGreaterThan(250);
    expect(() => set.plan(300)).toThrow(RangeError);
  });

  it('covers every testkit timbre, many excerpts and every perturbation kind', () => {
    const byTimbre = new Map<TestkitTimbre, number>();
    for (const p of plans) byTimbre.set(p.base.timbre, (byTimbre.get(p.base.timbre) ?? 0) + 1);
    for (const t of TIMBRE_IDS) expect(byTimbre.get(t)).toBeGreaterThanOrEqual(33);
    expect(new Set(plans.map((p) => p.base.excerptId)).size).toBeGreaterThanOrEqual(20);
    expect(new Set(plans.map((p) => p.base.instrumentId))).toEqual(
      new Set(['flute', 'clarinet-bb', 'sax-alto', 'trumpet-bb', 'violin', 'cello', 'voice-soprano', 'voice-alto', 'voice-tenor', 'voice-bass', 'piano-rh', 'tuba']),
    );
    const kinds = new Set(plans.flatMap((p) => p.perturbation.kinds));
    for (const k of ['timing', 'cents', 'semitone', 'octave', 'drop', 'extra', 'stop', 'restart', 'skip', 'rejoin']) expect(kinds, k).toContain(k);
    const clean = plans.filter((p) => p.perturbation.notes.every((n) => n.errors.length === 0) && !p.perturbation.extras.length).length;
    expect(clean).toBeGreaterThan(40);
    // Real rhythms: meters and levels from the corpus.
    expect(new Set(plans.map((p) => `${p.base.meter.beats}/${p.base.meter.beatType}`)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(plans.map((p) => p.base.level)).size).toBeGreaterThanOrEqual(7);
  });

  it('covers every 13.2 realism condition', () => {
    const has = (f: (p: ScenarioPlan) => boolean): number => plans.filter(f).length;
    expect(has((p) => p.capture.phoneMic?.highPassHz === 100)).toBeGreaterThan(10);
    expect(has((p) => p.capture.phoneMic?.highPassHz === 150)).toBeGreaterThan(10);
    expect(has((p) => !!p.capture.room && p.capture.room.rt60Sec < 0.35)).toBeGreaterThan(5);
    expect(has((p) => !!p.capture.room && p.capture.room.rt60Sec > 0.65)).toBeGreaterThan(5);
    expect(has((p) => !!p.capture.agc)).toBeGreaterThan(10);
    expect(has((p) => p.capture.captureRateHz === 24000)).toBeGreaterThan(10);
    expect(has((p) => p.capture.captureRateHz === 16000)).toBeGreaterThan(10);
    expect(has((p) => p.capture.noiseDbfs === -45)).toBeGreaterThan(10);
    expect(has((p) => p.capture.noiseDbfs === -50)).toBeGreaterThan(10);
    for (const timbre of ['tick', 'wood'] as const) for (const bleed of [-20, -10]) expect(has((p) => p.click.timbre === timbre && p.click.bleedDb === bleed)).toBeGreaterThan(10);
    expect(has((p) => (p.performance.softAttackSec ?? 0) >= 0.03)).toBeGreaterThan(10);
    expect(has((p) => !!p.performance.vibrato && p.performance.vibrato.cents >= 25)).toBeGreaterThan(5);
    expect(has((p) => p.performance.breathDb === null)).toBeGreaterThan(5);
  });

  it('keeps every IOI above the 01 section 8.3 floors and every pitch inside the detector range', () => {
    const cfg = scenarioConfigs();
    for (const p of plans) {
      const { inst, expected } = p.base;
      const f = cfg.budget.ioiFloors;
      const pc = f.pitchChangeMs[String(inst.detection.windowSamples) as '512'] / 1000;
      const soft = inst.detection.onsetProfile === 'voice' || inst.detection.onsetProfile === 'bowed';
      const rep = (soft ? f.repeatMs.voiceOrBowed : f.repeatMs.tonguedOrStruck) / 1000;
      for (let i = 1; i < expected.length; i++) {
        const ioi = expected[i]!.onsetSec - expected[i - 1]!.onsetSec;
        expect(ioi, p.id).toBeGreaterThanOrEqual((expected[i]!.concertMidi === expected[i - 1]!.concertMidi ? rep : pc) - 1e-6);
      }
      const lo = 69 + 12 * Math.log2(inst.detection.minHz / 440);
      const hi = 69 + 12 * Math.log2(inst.detection.maxHz / 440);
      for (const n of p.perturbation.notes) {
        const m = expected[n.idx]!.concertMidi + n.semis + 12 * n.octaves;
        expect(m, p.id).toBeGreaterThanOrEqual(lo);
        expect(m, p.id).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('structural cases have the shape of the golden fixtures', () => {
    for (const p of plans) {
      const pt = p.perturbation;
      if (pt.structural === 'restart' || pt.structural === 'skip') {
        expect(pt.displaced).toHaveLength(1);
        const s = pt.displaced[0]!;
        expect(s.toIdx - s.fromIdx + 1).toBeGreaterThanOrEqual(4);
        expect(s.offsetBeats).toBe(pt.structural === 'skip' ? p.base.beatsPerBar : -Math.abs(s.offsetBeats));
        expect(pt.notes.some((n) => n.omitReason === pt.structural)).toBe(true);
      } else {
        expect(pt.displaced).toHaveLength(0);
      }
      if (pt.structural === 'stop') {
        // A contiguous run inside at most two bars starting on a downbeat.
        const omitted = pt.notes.filter((n) => n.omitReason === 'stop').map((n) => n.idx);
        expect(omitted.length).toBeGreaterThan(0);
        expect(omitted[omitted.length - 1]! - omitted[0]!).toBe(omitted.length - 1);
        const bpb = p.base.beatsPerBar;
        const startBar = Math.floor(p.base.expected[omitted[0]!]!.onsetBeat / bpb + 1e-9);
        expect(p.base.expected[omitted[omitted.length - 1]!]!.onsetBeat).toBeLessThan((startBar + 2) * bpb);
      }
    }
  });
});

describe('rendering', () => {
  it('renders deterministically and labels every played note', () => {
    const idx = [0, 4, 6];
    for (const i of idx) {
      const a = set.render(i);
      const b = set.render(i);
      expect(fingerprint(a.samples)).toBe(fingerprint(b.samples));
      expect(a.sampleRate).toBe(plans[i]!.capture.captureRateHz);
      expect(a.truth).toHaveLength(a.played.length);
      expect(a.truth.map((t) => t.truth)).toEqual(a.played.map((x) => x.truth));
      // Every on-time match is an expected note that was played; omitted notes have no match.
      const matched = new Set(a.truth.filter((t) => t.truth.kind === 'match').map((t) => (t.truth as { idx: number }).idx));
      for (const n of plans[i]!.perturbation.notes) expect(matched.has(n.idx)).toBe(n.played);
      const disp = a.truth.filter((t) => t.truth.kind === 'displaced').length;
      expect(disp).toBe(plans[i]!.perturbation.displaced.reduce((s, d) => s + d.toIdx - d.fromIdx + 1, 0));
      if (plans[i]!.click.bleedDb !== null) expect(a.bleedClickTimes).toEqual(a.clicks.map((c) => c.t));
    }
  }, 60_000);

  it.each(TIMBRE_IDS.map((t, i) => [t, i]))('%s: truth onsets follow the performance within 1 ms on a clean render', (_t, i) => {
    const r = renderScenario(plans[i as number]!, CLEAN);
    for (const t of r.truth) {
      const scripted = r.t0Sec + r.played[t.playedIdx]!.onset;
      expect(Math.abs(t.onsetSec - scripted), `${plans[i as number]!.id} played ${t.playedIdx} ${t.onsetRule}`).toBeLessThanOrEqual(0.001);
      expect(t.scoreOnsetSec).toBeCloseTo(t.onsetSec - r.t0Sec, 12);
      expect(Math.abs(t.midi + t.cents / 100 - r.played[t.playedIdx]!.midi)).toBeLessThan(1e-6);
    }
  }, 60_000);

  it('schedules a click on every beat from the count-in to the end of the take', () => {
    const p = plans[3]!;
    const c = scheduledClicks(p.timeline, p.base.beatsPerBar);
    expect(c[0]!.t).toBeCloseTo(p.timeline.leadInSec, 9);
    expect(c[0]!.accent).toBe(true);
    const at0 = c.findIndex((x) => Math.abs(x.t - p.timeline.t0Sec) < 1e-9);
    expect(at0).toBe(p.timeline.countInBeats);
    expect(c[c.length - 1]!.t).toBeLessThanOrEqual(p.timeline.t0Sec + p.timeline.endScoreSec + 1e-9);
  });
});

describe('golden displacement cases (randomized renders)', () => {
  it('reproduce the follow fixtures exactly in omissions, replays and segments', () => {
    for (const c of GOLDEN_CASES) {
      const fx = FOLLOW_SCENARIOS.find((s) => s.id === c);
      expect(fx, c).toBeDefined();
      const spec = fx!.spec;
      const omitted = Object.entries(spec.mods ?? {})
        .filter(([, m]) => m.omit)
        .map(([i]) => Number(i));
      expect(GOLDEN_SPECS[c].omit).toEqual(omitted);
      expect(GOLDEN_SPECS[c].replays).toEqual(spec.replays ?? []);
      const p = planGoldenDisplacement(c, 3);
      expect(p.base.excerptId).toBe('le-beau-lc5883655-voice-mp1-9');
      expect(p.base.bpm).toBe(90);
      expect(p.click.bleedDb).not.toBeNull();
      expect(p.capture.phoneMic).not.toBeNull();
      expect(p.perturbation.displaced).toEqual(GOLDEN_SPECS[c].displaced);
    }
  });

  it('differ between renders and are deterministic per render index', () => {
    const a = planGoldenDisplacement('back-2-beats', 0);
    expect(JSON.stringify(planGoldenDisplacement('back-2-beats', 0))).toBe(JSON.stringify(a));
    expect(JSON.stringify(planGoldenDisplacement('back-2-beats', 1).perturbation.spec.jitterMs)).not.toBe(JSON.stringify(a.perturbation.spec.jitterMs));
    const r = renderScenario(a);
    const disp = r.truth.filter((t) => t.truth.kind === 'displaced');
    expect(disp).toHaveLength(6);
    // The replay starts two beats late relative to the first play of note 22.
    const first = r.truth.find((t) => t.truth.kind === 'match' && t.truth.idx === 22)!;
    expect(disp[0]!.scoreOnsetSec - first.scoreOnsetSec).toBeCloseTo(2 * (60 / 90), 1);
  }, 30_000);
});
