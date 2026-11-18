/**
 * DspPipeline and runOffline (01 section 5.6): the assembly that turns CaptureBlocks into pitch frames and note
 * events. Per block: gap check on `seq`, 2 ms envelope (EnvelopeFollower), band-limited spectral flux (flux.ts),
 * centre-stamped pitch frames (PitchAnalyzer), then the segmenter. A `signal` event goes out every 4 hops.
 *
 * Conventions
 * - `DspConfig.minHz` / `maxHz` are the instrument's detection range as in `instruments.json` (not widened); the
 *   pipeline widens it by 3 semitones (01 section 7.3) before building the PitchAnalyzer.
 * - Envelope value i is centred at `firstBlock.startT + (i + 0.5) * hop / analysisRate`; flux and pitch frames are
 *   stamped at their window centres. Blocks are assumed contiguous (a gap voids the take; it is reported as a
 *   `gap` event and analysis continues on the concatenated samples).
 * - Click handling (01 section 7.6, click.ts) runs only when `outputMode` is 'speakers'; in headphone modes
 *   `clicks` and `clickTemplate` are ignored and the pipeline is the plain P4c assembly. On speakers with a
 *   template, `ClickSubtractor` removes the fitted template from the low band before the envelope, flux and pitch
 *   analysis (item 2; audio near a click is held back until its fit, at most about 24 ms). The segmenter marks frames
 *   in click windows (`inClickWindow`), keeps flux inside them out of onset refinement (item 4), and applies the time
 *   gate and leak floor there (items 3 and 5) with the per-click leak levels of the fits.
 */
import type { Decimator } from '../core/api.ts';
import type { CaptureBlock } from '../core/platform.ts';
import type { ClockSeconds, DspConfig, DspEvent, PitchFrame } from '../core/types.ts';
import { PhaseDecimator, decimatorCreate as createDecimator } from './decimator.ts';
import { EnvelopeFollower } from './envelope.ts';
import { AdaptiveThreshold, FLUX_THRESHOLD_WINDOW_SEC, SpectralFlux } from './flux.ts';
import { ClickSubtractor, clickHandlingActive, type ClickFit } from './click.ts';
import { HiBandEnergy } from './hiband.ts';
import { PitchAnalyzer, widenRange } from './pitch.ts';
import { Segmenter, segmenterOptions, type SegmenterOptions } from './segmenter.ts';

/** Input frames per posted block (2 render quanta, 01 section 7.2). */
export const OFFLINE_BLOCK_FRAMES = 256;
/** A signal event every this many hops (01 section 5.6). */
export const SIGNAL_EVERY_HOPS = 4;
/** Low-band peak at or above this counts as clipping. */
export const CLIP_LEVEL = 0.98;

export interface DspPipelineOptions {
  /** Overrides of the derived segmenter options (tests and tuning). */
  segmenter?: Partial<SegmenterOptions>;
}

export class DspPipeline {
  readonly cfg: DspConfig;
  readonly segmenterOptions: SegmenterOptions;
  private readonly analyzer: PitchAnalyzer;
  private readonly env: EnvelopeFollower;
  private readonly flux: SpectralFlux;
  private readonly fluxThr: AdaptiveThreshold;
  private readonly seg: Segmenter;
  private envBuf = new Float32Array(64);
  private readonly allFrames: PitchFrame[] = [];
  private t0: number | null = null;
  private lastSeq: number | null = null;
  private hops = 0;
  private sigLevel = -Infinity;
  private sigVoiced = false;
  private sigPeak = 0;
  private readonly clicks: { arrival: number; accent: boolean }[];
  private sub: ClickSubtractor | null = null;
  private fitsSeen = 0;
  missingBlocks = 0;

  constructor(cfg: DspConfig, opts: DspPipelineOptions = {}) {
    this.cfg = cfg;
    const rate = cfg.analysisRate;
    const { minHz, maxHz } = widenRange(cfg.minHz, cfg.maxHz);
    this.analyzer = new PitchAnalyzer({
      analysisRate: rate,
      windowSamples: cfg.windowSamples,
      minHz,
      maxHz,
      a4Hz: cfg.a4Hz,
      clarityThreshold: cfg.clarityThreshold,
      hopSamples: cfg.hopSamples,
    });
    this.env = new EnvelopeFollower(rate);
    this.flux = new SpectralFlux(rate);
    const hopSec = cfg.hopSamples / rate;
    this.segmenterOptions = {
      ...segmenterOptions(hopSec, {
        windowSec: cfg.windowSamples / rate,
        clarityThreshold: cfg.clarityThreshold,
        changeCents: cfg.changeCents,
        onsetProfile: cfg.onsetProfile,
      }),
      ...opts.segmenter,
    };
    this.fluxThr = new AdaptiveThreshold(FLUX_THRESHOLD_WINDOW_SEC / (this.flux.hop / rate), this.segmenterOptions.fluxMadK);
    // 01 section 7.6: all click handling is off in headphone modes.
    this.clicks = clickHandlingActive(cfg.outputMode) ? cfg.clicks.map((c) => ({ arrival: c.arrival as number, accent: c.accent })) : [];
    this.seg = new Segmenter(
      this.segmenterOptions,
      cfg.repeatHints.map((h) => ({ t: h.t as number, halfWidthSec: h.halfWidthSec })),
      this.clicks.map((c) => c.arrival),
    );
  }

  /** Template fits so far (speakers with a template only). */
  clickFits(): readonly ClickFit[] {
    return this.sub ? this.sub.fits : [];
  }

  push(b: CaptureBlock): DspEvent[] {
    const out: DspEvent[] = [];
    if (b.analysisRate !== this.cfg.analysisRate) {
      throw new RangeError(`DspPipeline: block analysisRate ${b.analysisRate} differs from DspConfig.analysisRate ${this.cfg.analysisRate}`);
    }
    if (this.lastSeq !== null && b.seq !== this.lastSeq + 1) {
      const missing = Math.max(0, b.seq - this.lastSeq - 1);
      this.missingBlocks += missing;
      out.push({ type: 'gap', missingBlocks: missing });
    }
    this.lastSeq = b.seq;
    const rate = this.cfg.analysisRate;
    if (this.t0 === null) {
      this.t0 = b.startT as number;
      this.seg.startEnvelope(this.t0 + (0.5 * this.env.hop) / rate, this.env.hopSec, this.t0, rate);
      const tpl = this.cfg.clickTemplate;
      if (tpl && tpl.length > 0 && this.clicks.length > 0) {
        this.sub = new ClickSubtractor(tpl, this.clicks, rate, this.t0, { leakWindowSec: this.cfg.windowSamples / rate });
      }
    }
    const raw = b.lowband;
    for (let i = 0; i < raw.length; i++) {
      const a = Math.abs(raw[i] as number);
      if (a > this.sigPeak) this.sigPeak = a;
    }
    if (this.sub) {
      const startIdx = this.sub.released;
      const low = this.sub.push(raw);
      this.takeFits();
      this.analyse(low, (this.t0 + startIdx / rate) as ClockSeconds, out);
    } else {
      this.analyse(raw, b.startT, out);
    }
    return out;
  }

  /** Hands new template fits to the segmenter (leak levels for the click windows). */
  private takeFits(): void {
    const fits = (this.sub as ClickSubtractor).fits;
    for (; this.fitsSeen < fits.length; this.fitsSeen++) {
      const f = fits[this.fitsSeen] as ClickFit;
      this.seg.setClickLeak(f.arrival, f.leakEnvDb, f.leakFrameDb);
    }
  }

  private analyse(low: Float32Array, startT: ClockSeconds, out: DspEvent[]): void {
    const n = low.length;
    if (n === 0) return;
    const rate = this.cfg.analysisRate;
    const t0 = this.t0 as number;

    this.seg.pushSamples(low, n);
    const need = this.env.maxValues(n);
    if (this.envBuf.length < need) this.envBuf = new Float32Array(need * 2);
    const k = this.env.process(low, this.envBuf, 0, n);
    this.seg.pushEnvelope(this.envBuf, k);

    this.flux.push(low, n, (centre, value) => {
      const thr = this.fluxThr.current();
      this.fluxThr.push(value);
      this.seg.pushFlux(t0 + centre / rate, value, thr);
    });

    const ests = this.analyzer.push(low, startT, n);
    for (let j = 0; j < ests.length; j++) {
      const e = ests[j] as (typeof ests)[number];
      const last = j === ests.length - 1;
      const alt = last && e.rawMidi !== null ? this.analyzer.altOctaveClarity((e.midi ?? e.rawMidi) + 12) : null;
      const t = e.t as number;
      const frame: PitchFrame = {
        t: e.t,
        midi: e.midi,
        clarity: e.clarity,
        rmsDb: e.rmsDb,
        flux: this.seg.fluxAt(t),
        inClickWindow: this.seg.inClickWindow(t),
      };
      this.allFrames.push(frame);
      const evs = this.seg.pushFrame({ t, midi: e.midi, raw: e.rawMidi, clarity: e.clarity, rmsDb: e.rmsDb, alt, inClick: frame.inClickWindow });
      if (this.seg.consumeBoundary()) this.analyzer.resetNote();
      for (const ev of evs) out.push(ev);
      this.sigLevel = Math.max(this.sigLevel, e.rmsDb);
      if (e.midi !== null && e.clarity >= this.cfg.clarityThreshold && e.rmsDb >= this.seg.gateDb) this.sigVoiced = true;
      if (++this.hops % SIGNAL_EVERY_HOPS === 0) {
        out.push({ type: 'signal', levelDb: this.sigLevel, clipping: this.sigPeak >= CLIP_LEVEL, voiced: this.sigVoiced });
        this.sigLevel = -Infinity;
        this.sigVoiced = false;
        this.sigPeak = 0;
      }
    }
  }

  flush(t: ClockSeconds): DspEvent[] {
    const out: DspEvent[] = [];
    if (this.sub && this.t0 !== null) {
      const startIdx = this.sub.released;
      const low = this.sub.flush();
      this.takeFits();
      this.analyse(low, (this.t0 + startIdx / this.cfg.analysisRate) as ClockSeconds, out);
    }
    for (const ev of this.seg.flush(t as number)) out.push(ev);
    return out;
  }

  frames(): PitchFrame[] {
    return this.allFrames;
  }

  /** Current adaptive noise gate, dBFS (01 section 7.5). */
  get gateDb(): number {
    return this.seg.gateDb;
  }
}

/** Runs the capture-side primitives (decimator, hi band) and the pipeline over a whole recording. Time 0 is sample 0. */
export function runOffline(
  samples: Float32Array,
  inputRate: number,
  cfg: DspConfig,
  opts: DspPipelineOptions = {},
): { events: DspEvent[]; frames: PitchFrame[] } {
  const dec = new PhaseDecimator(inputRate);
  const hi = new HiBandEnergy(inputRate);
  const pipe = new DspPipeline({ ...cfg, analysisRate: dec.analysisRate }, opts);
  const low = new Float32Array(Math.ceil(OFFLINE_BLOCK_FRAMES / dec.factor) + 2);
  const hiBuf = new Float32Array(hi.maxSubBlocks(OFFLINE_BLOCK_FRAMES));
  const events: DspEvent[] = [];
  let seq = 0;
  for (let i = 0; i < samples.length; i += OFFLINE_BLOCK_FRAMES) {
    const chunk = samples.subarray(i, Math.min(samples.length, i + OFFLINE_BLOCK_FRAMES));
    const startT = dec.nextOutputInputPos / inputRate;
    const nLow = dec.process(chunk, low, 0);
    const nHi = hi.process(chunk, hiBuf, 0);
    if (nLow === 0) continue;
    const block: CaptureBlock = {
      v: 1,
      startT: startT as ClockSeconds,
      lowband: low.slice(0, nLow),
      hiEnergy: hiBuf.slice(0, nHi),
      analysisRate: dec.analysisRate,
      seq: seq++,
    };
    for (const ev of pipe.push(block)) events.push(ev);
  }
  for (const ev of pipe.flush((samples.length / inputRate) as ClockSeconds)) events.push(ev);
  return { events, frames: pipe.frames() };
}

/** Re-exported so this module satisfies `DspApi` (src/core/api.ts). */
export const decimatorCreate = (inputRate: number): Decimator => createDecimator(inputRate);
