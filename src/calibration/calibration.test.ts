/**
 * P14 acceptance (01 P14 row): synthetic 37 ms loopback measured 37 ± 1 ms; play-along ±5 ms; the recheck uses the
 * fresh value when the stored one differs by more than 5 ms; sanity tone ±8 c; AEC signature flagged; the self-test
 * exports no audio. Plus 05 W3 (clock rate caught, recreate once, second failure), W6 (flow), W7, W8. All on
 * FakeAudioBackend in Node.
 */
import { describe, expect, it } from 'vitest';
import budgetJson from '../../config/measurement-budget.json';
import type { ClockSeconds, PlatformCapabilities, WorkerMessage } from '../core/platform.ts';
import { createRng } from '../core/rng.ts';
import type { AudioRouteInfo, ClickTimbre, MeasurementBudget } from '../core/types.ts';
import { FakeAudioBackend, type FakeBackendOptions } from '../testkit/fake-backend.ts';
import { clickBurst, renderMin } from '../testkit/synth-min.ts';
import {
  analyzePlayAlong,
  CountInRecheck,
  decideRecheck,
  applyRecheckToCalibration,
  exportDiagnostics,
  playAlongClickTimes,
  PLAY_ALONG_LEAD_SEC,
  runClockRateCheck,
  runLoopbackCalibration,
  runPlayAlongCalibration,
  runSelfTest,
  calibrationPlan,
  type CalibrationDeps,
  type CalibrationStageId,
} from './index.ts';

const budget = (budgetJson as unknown as MeasurementBudget).calibration;
const START = 10;

interface Room {
  /** Pitch ratio of the captured tone (a 44.1/48 kHz mis-resample is 48/44.1, +147 cents). */
  tonePitchRatio?: number;
  /** Extra attenuation of the tone only (an echo canceller), dB. */
  toneAttenDb?: number;
  /** Which Tick calibration clicks reach the mic (echo canceller or a dropout). */
  keepClick?: (i: number) => boolean;
  /** Per-click output timing error, seconds (a misbehaving output). */
  clickJitterSec?: (i: number) => number;
}

/**
 * FakeAudioBackend with the speaker-to-mic path for the sanity tone (the fake logs tones but does not mix them):
 * the tone is a 0.5-amplitude sine with 10 ms fades (as WebAudioBackend.playTone), heard after the loopback RTL at
 * the loopback gain + 6 dB (the fake's clicks are rendered at full scale, the real ones at 0.5).
 */
class RoomBackend extends FakeAudioBackend {
  private readonly room: Room;
  private readonly fopts: FakeBackendOptions;
  private buf: Float32Array;
  private calCalls = 0;

  constructor(opts: FakeBackendOptions & { sampleRate: number }, room: Room = {}, seconds = 30, noiseRms = 0) {
    const buf = new Float32Array(Math.round(seconds * opts.sampleRate));
    if (noiseRms > 0) {
      const rng = createRng(99);
      for (let i = 0; i < buf.length; i++) buf[i] = noiseRms * Math.sqrt(3) * (2 * rng.next() - 1);
    }
    super({ ...opts, source: buf, sourceStartClock: opts.sourceStartClock ?? START });
    this.buf = buf;
    this.room = room;
    this.fopts = opts;
  }

  /** Adds samples to the source at a clock time. */
  addAt(clock: number, x: Float32Array): void {
    const sr = this.sampleRate;
    const i0 = Math.round((clock - (this.fopts.sourceStartClock ?? START)) * sr);
    for (let i = 0; i < x.length; i++) {
      const j = i0 + i;
      if (j >= 0 && j < this.buf.length) this.buf[j] = (this.buf[j] as number) + (x[i] as number);
    }
    this.setSource(this.buf);
  }

  override async playCalibrationClicks(times: ClockSeconds[], timbre: ClickTimbre): Promise<void> {
    const first = this.calCalls++ === 0;
    const kept = times
      .map((t, i) => ({ t: t + (first ? (this.room.clickJitterSec?.(i) ?? 0) : 0), i }))
      .filter(({ i }) => !first || (this.room.keepClick?.(i) ?? true))
      .map(({ t }) => t as ClockSeconds);
    await super.playCalibrationClicks(kept, timbre);
    this.log.calibrationClicks[this.log.calibrationClicks.length - 1] = { times: [...times], timbre };
  }

  override async playTone(hz: number, durSec: number, at: ClockSeconds): Promise<void> {
    await super.playTone(hz, durSec, at);
    const lb = this.fopts.loopback;
    if (!lb) return;
    const sr = this.sampleRate;
    const n = Math.round(durSec * sr);
    const fade = Math.round(0.01 * sr);
    const g = 0.5 * 10 ** ((lb.gainDb + 6.02 - (this.room.toneAttenDb ?? 0)) / 20);
    const w = (2 * Math.PI * hz * (this.room.tonePitchRatio ?? 1)) / sr;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < fade) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      else if (i >= n - fade) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / fade);
      x[i] = g * env * Math.sin(w * i);
    }
    this.addAt((at as number) + lb.rtlSec, x);
  }
}

function deps(fb: FakeAudioBackend, seed = 1): CalibrationDeps {
  return {
    audio: fb,
    waitUntil: async (t) => fb.advanceTo(t),
    rng: createRng(seed),
    budget,
    clockWall: () => '2026-11-18T12:00:00.000Z',
  };
}

const route = (fb: FakeAudioBackend, patch: Partial<AudioRouteInfo> = {}): AudioRouteInfo => ({
  routeKey: 'route-a',
  inputKind: 'built-in',
  outputMode: 'speakers',
  sampleRate: fb.sampleRate,
  appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  reportedLatencySec: 0.02,
  ...patch,
});

describe('loopback (01 §7.8)', () => {
  for (const sampleRate of [48000, 44100]) {
    it(`measures a synthetic 37 ms loopback as 37 ± 1 ms at ${sampleRate} Hz`, async () => {
      const fb = new RoomBackend({ sampleRate, loopback: { rtlSec: 0.037, gainDb: -12 } });
      const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
      expect(r.loopback.accepted).toBe(true);
      expect(r.loopback.clicksFound).toBe(10);
      expect(Math.abs((r.loopback.rtlMs as number) - 37)).toBeLessThanOrEqual(1);
      expect(r.loopback.madMs as number).toBeLessThanOrEqual(budget.loopback.maxMadMs);
      const c = r.calibration;
      expect(c).not.toBeNull();
      expect(c?.method).toBe('loopback');
      expect(c?.routeKey).toBe('route-a');
      expect(c?.stale).toBe(false);
      expect(c?.templates.tick?.samples.length).toBeGreaterThan(100);
      expect(Number.isFinite(c?.clickLeakDb)).toBe(true);
      expect(c?.sanityToneCents).not.toBeNull();
      expect(c?.aecSuspected).toBe(false);
    });
  }

  it('stays within ±1 ms with noise, quiet clicks, a cough between clicks, across RTLs and seeds', async () => {
    for (const [rtl, gainDb, seed] of [
      [0.037, -30, 2],
      [0.016, -20, 3],
      [0.120, -25, 4],
      [0.300, -20, 5],
    ] as const) {
      const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: rtl, gainDb } }, {}, 30, 10 ** (-60 / 20));
      // Coughs: hi-band bursts between the clicks (unrelated to the schedule).
      for (const t of [START + 1.3, START + 3.9, START + 6.2]) {
        const b = clickBurst('tick', true, 48000).map((v) => v * 10 ** ((gainDb + 3) / 20));
        fb.addAt(t, b);
      }
      const r = await runLoopbackCalibration(deps(fb, seed), { route: route(fb), timbre: 'tick' });
      expect(r.loopback.accepted, `rtl ${rtl}`).toBe(true);
      expect(Math.abs((r.loopback.rtlMs as number) - rtl * 1000), `rtl ${rtl}`).toBeLessThanOrEqual(1);
    }
  });

  it('builds the Wood template from the extra clicks when Wood is selected', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.05, gainDb: -12 } });
    const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'wood' });
    expect(r.calibration?.templates.wood?.samples.length).toBeGreaterThan(100);
    expect(r.calibration?.templates.tick).toBeDefined();
    // Wood sits in the low band: its leak is far above Tick's.
    const wood = r.calibration?.templates.wood?.samples ?? [];
    const tick = r.calibration?.templates.tick?.samples ?? [];
    const e = (xs: number[]): number => xs.reduce((a, v) => a + v * v, 0);
    expect(e(wood)).toBeGreaterThan(100 * e(tick));
    expect(fb.log.calibrationClicks.map((c) => c.timbre)).toEqual(['tick', 'wood']);
  });

  it('fails with too few clicks (volume off, or 4 of 10 heard) and returns no calibration', async () => {
    const silent = new RoomBackend({ sampleRate: 48000 });
    const a = await runLoopbackCalibration(deps(silent), { route: route(silent), timbre: 'tick' });
    expect(a.loopback.accepted).toBe(false);
    expect(a.loopback.failure).toBe('too-few-clicks');
    expect(a.calibration).toBeNull();
    const four = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 } }, { keepClick: (i) => i < 4 });
    const b = await runLoopbackCalibration(deps(four), { route: route(four), timbre: 'tick' });
    expect(b.loopback.clicksFound).toBe(4);
    expect(b.loopback.failure).toBe('too-few-clicks');
  });

  it('fails on spread above the MAD limit', async () => {
    const jit = createRng(7);
    const offs = Array.from({ length: 10 }, () => (jit.next() - 0.5) * 0.024);
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 } }, { clickJitterSec: (i) => offs[i] as number });
    const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
    expect(r.loopback.madMs as number).toBeGreaterThan(budget.loopback.maxMadMs);
    expect(r.loopback.failure).toBe('spread');
  });

  it('rejects an RTL below the 15 ms floor', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.005, gainDb: -12 } });
    const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
    expect(r.loopback.accepted).toBe(false);
  });

  it('reports per-click progress for the dots', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 } }, { keepClick: (i) => i !== 3 });
    const heard: boolean[] = [];
    await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick', onClick: (i, h) => (heard[i] = h) });
    expect(heard).toEqual([true, true, true, false, true, true, true, true, true, true]);
  });
});

describe('what the player sees matches what they hear (owner feedback: marks and clicks did not line up)', () => {
  type Ev = { kind: 'stage' | 'sound' | 'verdict'; stage: CalibrationStageId | null; index: number; at: number };
  const record = (fb: FakeAudioBackend): { events: Ev[]; progress: { onStage(s: CalibrationStageId): void; onSound(s: CalibrationStageId, i: number): void }; onClick(i: number, h: boolean): void } => {
    const events: Ev[] = [];
    return {
      events,
      progress: {
        onStage: (stage) => events.push({ kind: 'stage', stage, index: -1, at: fb.now() as number }),
        onSound: (stage, index) => events.push({ kind: 'sound', stage, index, at: fb.now() as number }),
      },
      onClick: (index) => events.push({ kind: 'verdict', stage: 'timing', index, at: fb.now() as number }),
    };
  };

  it('lights each mark when its click is audible (scheduled time plus output latency), before its verdict, for every stage', async () => {
    const latency = 0.03;
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 }, route: { reportedLatencySec: latency } });
    const r = record(fb);
    const run = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'classic', onClick: r.onClick, progress: r.progress });
    const { ticks, templateClicks, toneAt } = run.schedule;
    const sounds = (stage: CalibrationStageId): Ev[] => r.events.filter((e) => e.kind === 'sound' && e.stage === stage);
    // One sound event per click, each at exactly its audible time on the audio clock (not when it was scheduled,
    // and not when the arrival window closed, which is up to maxRtlMs + 30 ms later).
    expect(sounds('timing').map((e) => e.index)).toEqual(ticks.map((_, i) => i));
    sounds('timing').forEach((e, i) => expect(e.at).toBeCloseTo((ticks[i] as number) + latency, 9));
    sounds('template').forEach((e, i) => expect(e.at).toBeCloseTo((templateClicks[i] as number) + latency, 9));
    expect(sounds('template')).toHaveLength(budget.loopback.templateClicks);
    expect(sounds('pitch').map((e) => e.at)).toEqual([toneAt + latency]);
    // Each verdict comes after its own mark lit, once its window is analysed.
    for (let i = 0; i < ticks.length; i++) {
      const lit = r.events.findIndex((e) => e.kind === 'sound' && e.stage === 'timing' && e.index === i);
      const verdict = r.events.findIndex((e) => e.kind === 'verdict' && e.index === i);
      expect(lit).toBeLessThan(verdict);
      expect(r.events[verdict]?.at).toBeCloseTo((ticks[i] as number) + budget.loopback.maxRtlMs / 1000 + 0.03, 9);
    }
    // Stage lines come in order, each before its first sound and after the previous stage's last sound.
    const stages = r.events.filter((e) => e.kind === 'stage');
    expect(stages.map((e) => e.stage)).toEqual(['timing', 'template', 'pitch']);
    const lastSound = (stage: CalibrationStageId): number => Math.max(...sounds(stage).map((e) => e.at));
    const firstSound = (stage: CalibrationStageId): number => Math.min(...sounds(stage).map((e) => e.at));
    expect(stages[1]?.at).toBeGreaterThan(lastSound('timing'));
    expect(stages[1]?.at).toBeLessThan(firstSound('template'));
    expect(stages[2]?.at).toBeGreaterThan(lastSound('template'));
    expect(stages[2]?.at).toBeLessThan(firstSound('pitch'));
    // Presentation only: the measurement is the same as without progress.
    expect(run.loopback.accepted).toBe(true);
    expect(run.loopback.rtlMs).toBeCloseTo(40, 0);
  });

  it('without reported latency a mark lights at the scheduled time', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 }, route: { reportedLatencySec: 0 } });
    const r = record(fb);
    const run = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick', progress: r.progress });
    expect(r.events.filter((e) => e.kind === 'sound' && e.stage === 'timing').map((e) => e.at)).toEqual(run.schedule.ticks);
  });

  it('the self-test reuses the calibration run (no second set of timing clicks) and shows the count-in as its own stage', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 } }, {}, 40);
    const r = record(fb);
    const run = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick', progress: r.progress });
    const clicksBefore = fb.log.calibrationClicks.length;
    const tonesBefore = r.events.filter((e) => e.stage === 'pitch').length;
    const self = await runSelfTest(deps(fb), { route: route(fb), capabilities: fb.capabilities, timbre: 'tick', loopback: run, clock: { ok: true, error: 0, recreated: false, state: 'ok' }, progress: r.progress });
    expect(fb.log.calibrationClicks).toHaveLength(clicksBefore);
    expect(r.events.filter((e) => e.stage === 'pitch')).toHaveLength(tonesBefore);
    const countIn = r.events.filter((e) => e.stage === 'count-in');
    expect(countIn[0]?.kind).toBe('stage');
    expect(countIn.filter((e) => e.kind === 'sound')).toHaveLength(calibrationPlan(budget, 'speakers').stages.find((s) => s.id === 'count-in')?.sounds ?? -1);
    expect(Object.fromEntries(self.items.map((i) => [i.id, i.status]))).toMatchObject({ clicks: 'pass', 'sanity-tone': 'pass', recheck: 'pass' });
  });

  it('a clock that could not be measured reads as not run, with its reason, and fails nothing', async () => {
    const fb = new RoomBackend({ sampleRate: 48000 });
    const r = await runSelfTest(deps(fb), { route: route(fb, { outputMode: 'wired' }), capabilities: fb.capabilities, timbre: 'tick', clock: { ok: true, error: null, recreated: false, state: 'unmeasured' } });
    const item = r.items.find((i) => i.id === 'clock-rate');
    expect(item?.status).toBe('skipped');
    expect(item?.detail['reason']).toBe('unmeasured');
    expect(r.passed).toBe(true);
  });

  it('the plan lists the stages a route plays, with counts from config', () => {
    const sp = calibrationPlan(budget, 'speakers');
    expect(sp.stages.map((s) => [s.id, s.sounds, s.accented])).toEqual([
      ['timing', budget.loopback.clicks, 0],
      ['template', budget.loopback.templateClicks, 0],
      ['pitch', 1, 0],
      ['count-in', 4, 1],
    ]);
    expect(sp.skipped).toEqual([]);
    expect(sp.seconds).toBe(15);
    const hp = calibrationPlan(budget, 'wired');
    expect(hp.stages.map((s) => [s.id, s.sounds])).toEqual([['play-along', budget.playAlong.clicks]]);
    expect(hp.skipped).toEqual(['timing', 'template', 'pitch', 'count-in']);
    expect(calibrationPlan({ ...budget, loopback: { ...budget.loopback, templateClicks: 0 } }, 'speakers').stages.map((s) => s.id)).toEqual(['timing', 'pitch', 'count-in']);
  });

  it('play-along lights each click when it is audible', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, route: { reportedLatencySec: 0.025 } });
    const r = record(fb);
    const run = await runPlayAlongCalibration(deps(fb), { route: route(fb, { outputMode: 'wired' }), timbre: 'classic', progress: r.progress });
    expect(r.events[0]?.kind).toBe('stage');
    r.events.filter((e) => e.kind === 'sound').forEach((e, i) => expect(e.at).toBeCloseTo((run.clicks[i] as number) + 0.025, 9));
  });
});

describe('sanity tone and AEC signature (01 §7.8, 05 W3, gate (c))', () => {
  it('reads the A4 tone within ±8 cents on a correct chain', async () => {
    for (const sampleRate of [48000, 44100]) {
      const fb = new RoomBackend({ sampleRate, loopback: { rtlSec: 0.06, gainDb: -18 } });
      const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
      expect(r.tone.withinLimit).toBe(true);
      expect(Math.abs(r.tone.cents as number)).toBeLessThanOrEqual(budget.sanityToneCents);
      expect(fb.log.tones).toHaveLength(1);
      expect(fb.log.tones[0]?.hz).toBe(440);
      expect(fb.log.tones[0]?.durSec).toBeCloseTo(0.3);
    }
  });

  it('catches a 44.1/48 kHz mis-resample (+147 cents) and a 9 cent error', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.06, gainDb: -18 } }, { tonePitchRatio: 48000 / 44100 });
    const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
    expect(r.tone.cents as number).toBeGreaterThan(140);
    expect(r.tone.withinLimit).toBe(false);
    const fb9 = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.06, gainDb: -18 } }, { tonePitchRatio: 2 ** (9.5 / 1200) });
    const r9 = await runLoopbackCalibration(deps(fb9), { route: route(fb9), timbre: 'tick' });
    expect(r9.tone.withinLimit).toBe(false);
  });

  it('predicts the tone level from the clicks within a few dB on a flat path', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.05, gainDb: -18 } });
    const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
    expect(Math.abs(r.aec.shortfallDb as number)).toBeLessThan(4);
  });

  it('flags AEC: loopback fails on the built-in speaker and the tone arrives > 20 dB below the prediction', async () => {
    const aec: Room = { keepClick: (i) => i < 3, toneAttenDb: 35 };
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.05, gainDb: -12 } }, aec, 30, 10 ** (-80 / 20));
    const r = await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' });
    expect(r.loopback.accepted).toBe(false);
    expect(r.aec.suspected).toBe(true);
    expect(r.aec.shortfallDb as number).toBeGreaterThan(20);

    // Same failure with the tone intact: not AEC (a quiet or misbehaving output instead).
    const ok = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.05, gainDb: -12 } }, { keepClick: (i) => i < 3 });
    expect((await runLoopbackCalibration(deps(ok), { route: route(ok), timbre: 'tick' })).aec.suspected).toBe(false);

    // An external interface is never flagged.
    const usb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.05, gainDb: -12 } }, aec, 30, 10 ** (-80 / 20));
    const ru = await runLoopbackCalibration(deps(usb), { route: route(usb, { inputKind: 'usb-interface' }), timbre: 'tick' });
    expect(ru.aec.suspected).toBe(false);
  });
});

describe('play-along (01 §7.8, 05 Q2)', () => {
  /** Notes at click + rtl + the player's error, rendered as the capture source (headphones: no click bleed). */
  function playerSource(sr: number, rtl: number, errors: readonly (number | null)[]): Float32Array {
    const clicks = playAlongClickTimes(START + PLAY_ALONG_LEAD_SEC, budget);
    const notes = clicks.flatMap((c, i) => {
      const e = errors[i];
      return e === null || e === undefined ? [] : [{ midi: 67 + (i % 3) * 2, onsetSec: c - START + rtl + e, durSec: 0.2 }];
    });
    const { samples } = renderMin({ sampleRate: sr, notes, durationSec: 30, noiseDbfs: -70 });
    return samples;
  }

  const run = async (rtl: number, errors: readonly (number | null)[], sr = 48000) => {
    const fb = new FakeAudioBackend({ sampleRate: sr, source: playerSource(sr, rtl, errors), sourceStartClock: START });
    return runPlayAlongCalibration(deps(fb), { route: route(fb, { outputMode: 'wired', inputKind: 'wired' }), timbre: 'wood' });
  };

  it('measures the RTL within ±5 ms with a steady player (48 and 44.1 kHz)', async () => {
    for (const [rtl, sr] of [[0.03, 48000], [0.16, 44100]] as const) {
      const r = await run(rtl, Array(8).fill(0), sr);
      expect(r.playAlong.accepted).toBe(true);
      expect(r.playAlong.notesFound).toBe(8);
      expect(Math.abs((r.playAlong.rtlMs as number) - rtl * 1000)).toBeLessThanOrEqual(5);
      expect(r.calibration?.method).toBe('play-along');
      expect(r.calibration?.sanityToneCents).toBeNull();
    }
  });

  it('measures median(onset - click) within ±5 ms when the player anticipates by 10 to 40 ms', async () => {
    const rng = createRng(11);
    const errors = Array.from({ length: 8 }, () => -0.01 - 0.03 * rng.next());
    const sorted = [...errors].sort((a, b) => a - b);
    const medErr = (sorted[3]! + sorted[4]!) / 2;
    const r = await run(0.08, errors);
    expect(r.playAlong.accepted).toBe(true);
    expect(Math.abs((r.playAlong.rtlMs as number) - (80 + medErr * 1000))).toBeLessThanOrEqual(5);
    expect(r.playAlong.offsetsMs.every((x) => x !== null)).toBe(true);
  });

  it('fails on spread above 15 ms MAD and on too few notes', async () => {
    const wild = [0, 0.07, -0.06, 0.05, -0.08, 0.04, -0.05, 0.09];
    const a = await run(0.05, wild);
    expect(a.playAlong.failure).toBe('spread');
    expect(a.calibration).toBeNull();
    const b = await run(0.05, [0, 0, null, null, null, 0, 0, 0]);
    expect(b.playAlong.failure).toBe('too-few-notes');
  });

  it('matches onsets by consensus, ignoring stray notes between clicks', () => {
    const clicks = playAlongClickTimes(0, budget);
    const onsets = clicks.map((c) => c + 0.1).concat([0.4, 1.9, 3.3]);
    const r = analyzePlayAlong(onsets.sort((a, b) => a - b), clicks, budget);
    expect(r.accepted).toBe(true);
    expect(r.rtlMs as number).toBeCloseTo(100, 6);
  });
});

describe('per-take count-in recheck (01 §7.7, R31)', () => {
  async function countInTake(opts: FakeBackendOptions & { sampleRate: number }, timbre: ClickTimbre, template: number[] | null) {
    const fb = new FakeAudioBackend({ ...opts, source: new Float32Array(opts.sampleRate * 10), sourceStartClock: START });
    let rc: CountInRecheck | null = null;
    const pending: WorkerMessage[] = [];
    let posted = 0;
    await fb.startCapture((m) => {
      if (m.type !== 'block') return;
      if (!rc) return void pending.push(m);
      if (rc.push(m.block)) posted++;
    });
    const { clicks } = await fb.scheduleTake({ leadSec: 0.5, bpm: 96, beatsPerBar: 4, countInBeats: 4, totalBeats: 8, mode: 'audible', timbre, accentDb: 5 });
    const countIn = clicks.filter((c) => c.countIn).map((c) => ({ t: c.t as number, accent: c.accent }));
    rc = new CountInRecheck(fb.sampleRate, countIn, { timbre, template, budget, silence: { t0: START, t1: countIn[0]!.t } });
    for (const m of pending) if (m.type === 'block' && rc.push(m.block)) posted++;
    await fb.run({ untilClock: START + 6 });
    return { result: rc.result ?? rc.finish(), posted };
  }

  it('measures the count-in RTL (Tick) within ±1 ms and posts once', async () => {
    const { result, posted } = await countInTake({ sampleRate: 48000, loopback: { rtlSec: 0.045, gainDb: -14 } }, 'tick', null);
    expect(posted).toBe(1);
    expect(result.accepted).toBe(true);
    expect(result.firstClickFound).toBe(true);
    expect(result.clicksFound).toBe(4);
    expect(Math.abs((result.rtlMs as number) - 45)).toBeLessThanOrEqual(1);
  });

  it('uses the fresh value when the stored one differs by more than 5 ms, and prompts recalibration above 10 ms', async () => {
    const { result } = await countInTake({ sampleRate: 48000, loopback: { rtlSec: 0.045, gainDb: -14 } }, 'tick', null);
    const fresh = decideRecheck(result, 37, budget);
    expect(fresh.recheck.status).toBe('measured');
    expect(fresh.recheck.usedFresh).toBe(true);
    expect(fresh.latencyMs).toBeCloseTo(result.rtlMs as number, 9);
    expect(fresh.recheck.promptRecalibrate).toBe(false);
    expect(fresh.markStale).toBe(false);

    const stale = decideRecheck(result, 30, budget);
    expect(stale.recheck.usedFresh).toBe(true);
    expect(stale.recheck.promptRecalibrate).toBe(true);
    expect(stale.markStale).toBe(true);

    const same = decideRecheck(result, 43, budget);
    expect(same.recheck.usedFresh).toBe(false);
    expect(same.latencyMs).toBe(43);

    // Boundaries: exactly 5 ms keeps the stored value; exactly 10 ms is not stale.
    const at = { firstClickFound: true, clicksFound: 4, rtlMs: 50, madMs: 0.5, accepted: true };
    expect(decideRecheck(at, 45, budget).recheck.usedFresh).toBe(false);
    expect(decideRecheck(at, 44.9, budget).recheck.usedFresh).toBe(true);
    expect(decideRecheck(at, 40, budget).markStale).toBe(false);
    expect(decideRecheck(at, 39.9, budget).markStale).toBe(true);
  });

  it('finds Wood count-in clicks by template correlation', async () => {
    const cal = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.052, gainDb: -14 } });
    const run = await runLoopbackCalibration(deps(cal), { route: route(cal), timbre: 'wood' });
    const tpl = run.calibration?.templates.wood?.samples ?? null;
    expect(tpl).not.toBeNull();
    const { result } = await countInTake({ sampleRate: 48000, loopback: { rtlSec: 0.058, gainDb: -14 } }, 'wood', tpl);
    expect(result.accepted).toBe(true);
    expect(Math.abs((result.rtlMs as number) - 58)).toBeLessThanOrEqual(1);
  });

  it('reports a missing first click (count-in restart) and an unmeasured recheck', async () => {
    // Drop the capture blocks around the first click's arrival (0.5 s lead + 45 ms).
    const first = Math.floor((0.545 * 48000) / 256);
    const dropSeqs = Array.from({ length: 9 }, (_, i) => first - 4 + i);
    const { result } = await countInTake({ sampleRate: 48000, loopback: { rtlSec: 0.045, gainDb: -14 }, dropSeqs }, 'tick', null);
    expect(result.firstClickFound).toBe(false);
    expect(result.clicksFound).toBe(3);
    expect(result.accepted).toBe(false);
    const d = decideRecheck(result, 40, budget);
    expect(d.recheck.status).toBe('unmeasured');
    expect(d.recheck.usedFresh).toBe(false);
    expect(d.latencyMs).toBe(40);

    const silent = await countInTake({ sampleRate: 48000 }, 'tick', null);
    expect(silent.result.clicksFound).toBe(0);
    expect(silent.result.rtlMs).toBeNull();
  });

  it('marks the stored calibration stale only when told to', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 } });
    const c = (await runLoopbackCalibration(deps(fb), { route: route(fb), timbre: 'tick' })).calibration;
    expect(c).not.toBeNull();
    if (!c) return;
    const at = { firstClickFound: true, clicksFound: 4, rtlMs: c.roundTripMs + 12, madMs: 0.5, accepted: true };
    expect(applyRecheckToCalibration(c, decideRecheck(at, c.roundTripMs, budget)).stale).toBe(true);
    const near = { ...at, rtlMs: c.roundTripMs + 2 };
    expect(applyRecheckToCalibration(c, decideRecheck(near, c.roundTripMs, budget))).toBe(c);
  });
});

describe('clock-rate check (01 §7.8, 05 W3)', () => {
  class DriftBackend extends FakeAudioBackend {
    error: number;
    constructor(error: number) {
      super({ sampleRate: 48000 });
      this.error = error;
    }
    override async measureClockRate(durSec: number): Promise<{ framesPerSec: number; expected: number }> {
      this.advance(durSec);
      return { framesPerSec: 48000 * (1 + this.error), expected: 48000 };
    }
  }

  it('passes an exact clock without recreating', async () => {
    let recreated = 0;
    const r = await runClockRateCheck(new DriftBackend(0.001), budget, { recreate: async () => void recreated++ });
    expect(r.state).toBe('ok');
    expect(recreated).toBe(0);
  });

  it('catches a clock 8.8% fast and recreates the context exactly once', async () => {
    const fb = new DriftBackend(0.088);
    let recreated = 0;
    const r = await runClockRateCheck(fb, budget, {
      recreate: async () => {
        recreated++;
        fb.error = 0;
      },
    });
    expect(recreated).toBe(1);
    expect(r.state).toBe('recreated-ok');
    expect(r.ok).toBe(true);
  });

  it('shows the error state after a second mismatch', async () => {
    let recreated = 0;
    const r = await runClockRateCheck(new DriftBackend(0.088), budget, { recreate: async () => void recreated++ });
    expect(recreated).toBe(1);
    expect(r.state).toBe('failed');
    expect(r.error).toBeCloseTo(0.088, 6);
  });

  it('reports a clock that could not be measured as unmeasured: not a failure, and nothing is recreated', async () => {
    let recreated = 0;
    const r = await runClockRateCheck(new DriftBackend(NaN), budget, { recreate: async () => void recreated++ });
    expect(r).toMatchObject({ ok: true, error: null, recreated: false, state: 'unmeasured' });
    expect(recreated).toBe(0);
    const own = Object.assign(new DriftBackend(0), {
      checkClockRate: async () => ({ ok: true, error: null, recreated: false, diagnostics: { inputDropFraction: 0.25 } }),
    });
    expect(await runClockRateCheck(own, budget)).toMatchObject({ ok: true, error: null, state: 'unmeasured', inputDropFraction: 0.25 });
  });

  it("uses the backend's own checkClockRate when it has one", async () => {
    const fb = Object.assign(new DriftBackend(0.088), {
      checkClockRate: async () => ({ ok: true, error: 0.001, recreated: true }),
    });
    const r = await runClockRateCheck(fb, budget);
    expect(r.state).toBe('recreated-ok');
  });
});

describe('audio self-test (01 §7.9, 04 §5.9 item 7)', () => {
  const caps = (fb: FakeAudioBackend): PlatformCapabilities => fb.capabilities;

  it('passes on a good speaker setup and exports no audio', async () => {
    const fb = new RoomBackend({ sampleRate: 48000, loopback: { rtlSec: 0.04, gainDb: -12 } }, {}, 40);
    const r = await runSelfTest(deps(fb), {
      route: route(fb),
      capabilities: caps(fb),
      timbre: 'tick',
      frameProbe: async () => ({ fps: 60, p95FrameMs: 17.5 }),
      appBuild: 'test',
    });
    expect(r.items.map((i) => [i.id, i.status])).toEqual([
      ['sanity-tone', 'pass'],
      ['clicks', 'pass'],
      ['recheck', 'pass'],
      ['clock-rate', 'pass'],
      ['processing', 'pass'],
      ['frame-rate', 'pass'],
    ]);
    expect(r.passed).toBe(true);
    expect(r.calibration?.method).toBe('loopback');
    expect(fb.log.scheduledTakes).toHaveLength(1);
    expect(fb.log.cancelledTakes).toBe(1);

    const text = exportDiagnostics(r.diagnostics);
    const parsed = JSON.parse(text) as unknown;
    // No audio: no long numeric arrays anywhere, no sample, template or device-label fields.
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) {
        expect(v.length, path).toBeLessThanOrEqual(16);
        expect(v.every((x) => typeof x !== 'number'), path).toBe(true);
        v.forEach((x, i) => walk(x, `${path}[${i}]`));
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          expect(/^samples$|template|lowband|hienergy|label|routekey/i.test(k), `${path}.${k}`).toBe(false);
          walk(x, `${path}.${k}`);
        }
      }
    };
    walk(parsed, '$');
    expect(text.length).toBeLessThan(4000);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(r.diagnostics)));
  });

  it('fails the processing item when the readback shows processing on, and skips speaker items on headphones', async () => {
    const fb = new RoomBackend({ sampleRate: 48000 });
    const r = await runSelfTest(deps(fb), {
      route: route(fb, { outputMode: 'wired', inputKind: 'wired', appliedProcessing: { echoCancellation: true, noiseSuppression: null, autoGainControl: false } }),
      capabilities: caps(fb),
      timbre: 'wood',
    });
    const status = Object.fromEntries(r.items.map((i) => [i.id, i.status]));
    expect(status).toEqual({ 'sanity-tone': 'skipped', clicks: 'skipped', recheck: 'skipped', 'clock-rate': 'pass', processing: 'fail', 'frame-rate': 'skipped' });
    expect(r.passed).toBe(false);
    expect(fb.log.calibrationClicks).toHaveLength(0);
  });

  it('fails clicks, tone and recheck when nothing is heard', async () => {
    const fb = new RoomBackend({ sampleRate: 48000 }, {}, 40);
    const r = await runSelfTest(deps(fb), { route: route(fb), capabilities: caps(fb), timbre: 'tick' });
    const status = Object.fromEntries(r.items.map((i) => [i.id, i.status]));
    expect(status['clicks']).toBe('fail');
    expect(status['sanity-tone']).toBe('fail');
    expect(status['recheck']).toBe('fail');
    expect(r.calibration).toBeNull();
  });
});
