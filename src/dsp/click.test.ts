/**
 * P4d acceptance (01 section 15): Tick at -20 and -10 dB bleed gives zero click extras and onset F1 >= 0.97; the
 * on-beat onset bias against no bleed is under 3 ms; the Wood gate flag is set automatically; everything is off in
 * headphone modes. Plus unit checks of template subtraction (7.6 item 2), the time gate (item 3) and the leak floor
 * (item 5).
 *
 * The suite renders `PER_TIMBRE` corpus scenarios per launch timbre from `createScenarioSet` under two capture
 * conditions: clean (as the P4c F1 gate) and phone mic (2nd-order 150 Hz high-pass, 7 kHz low-pass; 13.2 states its
 * gates under click bleed and the phone mic). Room, AGC, noise and lower capture rates are off so that the numbers
 * isolate the click. Each scenario runs once without bleed in a headphone mode (the reference) and once per bleed
 * condition on speakers, with a per-device template from a simulated loopback calibration in the same conditions.
 * Set CLICK_FULL=1 for 8 scenarios per timbre.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, DetectedNote, DspConfig, DspEvent, TestkitTimbre } from '../core/types.ts';
import { createScenarioSet, scenarioConfigs, type ScenarioRender } from '../testkit/scenarios/index.ts';
import { renderPerformance, type SynthRender } from '../testkit/synth/index.ts';
import { applyConditions, type CaptureConditions } from '../testkit/synth/conditions.ts';
import { TIMBRE_IDS } from '../testkit/synth/timbres.ts';
import { WOOD_ON_SPEAKERS } from './click-gate.ts';
import {
  CLICK_ACCENT_GAIN,
  CLICK_ALIGN_SEC,
  CLICK_GAIN_MAX,
  CLICK_TEMPLATE_PRE_SEC,
  CLICK_TEMPLATE_SEC,
  ClickSubtractor,
  buildClickTemplate,
  clickHandlingActive,
} from './click.ts';
import { PhaseDecimator } from './decimator.ts';
import { DspPipeline, runOffline } from './pipeline.ts';
import { Segmenter, segmenterOptions } from './segmenter.ts';

const cfgs = scenarioConfigs();
const RATE = 16000;

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

const silence = (sec: number, levelDb: number): SynthRender => {
  const sr = 48000;
  return {
    samples: new Float32Array(Math.round(sec * sr)),
    sampleRate: sr,
    truth: [],
    envelope: { startT: 0, hopSec: 0.002, values: [] },
    floorDb: -120,
    levelDb,
    pitchAt: () => null,
  };
};

/**
 * A loopback calibration in the take's conditions (no instrument): 8 clicks, every other one accented, averaged
 * into a low-band template with buildClickTemplate. Noise and AGC are left out (calibration averages them away).
 */
function calibrationTemplate(cond: CaptureConditions, timbre: 'tick' | 'wood', bleedDb: number, levelDb = -18): Float32Array {
  const clicks = Array.from({ length: 8 }, (_, k) => ({ t: 0.5 + 0.5 * k, accent: k % 2 === 0 }));
  const cap = applyConditions(silence(5, levelDb), { ...cond, noiseDbfs: null, agc: null, clickBleed: { clicks, timbre, bleedDb } });
  const low = decimate(cap.samples, cap.sampleRate);
  return buildClickTemplate(low, 0, RATE, clicks.map((c) => ({ arrival: c.t, accent: c.accent })));
}

const energyDb = (x: ArrayLike<number>, a: number, b: number): number => {
  let s = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) s += (x[i] as number) ** 2;
  return 10 * Math.log10(s + 1e-30);
};

// ------------------------------------------------------------------------------------- template subtraction

describe('ClickSubtractor (01 section 7.6 item 2)', () => {
  const wood = (cond: CaptureConditions = {}): { low: Float32Array; clicks: { t: number; accent: boolean }[] } => {
    // Arrivals off the 48 kHz grid by a fraction of a 16 kHz sample, as click.t + RTL is in practice.
    const clicks = Array.from({ length: 6 }, (_, k) => ({ t: 0.4 + 0.5 * k + (k * 0.37) / 48000, accent: k === 0 }));
    const cap = applyConditions(silence(3.4, -18), { ...cond, clickBleed: { clicks, timbre: 'wood', bleedDb: -10 } });
    return { low: decimate(cap.samples, 48000), clicks };
  };

  it('removes Wood clicks alone to at least 30 dB below the click, at fractional arrivals', () => {
    const tpl = calibrationTemplate({}, 'wood', -10);
    expect(tpl.length).toBe(Math.round(CLICK_TEMPLATE_SEC * RATE));
    const { low, clicks } = wood();
    const sub = new ClickSubtractor(tpl, clicks.map((c) => ({ arrival: c.t, accent: c.accent })), RATE, 0, { leakWindowSec: 0.064 });
    const out = new Float32Array(low.length);
    let w = 0;
    for (let i = 0; i < low.length; i += 85) {
      const r = sub.push(low.subarray(i, Math.min(low.length, i + 85)));
      out.set(r, w);
      w += r.length;
    }
    const r = sub.flush();
    out.set(r, w);
    w += r.length;
    expect(w).toBe(low.length);
    expect(sub.fits).toHaveLength(clicks.length);
    const atten: number[] = [];
    for (const c of clicks) {
      const a = Math.round((c.t - 0.004) * RATE);
      const b = Math.round((c.t + 0.03) * RATE);
      atten.push(energyDb(low, a, b) - energyDb(out, a, b));
    }
    process.stdout.write(`P4d Wood alone: attenuation ${atten.map((x) => x.toFixed(1)).join(', ')} dB\n`);
    for (const x of atten) expect(x).toBeGreaterThan(30);
    sub.fits.forEach((f, k) => {
      expect(Math.abs(f.shiftSec)).toBeLessThanOrEqual(CLICK_ALIGN_SEC + 1e-9);
      expect(f.gain).toBeCloseTo(k === 0 ? CLICK_ACCENT_GAIN : 1, 1);
    });
  });

  it('finds a click 0.6 ms off its nominal arrival (RTL error) within the +-1 ms search', () => {
    const tpl = calibrationTemplate({}, 'wood', -10);
    const { low, clicks } = wood();
    const nominal = clicks.map((c) => ({ arrival: c.t - 0.0006, accent: c.accent }));
    const sub = new ClickSubtractor(tpl, nominal, RATE, 0, { leakWindowSec: 0.064 });
    const out = Float32Array.from([...sub.push(low), ...sub.flush()]);
    for (const f of sub.fits) expect(f.shiftSec).toBeCloseTo(0.0006, 4);
    for (const c of clicks) {
      const a = Math.round((c.t - 0.004) * RATE);
      const b = Math.round((c.t + 0.03) * RATE);
      expect(energyDb(low, a, b) - energyDb(out, a, b)).toBeGreaterThan(25);
    }
  });

  it('leaves a residual 15 dB or more below the click under a sounding note (phone mic)', () => {
    const cond: CaptureConditions = { phoneMic: { highPassHz: 150 } };
    const tpl = calibrationTemplate(cond, 'wood', -10);
    // Two count-in clicks before the note (the subtractor learns lag and level from clicks that stand out), then
    // five under it, 18 to 23 dB below the music in their windows.
    const clicks = [0.1, 0.35, 0.6, 1.1, 1.6, 2.1, 2.6].map((t, k) => ({ t, accent: k % 4 === 0 }));
    for (const [timbre, midi] of [['clarinet', 62], ['flute', 76], ['cello', 48], ['voice', 60]] as const) {
      const dry = renderPerformance({ timbre, sampleRate: 48000, notes: [{ midi, onsetSec: 0.4, durSec: 2.8 }], vibrato: null, durationSec: 3.4 });
      const music = decimate(applyConditions(dry, cond).samples, 48000);
      const both = decimate(applyConditions(dry, { ...cond, clickBleed: { clicks, timbre: 'wood', bleedDb: -10 } }).samples, 48000);
      const sub = new ClickSubtractor(tpl, clicks.map((c) => ({ arrival: c.t, accent: c.accent })), RATE, 0, { leakWindowSec: 0.064 });
      const out = Float32Array.from([...sub.push(both), ...sub.flush()]);
      expect(sub.fits.slice(0, 2).every((f) => f.confident)).toBe(true);
      const res: number[] = [];
      for (const c of clicks.slice(2)) {
        const a = Math.round((c.t - 0.004) * RATE);
        const b = Math.round((c.t + 0.03) * RATE);
        const click = new Float64Array(b - a);
        const left = new Float64Array(b - a);
        for (let i = a; i < b; i++) {
          click[i - a] = (both[i] as number) - (music[i] as number);
          left[i - a] = (out[i] as number) - (music[i] as number);
        }
        res.push(energyDb(click, 0, click.length) - energyDb(left, 0, left.length));
      }
      process.stdout.write(`P4d Wood -10 dB under ${timbre}: residual ${res.map((x) => x.toFixed(1)).join(', ')} dB below the click\n`);
      for (const x of res) expect(x).toBeGreaterThan(15);
    }
  });

  it('limits the gain, so a Tick template far below the music never eats the note', () => {
    const tpl = calibrationTemplate({}, 'tick', -10);
    const dry = renderPerformance({ timbre: 'trumpet', sampleRate: 48000, notes: [{ midi: 67, onsetSec: 0.2, durSec: 1.6 }], durationSec: 2 });
    const clicks = [0.5, 1.0, 1.5].map((t) => ({ t, accent: false }));
    const both = decimate(applyConditions(dry, { clickBleed: { clicks, timbre: 'tick', bleedDb: -10 } }).samples, 48000);
    const sub = new ClickSubtractor(tpl, clicks.map((c) => ({ arrival: c.t, accent: c.accent })), RATE, 0, { leakWindowSec: 0.064 });
    const out = Float32Array.from([...sub.push(both), ...sub.flush()]);
    for (const f of sub.fits) expect(f.gain).toBeLessThanOrEqual(CLICK_GAIN_MAX);
    let maxDiff = 0;
    for (let i = 0; i < out.length; i++) maxDiff = Math.max(maxDiff, Math.abs((out[i] as number) - (both[i] as number)));
    // Tick leaks about -73 dBFS into the low band at -10 dB bleed; twice that is still nothing next to the note.
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it('releases the same stream for any block size and holds back only audio near a click (<= 24 ms)', () => {
    const tpl = calibrationTemplate({}, 'wood', -10);
    const { low, clicks } = wood();
    const arr = clicks.map((c) => ({ arrival: c.t, accent: c.accent }));
    const run = (block: number): { out: Float32Array; maxHeld: number } => {
      const sub = new ClickSubtractor(tpl, arr, RATE, 0, { leakWindowSec: 0.064 });
      const out: number[] = [];
      let maxHeld = 0;
      for (let i = 0; i < low.length; i += block) {
        const n = Math.min(block, low.length - i);
        out.push(...sub.push(low.subarray(i, i + n)));
        maxHeld = Math.max(maxHeld, i + n - sub.released);
      }
      out.push(...sub.flush());
      return { out: Float32Array.from(out), maxHeld };
    };
    const a = run(1);
    const b = run(85);
    const c = run(4000);
    expect(b.out).toEqual(a.out);
    expect(c.out).toEqual(a.out);
    expect(a.maxHeld / RATE).toBeLessThanOrEqual(0.024);
    // Far from clicks nothing is held: after a push ending 100 ms past a click, everything is out.
    const sub = new ClickSubtractor(tpl, arr, RATE, 0, { leakWindowSec: 0.064 });
    const upto = Math.round(0.5 * RATE);
    sub.push(low.subarray(0, upto));
    expect(sub.released).toBe(upto);
  });

  it('skips clicks whose template would start before the stream', () => {
    const tpl = calibrationTemplate({}, 'wood', -10);
    const sub = new ClickSubtractor(tpl, [{ arrival: 0.001, accent: false }, { arrival: 0.5, accent: false }], RATE, 0, { leakWindowSec: 0.064 });
    sub.push(new Float32Array(RATE));
    sub.flush();
    expect(sub.fits.map((f) => f.arrival)).toEqual([0.5]);
  });
});

describe('buildClickTemplate', () => {
  it('recovers the received click from fractional arrivals, sample 0 at arrival - pre-roll', () => {
    const a = calibrationTemplate({}, 'wood', -10);
    // The same click at other fractional positions gives the same template.
    const clicks = Array.from({ length: 8 }, (_, k) => ({ t: 0.5 + 0.5 * k + (k * 0.29) / 48000, accent: k % 2 === 0 }));
    const cap = applyConditions(silence(5, -18), { clickBleed: { clicks, timbre: 'wood', bleedDb: -10 } });
    const b = buildClickTemplate(decimate(cap.samples, 48000), 0, RATE, clicks.map((c) => ({ arrival: c.t, accent: c.accent })));
    let num = 0;
    let den = 0;
    for (let i = 0; i < a.length; i++) {
      num += ((a[i] as number) - (b[i] as number)) ** 2;
      den += (a[i] as number) ** 2;
    }
    expect(10 * Math.log10(num / den)).toBeLessThan(-30);
    // Nothing before the arrival but the filters' pre-ringing.
    const pre = Math.round(CLICK_TEMPLATE_PRE_SEC * RATE);
    expect(energyDb(a, 0, pre - 8) - energyDb(a, 0, a.length)).toBeLessThan(-30);
  });
});

// ------------------------------------------------------------------------------------- modes and hooks

describe('click handling is off in headphone modes', () => {
  it('wired and bluetooth ignore clicks and template: identical to a take without them', () => {
    expect(clickHandlingActive('speakers')).toBe(true);
    expect(clickHandlingActive('wired')).toBe(false);
    expect(clickHandlingActive('bluetooth')).toBe(false);
    const set = createScenarioSet();
    const r = set.render(1, { click: { timbre: 'wood', bleedDb: -10 }, capture: { phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null } });
    const clicks = r.clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: c.accent }));
    const tpl = calibrationTemplate({}, 'wood', -10);
    const plain = runOffline(r.samples, r.sampleRate, dspConfig(r.plan.base.instrumentId));
    for (const outputMode of ['wired', 'bluetooth'] as const) {
      const cfg = dspConfig(r.plan.base.instrumentId, { outputMode, clicks, clickTemplate: tpl });
      const got = runOffline(r.samples, r.sampleRate, cfg);
      expect(got.events).toEqual(plain.events);
      expect(got.frames.some((f) => f.inClickWindow)).toBe(false);
      expect(new DspPipeline(cfg).clickFits()).toEqual([]);
    }
    // On speakers the same take is subtracted and gated.
    const spk = new DspPipeline(dspConfig(r.plan.base.instrumentId, { outputMode: 'speakers', clicks, clickTemplate: tpl }));
    const dec = new PhaseDecimator(r.sampleRate);
    const low = new Float32Array(Math.ceil(r.samples.length / dec.factor) + 4);
    const n = dec.process(r.samples, low, 0);
    spk.push({ v: 1, startT: 0 as ClockSeconds, lowband: low.slice(0, n), hiEnergy: new Float32Array(0), analysisRate: RATE, seq: 0 });
    spk.flush((r.samples.length / r.sampleRate) as ClockSeconds);
    expect(spk.clickFits().length).toBe(clicks.filter((c) => c.arrival > 0.01 && c.arrival < r.samples.length / r.sampleRate - 0.03).length);
    expect(spk.frames().some((f) => f.inClickWindow)).toBe(true);
  });

  it('does not depend on the block size on speakers with a template', () => {
    const set = createScenarioSet();
    const r = set.render(2, { click: { timbre: 'wood', bleedDb: -10 }, capture: { phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null } });
    const cfg = dspConfig(r.plan.base.instrumentId, {
      outputMode: 'speakers',
      clicks: r.clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: c.accent })),
      clickTemplate: calibrationTemplate({}, 'wood', -10),
    });
    const run = (frames: number): DetectedNote[] => {
      const dec = new PhaseDecimator(r.sampleRate);
      const p = new DspPipeline(cfg);
      const ev: DspEvent[] = [];
      const low = new Float32Array(frames);
      for (let i = 0, seq = 0; i < r.samples.length; i += frames) {
        const startT = dec.nextOutputInputPos / r.sampleRate;
        const k = dec.process(r.samples.subarray(i, Math.min(r.samples.length, i + frames)), low, 0);
        if (k === 0) continue;
        ev.push(...p.push({ v: 1, startT: startT as ClockSeconds, lowband: low.slice(0, k), hiEnergy: new Float32Array(0), analysisRate: RATE, seq: seq++ }));
      }
      ev.push(...p.flush((r.samples.length / r.sampleRate) as ClockSeconds));
      return ev.flatMap((e) => (e.type === 'note-off' ? [e.note] : []));
    };
    const a = run(128);
    const b = run(768);
    expect(b.length).toBe(a.length);
    // The subtractor's output does not depend on the block size (tested above). The P4c pipeline itself moves a
    // few pitch-change onsets by about 0.1 ms between block sizes even in headphone modes (the analyser's block
    // stamps), so this holds to 0.5 ms here rather than to 1e-9.
    a.forEach((n, i) => {
      expect(Math.abs((b[i]?.onset as number) - n.onset)).toBeLessThan(0.0005);
      expect(Math.round(b[i]?.midi as number)).toBe(Math.round(n.midi));
    });
  });
});

describe('time gate and leak floor in click windows (01 section 7.6 items 3 and 5)', () => {
  const opts = segmenterOptions(0.008, { windowSec: 0.064, clarityThreshold: 0.85, changeCents: 60, onsetProfile: 'tongued-wind' });
  const frames = (seg: Segmenter, from: number, to: number, rmsDb: number): DspEvent[] => {
    const out: DspEvent[] = [];
    for (let t = from; t < to; t += 0.008) {
      out.push(...seg.pushFrame({ t, midi: 62, raw: 62, clarity: 0.95, rmsDb, alt: null, inClick: seg.inClickWindow(t) }));
    }
    return out;
  };

  it('a frame inside a click window starts a note only above the leak level + 6 dB', () => {
    const run = (leakFrameDb: number | null): DspEvent[] => {
      const seg = new Segmenter(opts, [], [1.0]);
      seg.startEnvelope(0.001, 0.002, 0, RATE);
      if (leakFrameDb !== null) seg.setClickLeak(1.0, leakFrameDb + 10, leakFrameDb);
      return frames(seg, 0.996, 1.03, -40);
    };
    // Gate at -70 dBFS (no noise measured); frames at -40 dBFS.
    expect(run(null).filter((e) => e.type === 'note-on')).toHaveLength(1);
    expect(run(-50).filter((e) => e.type === 'note-on')).toHaveLength(1);
    expect(run(-44).filter((e) => e.type === 'note-on')).toHaveLength(0);
    // Outside the window the leak level does not apply.
    const seg = new Segmenter(opts, [], [1.0]);
    seg.startEnvelope(0.001, 0.002, 0, RATE);
    seg.setClickLeak(1.0, -34, -44);
    expect(frames(seg, 1.05, 1.09, -40).filter((e) => e.type === 'note-on')).toHaveLength(1);
  });

  it('an on-beat tongued repeat still splits (pitch evidence), within 5 ms of the 7.4 onset', () => {
    // Repeats on the clicks: the gate waits for 3 voiced frames, which a real note supplies.
    const clicks = [0.7, 1.1, 1.5].map((t) => ({ t, accent: false }));
    for (const [timbre, inst, midi] of [['clarinet', 'clarinet-bb', 64], ['trumpet', 'trumpet-bb', 67], ['flute', 'flute', 76], ['violin', 'violin', 69]] as const) {
      const notes = [0, 1, 2, 3].map((k) => ({ midi, onsetSec: 0.3 + 0.4 * k, durSec: 0.4, dipDb: 6 }));
      const dry = renderPerformance({ timbre, sampleRate: 48000, notes, vibrato: null });
      const cap = applyConditions(dry, { clickBleed: { clicks, timbre: 'wood', bleedDb: -10 } });
      for (const tpl of [null, calibrationTemplate({}, 'wood', -10)]) {
        const cfg = dspConfig(inst, { outputMode: 'speakers', clicks: clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: false })), clickTemplate: tpl });
        const on = onsetsOf(runOffline(cap.samples, 48000, cfg).events);
        expect(on.map((n) => n.onset.toFixed(2)), `${timbre} template ${tpl !== null}`).toEqual(dry.truth.map((t) => t.onsetSec.toFixed(2)));
        on.forEach((n, k) => expect(Math.abs(n.onset - (dry.truth[k]?.onsetSec as number))).toBeLessThan(0.005));
      }
    }
  });

  it('early and late notes near a click keep their own onsets (no snapping to the click)', () => {
    const tpl = calibrationTemplate({}, 'wood', -10);
    for (const off of [-0.03, -0.015, 0.015, 0.03]) {
      const clicks = [0.5, 1.0, 1.5, 2.0].map((t) => ({ t, accent: false }));
      const notes = [0, 1, 2].map((k) => ({ midi: 62 + 2 * k, onsetSec: 0.5 * (k + 1) + off, durSec: 0.35 }));
      const dry = renderPerformance({ timbre: 'sax', sampleRate: 48000, notes, vibrato: null });
      const cap = applyConditions(dry, { clickBleed: { clicks, timbre: 'wood', bleedDb: -10 } });
      const cfg = dspConfig('sax-alto', { outputMode: 'speakers', clicks: clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: false })), clickTemplate: tpl });
      const on = onsetsOf(runOffline(cap.samples, 48000, cfg).events);
      expect(on).toHaveLength(3);
      on.forEach((n, k) => expect(Math.abs(n.onset - (dry.truth[k]?.onsetSec as number)), `offset ${off}`).toBeLessThan(0.003));
    }
  });
});

// ------------------------------------------------------------------------------------- acceptance

const PER_TIMBRE = process.env.CLICK_FULL ? 8 : 2;
const TOL_SEC = 0.03;
const CAPTURES = {
  clean: { phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null },
  phone: { phoneMic: { highPassHz: 150 }, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null },
} as const;
type CaptureId = keyof typeof CAPTURES;
const BLEEDS = [
  { timbre: 'tick', bleedDb: -20 },
  { timbre: 'tick', bleedDb: -10 },
  { timbre: 'wood', bleedDb: -20 },
  { timbre: 'wood', bleedDb: -10 },
] as const;

interface Score {
  tp: number;
  fp: number;
  fn: number;
  /** playedIdx -> detected onset of the match. */
  matched: Map<number, number>;
  /** Unmatched detections (not near an undetectable truth note). */
  extras: number[];
}

function scoreOnsets(r: ScenarioRender, det: DetectedNote[]): Score {
  const required = r.truth.filter((t) => t.detectable).sort((a, b) => a.onsetSec - b.onsetSec);
  const optional = r.truth.filter((t) => !t.detectable);
  const used = new Set<number>();
  const matched = new Map<number, number>();
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
      matched.set(t.playedIdx, (det[best] as DetectedNote).onset);
    } else fn++;
  }
  const extras: number[] = [];
  det.forEach((n, j) => {
    if (used.has(j) || optional.some((t) => Math.abs(t.onsetSec - n.onset) <= TOL_SEC)) return;
    extras.push(n.onset);
  });
  return { tp, fp: extras.length, fn, matched, extras };
}

interface Tally {
  tp: number;
  fp: number;
  fn: number;
  /** Extras with no extra of the no-bleed reference within 30 ms: caused by the click. */
  clickExtras: number;
  /** Detected onset with bleed minus without, ms, for matched notes within 20 ms of a click. */
  bias: number[];
}
const f1 = (t: { tp: number; fp: number; fn: number }): number => (2 * t.tp) / Math.max(1, 2 * t.tp + t.fp + t.fn);
const newTally = (): Tally => ({ tp: 0, fp: 0, fn: 0, clickExtras: 0, bias: [] });

/** results[capture][bleed key][timbre] and the no-bleed reference results[capture]['none'][timbre]. */
const results: Record<string, Record<string, Record<string, Tally>>> = {};
const bleedKey = (b: (typeof BLEEDS)[number]): string => `${b.timbre}${b.bleedDb}`;

function runTimbre(capture: CaptureId, timbre: TestkitTimbre, ti: number): void {
  const set = createScenarioSet();
  const cap = CAPTURES[capture];
  const byCap = (results[capture] ??= {});
  const ref = ((byCap['none'] ??= {})[timbre] = newTally());
  for (let k = 0; k < PER_TIMBRE; k++) {
    const idx = ti + 9 * k;
    const r0 = set.render(idx, { click: { bleedDb: null }, capture: cap });
    const inst = r0.plan.base.instrumentId;
    const s0 = scoreOnsets(r0, onsetsOf(runOffline(r0.samples, r0.sampleRate, dspConfig(inst)).events));
    ref.tp += s0.tp;
    ref.fp += s0.fp;
    ref.fn += s0.fn;
    for (const b of BLEEDS) {
      const r = set.render(idx, { click: { timbre: b.timbre, bleedDb: b.bleedDb }, capture: cap });
      const cfg = dspConfig(inst, {
        outputMode: 'speakers',
        clicks: r.clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: c.accent })),
        clickTemplate: calibrationTemplate(r.capture.conditions, b.timbre, b.bleedDb),
      });
      const s = scoreOnsets(r, onsetsOf(runOffline(r.samples, r.sampleRate, cfg).events));
      const t = ((byCap[bleedKey(b)] ??= {})[timbre] ??= newTally());
      t.tp += s.tp;
      t.fp += s.fp;
      t.fn += s.fn;
      t.clickExtras += s.extras.filter((x) => !s0.extras.some((y) => Math.abs(x - y) <= TOL_SEC)).length;
      for (const [pi, on] of s.matched) {
        const on0 = s0.matched.get(pi);
        const tr = r.truth[pi];
        if (on0 === undefined || !tr || !r.clicks.some((c) => Math.abs(c.t - tr.onsetSec) <= 0.02)) continue;
        t.bias.push((on - on0) * 1000);
      }
    }
  }
}

const LAUNCH = TIMBRE_IDS.slice(0, 8).map((timbre, i) => ({ timbre, i }));

function report(capture: CaptureId, timbre: string): void {
  const ref = results[capture]?.['none']?.[timbre] as Tally;
  const parts = [`no bleed F1 ${f1(ref).toFixed(4)}`];
  for (const b of BLEEDS) {
    const t = results[capture]?.[bleedKey(b)]?.[timbre] as Tally;
    const mean = t.bias.reduce((a, x) => a + x, 0) / Math.max(1, t.bias.length);
    const maxAbs = t.bias.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
    parts.push(`${bleedKey(b)}: F1 ${f1(t).toFixed(4)} (fp ${t.fp}, fn ${t.fn}), click extras ${t.clickExtras}, on-beat bias mean ${mean.toFixed(2)} ms max |${maxAbs.toFixed(2)}| ms (n ${t.bias.length})`);
  }
  process.stdout.write(`P4d ${capture} ${timbre}: ${parts.join('; ')}\n`);
}

describe('click bleed acceptance (P4d)', () => {
  for (const capture of Object.keys(CAPTURES) as CaptureId[]) {
    it.each(LAUNCH)(`${capture} $timbre: Tick -20/-10 dB: zero click extras, F1 >= 0.97, on-beat bias < 3 ms`, ({ timbre, i }) => {
      runTimbre(capture, timbre, i);
      report(capture, timbre);
      const ref = results[capture]?.['none']?.[timbre] as Tally;
      for (const b of BLEEDS.filter((x) => x.timbre === 'tick')) {
        const t = results[capture]?.[bleedKey(b)]?.[timbre] as Tally;
        expect(t.clickExtras, bleedKey(b)).toBe(0);
        // F1 >= 0.97 is P4c's clean-capture gate; under the phone mic the bleed may not lower the no-bleed F1.
        if (capture === 'clean') expect(f1(t), bleedKey(b)).toBeGreaterThanOrEqual(0.97);
        else expect(f1(t), bleedKey(b)).toBeGreaterThanOrEqual(f1(ref) - 1e-9);
        expect(t.bias.length).toBeGreaterThan(5);
        const mean = t.bias.reduce((a, x) => a + x, 0) / t.bias.length;
        expect(Math.abs(mean), bleedKey(b)).toBeLessThan(3);
      }
    }, 300_000);
  }

  it('sets the Wood gate flag from the measurement (01 section 7.6)', () => {
    let pass = true;
    const lines: string[] = [];
    for (const capture of Object.keys(CAPTURES) as CaptureId[]) {
      for (const { timbre } of LAUNCH) {
        const ref = results[capture]?.['none']?.[timbre];
        if (!ref) throw new Error(`run the acceptance tests first (${capture} ${timbre} missing)`);
        for (const b of BLEEDS.filter((x) => x.timbre === 'wood')) {
          const t = results[capture]?.[bleedKey(b)]?.[timbre] as Tally;
          const f = f1(t);
          // F1 >= 0.97 where the no-bleed reference reaches it (clean capture); not below the reference otherwise.
          const okF1 = capture === 'clean' ? f >= 0.97 : f >= f1(ref) - 1e-9;
          if (!okF1 || t.clickExtras > 0) {
            pass = false;
            lines.push(`${capture} ${timbre} ${bleedKey(b)}: F1 ${f.toFixed(4)}, click extras ${t.clickExtras}`);
          }
        }
      }
    }
    process.stdout.write(`P4d Wood gate: ${pass ? 'Wood allowed on speakers' : `Wood headphones only (${lines.join('; ')})`}\n`);
    if (process.env.CLICK_GATE_WRITE) {
      const file = fileURLToPath(new URL('./click-gate.ts', import.meta.url));
      const src = `/**
 * The Wood gate of 01 section 7.6, decided by CI and not by a person: the synthetic suite in click.test.ts runs
 * the launch timbres with Wood bleed at -20 and -10 dB through template subtraction, and Wood is offered on
 * speakers only if every run keeps onset F1 >= 0.97 with zero click-induced extras. Otherwise the settings offer
 * Wood in headphone modes only (04 section 5.11).
 *
 * Generated: click.test.ts fails when this value disagrees with the measurement. Regenerate with
 * \`CLICK_GATE_WRITE=1 pnpm vitest run src/dsp/click.test.ts\`.
 */
export const WOOD_ON_SPEAKERS: boolean = ${pass};
`;
      writeFileSync(file, src);
      return;
    }
    expect(WOOD_ON_SPEAKERS, 'src/dsp/click-gate.ts is stale: rerun with CLICK_GATE_WRITE=1').toBe(pass);
  });
});
