/**
 * Ship gate of the metronome sounds (06 section 9.5, 08 decision 6), outside src/dsp and through its public API:
 * Classic, Woodblock and Beep bleed at -20 and -10 dB into the launch timbres' takes on speakers, with the sound's
 * own low-band template from a simulated loopback calibration, and the onset detector must keep F1 >= 0.97 (clean
 * capture; under the phone mic not below the no-bleed reference) with zero click-induced extras. Classic, the
 * default, must pass; the verdict for every sound is `SOUND_ON_SPEAKERS` in src/core/click-sounds.ts, checked (or
 * written, with CLICK_GATE_WRITE=1) by the last test: a sound that fails is offered in headphone modes only. The method is that
 * of src/dsp/click.test.ts (P4d), which keeps gating Tick and Wood; this file does not change it.
 *
 * Bleed is rendered by the testkit with the metronome's own samples (src/core/click-sounds.ts) as the metronome
 * plays them on speakers (`Metronome.setOutputMode`): every beat is the offbeat recipe, downbeats at +5 dB (the
 * metronome's default accent is +3 dB, so this is the harder case). The accent recipe is for headphone modes only:
 * with it on speakers every sound fails this gate (a body below 3 kHz the plain-click template cannot remove).
 * The template is built as calibration builds it (`clickTemplateLengthSec`, offbeat recipe, `buildClickTemplate`).
 *
 * Also here, because they measure with the capture worklet's hi-band filter (`HiBandEnergy`): the Tick layer of each
 * sound against today's Tick above 5 kHz in the first 5 ms.
 * Set CLICK_FULL=1 for 8 scenarios per timbre.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLICK_RECIPES, METRONOME_SOUNDS, renderClick, renderRecipe, SOUND_ON_SPEAKERS } from '../../../core/click-sounds.ts';
import type { ClockSeconds, DetectedNote, DspConfig, DspEvent, MetronomeSound } from '../../../core/types.ts';
import { clickTemplateLengthSec } from '../../../calibration/loopback.ts';
import { buildClickTemplate } from '../../../dsp/click.ts';
import { PhaseDecimator } from '../../../dsp/decimator.ts';
import { HiBandEnergy } from '../../../dsp/hiband.ts';
import { runOffline } from '../../../dsp/pipeline.ts';
import { createScenarioSet, scenarioConfigs, type ScenarioRender } from '../../../testkit/scenarios/index.ts';
import { applyConditions, type CaptureConditions } from '../../../testkit/synth/conditions.ts';
import type { SynthRender } from '../../../testkit/synth/index.ts';
import { TIMBRE_IDS } from '../../../testkit/synth/timbres.ts';

const cfgs = scenarioConfigs();
const RATE = 16000;
const SR = 48000;

function dspConfig(instrumentId: string, o: Partial<DspConfig> = {}): DspConfig {
  const inst = cfgs.instrumentById[instrumentId];
  if (!inst) throw new Error(`no instrument ${instrumentId}`);
  const d = inst.detection;
  return {
    analysisRate: RATE,
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
    attackExcludeMs: cfgs.grading.intonation.attackExcludeMsByFamily[inst.family],
    clickLeakDb: null,
    ...o,
  };
}

const onsetsOf = (ev: DspEvent[]): DetectedNote[] => ev.flatMap((e) => (e.type === 'note-on' ? [e.note] : []));

function decimate(samples: Float32Array, inputRate: number): Float32Array {
  const dec = new PhaseDecimator(inputRate);
  const low = new Float32Array(Math.ceil(samples.length / dec.factor) + 4);
  const n = dec.process(samples, low, 0);
  return low.slice(0, n);
}

const silence = (sec: number, levelDb: number): SynthRender => ({
  samples: new Float32Array(Math.round(sec * SR)),
  sampleRate: SR,
  truth: [],
  envelope: { startT: 0, hopSec: 0.002, values: [] },
  floorDb: -120,
  levelDb,
  pitchAt: () => null,
});

/** The loopback calibration's template in the take's conditions: 8 plain (offbeat recipe) clicks, averaged. */
function calibrationTemplate(cond: CaptureConditions, sound: MetronomeSound, bleedDb: number): Float32Array {
  const clicks = Array.from({ length: 8 }, (_, k) => ({ t: 0.5 + 0.5 * k, accent: false }));
  const cap = applyConditions(silence(5, -18), { ...cond, noiseDbfs: null, agc: null, clickBleed: { clicks, timbre: sound, bleedDb } });
  const low = decimate(cap.samples, cap.sampleRate);
  return buildClickTemplate(low, 0, RATE, clicks.map((c) => ({ arrival: c.t, accent: false })), { lengthSec: clickTemplateLengthSec(sound) });
}

/**
 * The capture of a take with speaker bleed of `sound`: the no-bleed render plus the click-only capture in the same
 * (linear: no room, AGC or noise) conditions, plain beats at `bleedDb`, downbeats the same recipe 5 dB louder.
 */
function withSpeakerBleed(r0: ScenarioRender, cond: CaptureConditions, sound: MetronomeSound, bleedDb: number): Float32Array {
  const len = r0.samples.length / r0.sampleRate;
  const only = (clicks: { t: number }[], db: number): Float32Array =>
    clicks.length === 0
      ? new Float32Array(r0.samples.length)
      : applyConditions(silence(len, -18), { ...cond, clickBleed: { clicks: clicks.map((c) => ({ t: c.t, accent: false })), timbre: sound, bleedDb: db } }).samples;
  const plain = only(r0.clicks.filter((c) => !c.accent), bleedDb);
  const acc = only(r0.clicks.filter((c) => c.accent), bleedDb + 5);
  const out = new Float32Array(r0.samples.length);
  for (let i = 0; i < out.length; i++) out[i] = (r0.samples[i] as number) + (plain[i] ?? 0) + (acc[i] ?? 0);
  return out;
}

// ------------------------------------------------------------------------------------- hi band

/** Hi-band energy (5 kHz 4th-order high-pass, 1 ms blocks, as the capture worklet) of the first 5 ms, dB. */
function hiBandFirst5msDb(x: Float32Array, rate: number): number {
  const h = new HiBandEnergy(rate);
  const pad = new Float32Array(x.length + rate / 100);
  pad.set(x);
  const out = new Float32Array(h.maxSubBlocks(pad.length));
  h.process(pad, out, 0);
  let s = 0;
  for (let k = 0; k < 5; k++) s += out[k] as number;
  return 10 * Math.log10(s);
}

describe('Tick layer of every sound (06 section 9.1 item 2)', () => {
  for (const rate of [48000, 44100]) {
    const tickDb = hiBandFirst5msDb(renderClick('tick', false, rate), rate);
    for (const sound of METRONOME_SOUNDS) {
      for (const accent of [false, true]) {
        it(`${sound} ${accent ? 'accent' : 'offbeat'} at ${rate} Hz: Tick-layer energy above 5 kHz in the first 5 ms within 1 dB of today's Tick`, () => {
          const r = accent ? CLICK_RECIPES[sound].accent : CLICK_RECIPES[sound].offbeat;
          const t = r.layers[0];
          if (t?.kind !== 'tick') throw new Error('no tick layer');
          // The layer as the recipe renders it (its own decay length, peak-normalised), against the Tick.
          const layerDb = hiBandFirst5msDb(renderRecipe({ lengthSec: r.lengthSec, layers: [t] }, rate), rate);
          expect(Math.abs(layerDb - tickDb)).toBeLessThanOrEqual(1);
          // In the mixed, peak-normalised sound the layer sits at its gain under the body: report the whole sound's
          // hi-band level against Tick at the same click volume (what the arrival finder gets). Pinned so a recipe
          // change that thins the hi band further is noticed.
          const soundDb = hiBandFirst5msDb(renderClick(sound, accent, rate), rate) - tickDb;
          process.stdout.write(`hi band ${sound} ${accent ? 'accent' : 'offbeat'} ${rate}: layer ${(layerDb - tickDb).toFixed(2)} dB, whole sound ${soundDb.toFixed(2)} dB vs Tick\n`);
          expect(soundDb).toBeGreaterThan(-11);
        });
      }
    }
  }
});

// ------------------------------------------------------------------------------------- bleed gate

const PER_TIMBRE = process.env.CLICK_FULL ? 8 : 2;
const TOL_SEC = 0.03;
const CAPTURES = {
  clean: { phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null },
  phone: { phoneMic: { highPassHz: 150 }, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null },
} as const;
type CaptureId = keyof typeof CAPTURES;
const BLEEDS = METRONOME_SOUNDS.flatMap((sound) => [-20, -10].map((bleedDb) => ({ sound, bleedDb })));
const bleedKey = (b: (typeof BLEEDS)[number]): string => `${b.sound}${b.bleedDb}`;

interface Score {
  tp: number;
  fp: number;
  fn: number;
  extras: number[];
}

function scoreOnsets(r: ScenarioRender, det: DetectedNote[]): Score {
  const required = r.truth.filter((t) => t.detectable).sort((a, b) => a.onsetSec - b.onsetSec);
  const optional = r.truth.filter((t) => !t.detectable);
  const used = new Set<number>();
  let tp = 0;
  let fn = 0;
  for (const t of required) {
    let best = -1;
    let bd = Infinity;
    det.forEach((n, j) => {
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
    } else fn++;
  }
  const extras: number[] = [];
  det.forEach((n, j) => {
    if (used.has(j) || optional.some((t) => Math.abs(t.onsetSec - n.onset) <= TOL_SEC)) return;
    extras.push(n.onset);
  });
  return { tp, fp: extras.length, fn, extras };
}

interface Tally {
  tp: number;
  fp: number;
  fn: number;
  /** Extras with no extra of the no-bleed reference within 30 ms: caused by the click. */
  clickExtras: number;
}
const f1 = (t: { tp: number; fp: number; fn: number }): number => (2 * t.tp) / Math.max(1, 2 * t.tp + t.fp + t.fn);
const newTally = (): Tally => ({ tp: 0, fp: 0, fn: 0, clickExtras: 0 });

function runTimbre(capture: CaptureId, ti: number): { ref: Tally; byBleed: Map<string, Tally> } {
  const set = createScenarioSet();
  const cap = CAPTURES[capture];
  const ref = newTally();
  const byBleed = new Map<string, Tally>();
  for (let k = 0; k < PER_TIMBRE; k++) {
    const idx = ti + 9 * k;
    const r0 = set.render(idx, { click: { bleedDb: null }, capture: cap });
    const inst = r0.plan.base.instrumentId;
    const s0 = scoreOnsets(r0, onsetsOf(runOffline(r0.samples, r0.sampleRate, dspConfig(inst)).events));
    ref.tp += s0.tp;
    ref.fp += s0.fp;
    ref.fn += s0.fn;
    for (const b of BLEEDS) {
      const samples = withSpeakerBleed(r0, cap, b.sound, b.bleedDb);
      const cfg = dspConfig(inst, {
        outputMode: 'speakers',
        clicks: r0.clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: c.accent })),
        clickTemplate: calibrationTemplate(cap, b.sound, b.bleedDb),
      });
      const s = scoreOnsets(r0, onsetsOf(runOffline(samples, r0.sampleRate, cfg).events));
      const key = bleedKey(b);
      const t = byBleed.get(key) ?? newTally();
      t.tp += s.tp;
      t.fp += s.fp;
      t.fn += s.fn;
      t.clickExtras += s.extras.filter((x) => !s0.extras.some((y) => Math.abs(x - y) <= TOL_SEC)).length;
      byBleed.set(key, t);
    }
  }
  return { ref, byBleed };
}

const LAUNCH = TIMBRE_IDS.slice(0, 8).map((timbre, i) => ({ timbre, i }));

/** results[capture][timbre]: the no-bleed reference and the tally per bleed condition. */
const results = new Map<string, { ref: Tally; byBleed: Map<string, Tally> }>();
const passes = (capture: CaptureId, ref: Tally, t: Tally): boolean =>
  t.clickExtras === 0 && (capture === 'clean' ? f1(t) >= 0.97 : f1(t) >= f1(ref) - 1e-9);

describe('metronome sound bleed gate (06 section 9.5)', () => {
  for (const capture of Object.keys(CAPTURES) as CaptureId[]) {
    it.each(LAUNCH)(`${capture} $timbre: sounds on speakers at -20/-10 dB: zero click extras, F1 >= 0.97`, ({ timbre, i }) => {
      const res = runTimbre(capture, i);
      results.set(`${capture} ${timbre}`, res);
      const { ref, byBleed } = res;
      const parts = [`no bleed F1 ${f1(ref).toFixed(4)}`];
      for (const b of BLEEDS) {
        const t = byBleed.get(bleedKey(b)) as Tally;
        parts.push(`${bleedKey(b)}: F1 ${f1(t).toFixed(4)} (fp ${t.fp}, fn ${t.fn}), click extras ${t.clickExtras}`);
      }
      process.stdout.write(`sound gate ${capture} ${timbre}: ${parts.join('; ')}\n`);
      // Classic always; the others when the gate lets them on speakers.
      for (const b of BLEEDS.filter((x) => x.sound === 'classic' || SOUND_ON_SPEAKERS[x.sound])) {
        const t = byBleed.get(bleedKey(b)) as Tally;
        expect(t.clickExtras, bleedKey(b)).toBe(0);
        if (capture === 'clean') expect(f1(t), bleedKey(b)).toBeGreaterThanOrEqual(0.97);
        else expect(f1(t), bleedKey(b)).toBeGreaterThanOrEqual(f1(ref) - 1e-9);
      }
    }, 600_000);
  }

  it('sets SOUND_ON_SPEAKERS from the measurement', () => {
    const verdict: Record<MetronomeSound, boolean> = { classic: true, woodblock: true, beep: true };
    const lines: string[] = [];
    for (const capture of Object.keys(CAPTURES) as CaptureId[]) {
      for (const { timbre } of LAUNCH) {
        const res = results.get(`${capture} ${timbre}`);
        if (!res) throw new Error(`run the gate tests first (${capture} ${timbre} missing)`);
        for (const b of BLEEDS) {
          const t = res.byBleed.get(bleedKey(b)) as Tally;
          if (!passes(capture, res.ref, t)) {
            verdict[b.sound] = false;
            lines.push(`${capture} ${timbre} ${bleedKey(b)}: F1 ${f1(t).toFixed(4)}, click extras ${t.clickExtras}`);
          }
        }
      }
    }
    process.stdout.write(`sound gate verdict: ${JSON.stringify(verdict)}${lines.length ? ` (${lines.join('; ')})` : ''}\n`);
    if (process.env.CLICK_GATE_WRITE) {
      const file = fileURLToPath(new URL('../../../core/click-sounds.ts', import.meta.url));
      const src = readFileSync(file, 'utf8');
      const line = `export const SOUND_ON_SPEAKERS: Readonly<Record<MetronomeSound, boolean>> = { classic: ${verdict.classic}, woodblock: ${verdict.woodblock}, beep: ${verdict.beep} };`;
      writeFileSync(file, src.replace(/^export const SOUND_ON_SPEAKERS: .*$/m, line));
      return;
    }
    expect(SOUND_ON_SPEAKERS, 'src/core/click-sounds.ts SOUND_ON_SPEAKERS is stale: rerun with CLICK_GATE_WRITE=1').toEqual(verdict);
  });
});
