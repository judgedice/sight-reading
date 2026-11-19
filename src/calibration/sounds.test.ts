/**
 * Calibration and the count-in recheck with the player's metronome sounds (06 section 9.5, 08 `metronome`):
 * - loopback still measures RTL from Tick and builds the selected sound's own low-band template (whole click);
 * - each sound's clicks are found by their own arrival envelope (at least 7 of 10, MAD at most 3 ms);
 * - the recheck finds each sound's count-in in the hi band without a template (after a sound change), with the
 *   stored template, with the accent off, and (Classic, Woodblock) falls back to the stored template when the hi band
 *   is gone.
 *
 * The speaker-to-mic path mixes the metronome's own samples (src/core/click-sounds.ts) as `Metronome` plays them:
 * calibration clicks at +5 dB (Tick and Wood their accent burst, the new sounds their offbeat recipe), take beats
 * as on speakers (offbeat recipe, downbeats +accentDb) or with the accent recipe (headphone modes).
 */
import { describe, expect, it } from 'vitest';
import budgetJson from '../../config/measurement-budget.json';
import { CLICK_RECIPES, METRONOME_SOUNDS, renderClick } from '../core/click-sounds.ts';
import type { ClickSpec, ClockSeconds, TakeSchedule, WorkerMessage } from '../core/platform.ts';
import { createRng } from '../core/rng.ts';
import type { AudioRouteInfo, ClickTimbre, MeasurementBudget, MetronomeSound } from '../core/types.ts';
import { FakeAudioBackend } from '../testkit/fake-backend.ts';
import {
  analyzeLoopback,
  CaptureRecording,
  clickTemplateLengthSec,
  CountInRecheck,
  randomClickTimes,
  runLoopbackCalibration,
  type CalibrationDeps,
} from './index.ts';

const budget = (budgetJson as unknown as MeasurementBudget).calibration;
const START = 10;
const legacy = (t: ClickTimbre): boolean => t === 'tick' || t === 'wood';

/**
 * FakeAudioBackend whose speaker-to-mic path is the metronome's real samples (the fake's own loopback knows only
 * Tick and Wood). Clicks are mixed at `gainDb` (accents and calibration clicks 5 dB more), `rtlSec` late.
 */
class SoundRoom extends FakeAudioBackend {
  private readonly buf: Float32Array;
  constructor(
    sampleRate: number,
    private readonly room: { rtlSec: number; gainDb: number; accentRecipe?: boolean; noHiBand?: boolean },
  ) {
    const buf = new Float32Array(30 * sampleRate);
    if (room.noHiBand) {
      // A room noise floor (-80 dBFS RMS), so "nothing above 5 kHz" is measured against something.
      const rng = createRng(5);
      const a = 10 ** (-80 / 20) * Math.sqrt(3);
      for (let i = 0; i < buf.length; i++) buf[i] = a * (2 * rng.next() - 1);
    }
    super({ sampleRate, source: buf, sourceStartClock: START });
    this.buf = buf;
  }

  private burst(timbre: ClickTimbre, accentRecipe: boolean): Float32Array {
    const x = renderClick(timbre, accentRecipe, this.sampleRate);
    return this.room.noHiBand ? lowPass(x, 2200, this.sampleRate) : x;
  }

  private mix(t: number, x: Float32Array, db: number): void {
    const g = 10 ** ((this.room.gainDb + db) / 20);
    const i0 = Math.round((t + this.room.rtlSec - START) * this.sampleRate);
    for (let i = 0; i < x.length; i++) {
      const j = i0 + i;
      if (j >= 0 && j < this.buf.length) this.buf[j] = (this.buf[j] as number) + (x[i] as number) * g;
    }
    this.setSource(this.buf);
  }

  override async playCalibrationClicks(times: ClockSeconds[], timbre: ClickTimbre): Promise<void> {
    await super.playCalibrationClicks(times, timbre);
    const x = this.burst(timbre, legacy(timbre));
    for (const t of times) this.mix(t, x, 5);
  }

  override async scheduleTake(p: TakeSchedule): Promise<{ t0: ClockSeconds; clicks: ClickSpec[] }> {
    const r = await super.scheduleTake(p);
    const recipe = legacy(p.timbre) || this.room.accentRecipe === true;
    for (const c of r.clicks) this.mix(c.t, this.burst(p.timbre, c.accent && recipe), c.accent ? p.accentDb : 0);
    return r;
  }
}

function deps(fb: FakeAudioBackend, seed = 1): CalibrationDeps {
  return { audio: fb, waitUntil: async (t) => fb.advanceTo(t), rng: createRng(seed), budget, clockWall: () => '2026-11-19T12:00:00.000Z' };
}

const route = (fb: FakeAudioBackend): AudioRouteInfo => ({
  routeKey: 'route-a',
  inputKind: 'built-in',
  outputMode: 'speakers',
  sampleRate: fb.sampleRate,
  appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  reportedLatencySec: 0.02,
});

/**
 * A speaker with nothing above about 3 kHz: zero-phase windowed-sinc low-pass (Blackman, 301 taps, cut at `hz`),
 * stopband below -70 dB, so the click keeps its timing and loses its Tick layer.
 */
function lowPass(x: Float32Array, hz: number, rate: number): Float32Array {
  const half = 150;
  const h: number[] = [];
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const w = 0.42 + 0.5 * Math.cos((Math.PI * k) / half) + 0.08 * Math.cos((2 * Math.PI * k) / half);
    const fc = hz / rate;
    const v = (k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k)) * w;
    h.push(v);
    sum += v;
  }
  const out = new Float32Array(x.length + half);
  for (let i = 0; i < out.length; i++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += (x[i - k] ?? 0) * (h[k + half] as number);
    out[i] = acc / sum;
  }
  return out;
}

const energy = (x: readonly number[]): number => x.reduce((a, v) => a + v * v, 0);

describe('loopback calibration with each sound (06 section 9.5)', () => {
  for (const sampleRate of [48000, 44100]) {
    for (const sound of METRONOME_SOUNDS) {
      it(`${sound} at ${sampleRate} Hz: RTL from Tick as before, and the ${sound} template over the whole click`, async () => {
        const fb = new SoundRoom(sampleRate, { rtlSec: 0.037, gainDb: -12 });
        const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: sound });
        expect(fb.log.calibrationClicks.map((c) => c.timbre)).toEqual(['tick', sound]);
        expect(r.loopback.accepted, String(r.loopback.failure)).toBe(true);
        expect(r.loopback.clicksFound).toBe(budget.loopback.clicks);
        expect(Math.abs((r.loopback.rtlMs as number) - 37)).toBeLessThanOrEqual(1);
        const c = r.calibration;
        expect(c).not.toBeNull();
        const own = c?.templates[sound]?.samples ?? [];
        const rate = c?.templates[sound]?.rate as number;
        expect(own.length).toBe(Math.max(8, Math.round(clickTemplateLengthSec(sound) * rate)));
        expect(clickTemplateLengthSec(sound)).toBeGreaterThan(0.002 + CLICK_RECIPES[sound].offbeat.lengthSec);
        // The new sounds put their body in the low band; Tick leaks almost nothing there.
        expect(energy(own)).toBeGreaterThan(100 * energy(c?.templates.tick?.samples ?? []));
        expect(c?.clickLeakDb).toBeGreaterThan(-60);
        // Flow and counts unchanged.
        expect(r.schedule.ticks).toHaveLength(budget.loopback.clicks);
        expect(r.schedule.templateClicks).toHaveLength(budget.loopback.templateClicks);
        expect(Object.keys(c?.templates ?? {}).sort()).toEqual([sound, 'tick'].sort());
      });
    }
  }

  it('keeps Tick and Wood templates at the dsp default length', () => {
    expect(clickTemplateLengthSec('tick')).toBe(0.02);
    expect(clickTemplateLengthSec('wood')).toBe(0.02);
  });
});

describe('each sound is found by its own arrival envelope (calibration detector, 06 section 9.5)', () => {
  for (const sampleRate of [48000, 44100]) {
    for (const sound of METRONOME_SOUNDS) {
      for (const d of [25, 60, 110]) {
        it(`${sound} at ${sampleRate} Hz, d = ${d} ms: at least 7 of 10 found, MAD <= 3 ms, RTL within 1 ms`, async () => {
          const fb = new SoundRoom(sampleRate, { rtlSec: d / 1000, gainDb: -12 });
          const rec = new CaptureRecording(fb.sampleRate);
          await fb.startCapture((m: WorkerMessage) => {
            if (m.type === 'block') rec.push(m.block);
          });
          const rng = createRng(0x10 + d);
          const times = randomClickTimes(START + 0.6, budget.loopback.clicks, () => rng.next());
          await fb.playCalibrationClicks(times as ClockSeconds[], sound);
          fb.advanceTo((times[times.length - 1] as number) + 0.5);
          fb.stopCapture();
          const r = analyzeLoopback(rec, { ticks: times, templateClicks: [], templateTimbre: sound, clickTimbre: sound, silence: { t0: (times[0] as number) - 0.25, t1: (times[0] as number) - 0.05 } }, budget);
          expect(r.accepted, String(r.failure)).toBe(true);
          expect(r.clicksFound).toBeGreaterThanOrEqual(7);
          expect(r.madMs as number).toBeLessThanOrEqual(3);
          expect(Math.abs((r.rtlMs as number) - d)).toBeLessThanOrEqual(1);
        });
      }
    }
  }
});

describe('count-in recheck with each sound (01 section 7.7)', () => {
  async function countInTake(room: SoundRoom, sound: MetronomeSound, template: number[] | null, accent = true) {
    let rc: CountInRecheck | null = null;
    const pending: WorkerMessage[] = [];
    await room.startCapture((m) => {
      if (m.type !== 'block') return;
      if (!rc) return void pending.push(m);
      rc.push(m.block);
    });
    const { clicks } = await room.scheduleTake({ leadSec: 0.5, bpm: 96, beatsPerBar: 4, countInBeats: 4, totalBeats: 8, mode: 'audible', timbre: sound, accentDb: 3, accent });
    const countIn = clicks.filter((c) => c.countIn).map((c) => ({ t: c.t as number, accent: c.accent }));
    rc = new CountInRecheck(room.sampleRate, countIn, { timbre: sound, template, budget, silence: { t0: START, t1: countIn[0]!.t } });
    for (const m of pending) if (m.type === 'block') rc.push(m.block);
    await room.run({ untilClock: START + 6 });
    return rc.result ?? rc.finish();
  }

  /** The template a loopback calibration with `sound` stores. */
  async function storedTemplate(sound: MetronomeSound, rtlSec: number): Promise<number[]> {
    const cal = new SoundRoom(48000, { rtlSec, gainDb: -14 });
    const run = await runLoopbackCalibration(deps(cal), { route: route(cal), timbre: sound });
    const tpl = run.calibration?.templates[sound]?.samples;
    if (tpl) return tpl;
    throw new Error(`no ${sound} template`);
  }

  for (const sound of ['classic', 'woodblock'] as const) {
    it(`${sound}: with no hi band at the mic, the stored template finds the count-in; without one it is unmeasured`, async () => {
      const tpl = await storedTemplate(sound, 0.045);
      const withTpl = await countInTake(new SoundRoom(48000, { rtlSec: 0.045, gainDb: -14, noHiBand: true }), sound, tpl);
      expect(withTpl.accepted).toBe(true);
      expect(Math.abs((withTpl.rtlMs as number) - 45)).toBeLessThanOrEqual(1);
      const none = await countInTake(new SoundRoom(48000, { rtlSec: 0.045, gainDb: -14, noHiBand: true }), sound, null);
      expect(none.accepted).toBe(false);
      expect(none.rtlMs).toBeNull();
    });
  }

  for (const sound of METRONOME_SOUNDS) {
    it(`${sound}: measured in the hi band without a template (just after a sound change), within 1 ms`, async () => {
      const r = await countInTake(new SoundRoom(48000, { rtlSec: 0.045, gainDb: -14 }), sound, null);
      expect(r.accepted).toBe(true);
      expect(r.firstClickFound).toBe(true);
      expect(r.clicksFound).toBe(4);
      expect(Math.abs((r.rtlMs as number) - 45)).toBeLessThanOrEqual(1);
    });

    it(`${sound}: measured with the stored template, with the accent off, and with the accent recipe (headphone render)`, async () => {
      const tpl = await storedTemplate(sound, 0.052);
      for (const [room, accent] of [
        [new SoundRoom(48000, { rtlSec: 0.058, gainDb: -14 }), true],
        [new SoundRoom(48000, { rtlSec: 0.058, gainDb: -14 }), false],
        [new SoundRoom(48000, { rtlSec: 0.058, gainDb: -14, accentRecipe: true }), true],
      ] as const) {
        const r = await countInTake(room, sound, tpl, accent);
        expect(r.accepted).toBe(true);
        expect(r.clicksFound).toBe(4);
        expect(Math.abs((r.rtlMs as number) - 58)).toBeLessThanOrEqual(1);
      }
    });

  }
});
