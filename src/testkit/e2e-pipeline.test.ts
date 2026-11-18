/**
 * End-to-end pipeline without a browser (wave 2 review): the product's core claim on synthetic audio.
 *
 * For three fixture excerpts and three launch timbres (flute, trumpet, violin), a performance is scripted from the
 * excerpt's expected notes, rendered through the P3 synth, captured through FakeAudioBackend (the production
 * decimator and high-band primitives), analysed by the P4c/P4d DspPipeline, followed live by the P10a LiveFollower,
 * aligned by the P10b final alignment, and graded by P12 grade().
 *
 * - The error take carries exactly three injected errors: one late note (halfway between tRed and the match window),
 *   one wrong pitch (±2 semitones) and one flat note (halfway between redCents and the semitone boundary). Each must
 *   come out with the right verdict, live and final; every other note must be matched, on time and right in pitch.
 * - The clean take (the fixture generator's default ±4 ms jitter and ±3 c pattern) must grade A or S with no
 *   missed or extra notes.
 *
 * The note indices are chosen by rules on the expected notes (not tuned per excerpt): see `pickErrors`.
 * Capture is clean (headphone mode, no clicks, no room): the room and click conditions are P18's gates.
 */
import { describe, expect, it } from 'vitest';
import type { AttemptScore, ClockSeconds, DetectedNote, DspConfig, DspEvent, ExpectedNote, FinalAlignment, FollowConfig, FollowerEvent, FollowStreamItem, GradeInput, Instrument, LiveJudgment, ResolvedTolerance } from '../core/types.ts';
import type { WorkerMessage } from '../core/platform.ts';
import { DspPipeline } from '../dsp/pipeline.ts';
import { LiveFollower, finalAlign, liveOutcomeOf } from '../follow/index.ts';
import { grade } from '../grade/index.ts';
import { resolveTolerances } from '../rules/index.ts';
import { perform, endOfTakeSec, type PerformSpec } from '../../fixtures/follow/gen/perform.ts';
import { FakeAudioBackend } from './fake-backend.ts';
import { finalDetected, liveSubject, runFollowStream } from './predicates/index.ts';
import { buildBase, clipTempo, fixtureDocs, scenarioConfigs, tempoRange, type ScenarioBase } from './scenarios/index.ts';
import { renderPerformance, type SynthNoteSpec } from './synth/index.ts';

const cfg = scenarioConfigs();
const RATE = 48000;
const LEAD_IN_SEC = 1;
const MS = 1000;

const EXCERPTS = ['jaell-lc6157272-voice-m20-27', 'mayer-sq8818128-cello-mv3-mp68-76', 'gouvy-sq10406164-cello-mv3-m1-10'];
/** Override with E2E_PIPELINE_INSTRUMENTS=clarinet-bb,sax-alto,cello for a wider probe (fixed-pitch piano has no flat case). */
const INSTRUMENTS = process.env.E2E_PIPELINE_INSTRUMENTS?.split(',') ?? ['flute', 'trumpet-bb', 'violin'];

function dspConfig(inst: Instrument, analysisRate: number): DspConfig {
  const d = inst.detection;
  return {
    analysisRate,
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
    repeatHints: [],
    attackExcludeMs: cfg.grading.intonation.attackExcludeMsByFamily[inst.family],
    clickLeakDb: null,
  };
}

function baseFor(excerptId: string, instrumentId: string): ScenarioBase {
  const doc = fixtureDocs().find((d) => d.id === excerptId);
  if (!doc) throw new Error(`no fixture doc ${excerptId}`);
  const [lo] = tempoRange(doc, cfg);
  const at60 = buildBase(doc, instrumentId, 60, cfg);
  if (!at60) throw new Error(`${excerptId} does not fit ${instrumentId}`);
  const bpm = clipTempo(at60.expected, at60.inst, lo, cfg);
  const b = buildBase(doc, instrumentId, bpm, cfg);
  if (!b) throw new Error(`${excerptId} does not fit ${instrumentId} at ${bpm}`);
  return b;
}

interface Injected {
  late: number;
  lateShiftMs: number;
  wrong: number;
  wrongSemis: number;
  flat: number;
  flatCents: number;
}

/**
 * Rule-based choice of the three error notes (indices 2..N-3, at least 2 apart, different pitches from both
 * neighbours so no injected note merges into a neighbour):
 * - flat: the longest intonation-graded note (its steady time must clear the vibrato-widening limit);
 * - late: the note with the longest gap to the next onset that fits the shift plus 150 ms of sound;
 * - wrong: the first remaining note of at least 250 ms whose ±2 semitone neighbour differs from both neighbours.
 */
function pickErrors(e: readonly ExpectedNote[], tol: readonly ResolvedTolerance[], inst: Instrument): Injected {
  const used: number[] = [];
  const free = (i: number) => used.every((u) => Math.abs(u - i) >= 2);
  const distinct = (i: number, midi: number) => midi !== e[i - 1]!.concertMidi && midi !== e[i + 1]!.concertMidi;
  const inner = e.slice(2, e.length - 2).map((x) => x.idx);

  const flatCands = inner.filter((i) => tol[i]!.redCents !== null && distinct(i, e[i]!.concertMidi));
  if (flatCands.length === 0) throw new Error('no intonation-graded note');
  const flat = flatCands.reduce((a, b) => (e[b]!.durSec > e[a]!.durSec ? b : a));
  used.push(flat);
  const red = tol[flat]!.redCents as number;
  const flatCents = -Math.round(red + (50 - red) / 2);

  const shiftOf = (i: number) => Math.round(MS * (tol[i]!.tRedSec + (tol[i]!.matchWindowSec - tol[i]!.tRedSec) / 2));
  const lateCands = inner.filter((i) => free(i) && distinct(i, e[i]!.concertMidi) && e[i + 1]!.onsetSec - e[i]!.onsetSec >= shiftOf(i) / MS + 0.15);
  if (lateCands.length === 0) throw new Error('no note with room for a late onset');
  const late = lateCands.reduce((a, b) => (e[b + 1]!.onsetSec - e[b]!.onsetSec > e[a + 1]!.onsetSec - e[a]!.onsetSec ? b : a));
  used.push(late);

  const [lo, hi] = [inst.detection.minHz, inst.detection.maxHz].map((hz) => 69 + 12 * Math.log2(hz / 440)) as [number, number];
  for (const i of inner) {
    if (!free(i) || e[i]!.durSec < 0.25) continue;
    for (const s of [2, -2]) {
      const m = e[i]!.concertMidi + s;
      if (m < lo + 1 || m > hi - 1 || !distinct(i, m)) continue;
      return { late, lateShiftMs: shiftOf(late), wrong: i, wrongSemis: s, flat, flatCents };
    }
  }
  throw new Error('no note for a wrong pitch');
}

interface TakeResult {
  base: ScenarioBase;
  config: FollowConfig;
  live: FollowerEvent[];
  detected: DetectedNote[];
  alignment: FinalAlignment;
  score: AttemptScore;
}

async function runTake(base: ScenarioBase, spec: PerformSpec): Promise<TakeResult> {
  const played = perform(base.expected, base.beatsPerBar, base.bpm, spec);
  const notes: SynthNoteSpec[] = played.map((p, k) => {
    const midi = Math.round(p.midi);
    return { midi, cents: Math.round((p.midi - midi) * 100 * 1000) / 1000, onsetSec: LEAD_IN_SEC + p.onset, durSec: Math.max(0.02, p.dur), slur: p.legato, ref: k };
  });
  const endScoreSec = endOfTakeSec(base.expected, base.bpm, cfg);
  const render = renderPerformance({ timbre: base.timbre, notes, sampleRate: RATE, durationSec: LEAD_IN_SEC + endScoreSec + 0.6, seed: 7 });

  const be = new FakeAudioBackend({ source: render.samples, sampleRate: RATE });
  const dsp = new DspPipeline(dspConfig(base.inst, be.analysisRate));
  const stream: FollowStreamItem[] = [];
  await be.startCapture((m: WorkerMessage) => {
    if (m.type !== 'block') return;
    const blockEnd = (m.block.startT + m.block.lowband.length / m.block.analysisRate) as ClockSeconds;
    for (const ev of dsp.push(m.block)) stream.push({ kind: 'dsp', t: blockEnd, event: ev });
    stream.push({ kind: 'clock', t: blockEnd });
  });
  const origin = be.now() as number;
  await be.run({ tailSec: 0.1 });
  // The source runs past the take end (R14: one beat after the last note's written end), so end at the clock.
  const endT = be.now();
  expect(endT as number).toBeGreaterThanOrEqual(origin + LEAD_IN_SEC + endScoreSec);
  for (const ev of dsp.flush(endT) as DspEvent[]) stream.push({ kind: 'dsp', t: endT, event: ev });
  stream.push({ kind: 'end', t: endT, end: { reason: 'complete' } });

  const tolerances = resolveTolerances(base.expected, { instrument: base.inst, level: base.level, bpm: base.bpm, meter: base.meter }, cfg);
  const config: FollowConfig = {
    expected: base.expected,
    tolerances,
    t0: (origin + LEAD_IN_SEC) as ClockSeconds,
    latencyCompensationSec: 0,
    bpm: base.bpm,
    beatsPerBar: base.beatsPerBar,
    instrument: base.inst,
    cfg,
    voiceReferenceCents: 0,
    analysisRate: be.analysisRate,
    writtenKey: base.writtenKey,
  };
  const live = runFollowStream(stream, new LiveFollower(config));
  const detected = finalDetected(stream);
  const alignment = finalAlign(config, detected, liveOutcomeOf(live));
  const input: GradeInput = {
    expected: base.expected,
    tolerances,
    alignment,
    detected,
    instrument: base.inst,
    level: base.level,
    bpm: base.bpm,
    meter: base.meter,
    writtenKey: base.writtenKey,
    cfg,
    tuning: { used: false, offsetCents: 0 },
    voiceReference: null,
    signal: { medianClarity: 0.95, clippingFrac: 0 },
    calibrationMeasured: true,
    ranking: { mode: 'ranked', seenBefore: false, scanStrict: true, familiarity: 0, skipLimitHit: false, metronome: 'audible', gateFailures: [] },
    xp: { playerLevel: base.level, randomized: { key: false, meter: false, tempo: false }, streakDays: 0, dailyCountBefore: 0, repeatIndexToday: 0, placement: false },
  };
  return { base, config, live, detected, alignment, score: grade(input) };
}

const describeJ = (j: { expectedIdx: number; status?: string; timing: string | null; timingErrorMs: number | null; pitch: string | null; centsError: number | null } | null | undefined): string =>
  j ? `#${j.expectedIdx} ${j.status ?? 'live'} ${j.timing}(${j.timingErrorMs?.toFixed(0)} ms) ${j.pitch}(${j.centsError?.toFixed(0)} c)` : 'none';

const RIGHT_PITCH = new Set(['in-tune', 'not-graded']);

describe('end-to-end pipeline: synth -> FakeAudioBackend -> dsp -> live follower -> final alignment -> grade', () => {
  for (const excerptId of EXCERPTS) {
    for (const instrumentId of INSTRUMENTS) {
      it(`${instrumentId} on ${excerptId}`, async () => {
        const base = baseFor(excerptId, instrumentId);
        const tol = resolveTolerances(base.expected, { instrument: base.inst, level: base.level, bpm: base.bpm, meter: base.meter }, cfg);
        const inj = pickErrors(base.expected, tol, base.inst);

        // Clean take: A or S, nothing missed, nothing extra.
        const clean = await runTake(base, {});
        const cleanBad = clean.alignment.judgments.filter((j) => j.status !== 'matched' || j.timing !== 'on-time' || !RIGHT_PITCH.has(j.pitch ?? ''));
        const cleanMsg = `clean ${instrumentId} ${excerptId} @${base.bpm}: score ${clean.score.score} ${clean.score.grade}, P/I/R ${JSON.stringify(clean.score.components)}, extras ${clean.alignment.extras.length}, bad ${cleanBad.map(describeJ).join('; ')}`;
        expect(['A', 'S'], cleanMsg).toContain(clean.score.grade);
        expect(cleanBad, cleanMsg).toEqual([]);
        expect(clean.alignment.extras, cleanMsg).toEqual([]);

        // Error take: the three injected notes and nothing else.
        const spec: PerformSpec = {
          mods: {
            [inj.late]: { shiftMs: inj.lateShiftMs, durMs: Math.max(150, base.expected[inj.late]!.durSec * 0.92 * MS - inj.lateShiftMs) },
            [inj.wrong]: { semis: inj.wrongSemis },
            [inj.flat]: { cents: inj.flatCents },
          },
        };
        const err = await runTake(base, spec);
        const fin = new Map(err.alignment.judgments.map((j) => [j.expectedIdx, j]));
        const liveJ = liveSubject(err.live, base.expected.length).judgments;
        const msg = `errors ${instrumentId} ${excerptId} @${base.bpm} (late #${inj.late} +${inj.lateShiftMs} ms, wrong #${inj.wrong} ${inj.wrongSemis > 0 ? '+' : ''}${inj.wrongSemis}, flat #${inj.flat} ${inj.flatCents} c): ` +
          `final late ${describeJ(fin.get(inj.late))}, wrong ${describeJ(fin.get(inj.wrong))}, flat ${describeJ(fin.get(inj.flat))}; ` +
          `live late ${describeJ(liveJ[inj.late])}, wrong ${describeJ(liveJ[inj.wrong])}, flat ${describeJ(liveJ[inj.flat])}; ` +
          `score ${err.score.score} ${err.score.grade}, extras ${err.alignment.extras.length}`;

        console.warn(`${cleanMsg}\n${msg}`);
        const late = fin.get(inj.late)!;
        expect(late.status, msg).toBe('matched');
        expect(late.timing, msg).toBe('late');
        expect(RIGHT_PITCH.has(late.pitch ?? ''), msg).toBe(true);
        const wrong = fin.get(inj.wrong)!;
        expect(wrong.status, msg).toBe('matched');
        expect(wrong.pitch, msg).toBe('wrong-pitch');
        expect(wrong.timing, msg).toBe('on-time');
        const flat = fin.get(inj.flat)!;
        expect(flat.status, msg).toBe('matched');
        expect(flat.pitch, msg).toBe('flat');
        expect(flat.timing, msg).toBe('on-time');
        // PLAN ruling 43: a take with a wrong-pitch note never earns an S, whatever its score.
        expect(err.score.grade, msg).not.toBe('S');

        // Live: the same verdicts reach the overlay during the take.
        const lv = (i: number): LiveJudgment => liveJ[i] as LiveJudgment;
        expect(lv(inj.late)?.timing, msg).toBe('late');
        expect(lv(inj.wrong)?.pitch, msg).toBe('wrong-pitch');
        expect(lv(inj.flat)?.pitch, msg).toBe('flat');

        // Nothing else is red, missed or extra.
        const others = err.alignment.judgments.filter((j) => ![inj.late, inj.wrong, inj.flat].includes(j.expectedIdx));
        const otherBad = others.filter((j) => j.status !== 'matched' || j.timing !== 'on-time' || !RIGHT_PITCH.has(j.pitch ?? ''));
        expect(otherBad.map(describeJ), msg).toEqual([]);
        expect(err.alignment.extras, msg).toEqual([]);
        expect(err.score.score as number, msg).toBeLessThan(clean.score.score as number);
      }, 60_000);
    }
  }
});
