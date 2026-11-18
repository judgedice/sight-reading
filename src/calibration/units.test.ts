import { describe, expect, it } from 'vitest';
import budgetJson from '../../config/measurement-budget.json';
import gradingJson from '../../config/grading-config.json';
import type { ClockSeconds } from '../core/platform.ts';
import type { Calibration, GradingConfig, MeasurementBudget } from '../core/types.ts';
import {
  calibrationFlow,
  calibrationQualityOk,
  CaptureRecording,
  firstMethod,
  isMeasuredFor,
  mad,
  median,
  playAlongMinNotes,
  reportedCalibration,
  rtlHigh,
  staleOnRouteChange,
  UNREPORTED_ESTIMATE_MS,
} from './index.ts';

const budget = (budgetJson as unknown as MeasurementBudget).calibration;
const maxRtlMs = (gradingJson as unknown as GradingConfig).ranked.maxRtlMs;

const cal = (patch: Partial<Calibration> = {}): Calibration => ({
  routeKey: 'r1',
  platform: 'web',
  outputMode: 'speakers',
  method: 'loopback',
  roundTripMs: 40,
  spreadMs: 0.5,
  clicksDetected: 10,
  clickLeakDb: -60,
  noiseFloorDb: -90,
  templates: {},
  sanityToneCents: 0.4,
  aecSuspected: false,
  clockRateError: 0,
  measuredAt: '2026-11-18T00:00:00.000Z',
  stale: false,
  ...patch,
});

describe('stats', () => {
  it('median and MAD', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('CaptureRecording timing', () => {
  for (const rate of [48000, 44100, 16000, 96000]) {
    it(`maps low-band samples and hi-band sub-blocks to clock time at ${rate} Hz`, () => {
      const D = Math.max(1, Math.round(rate / 16000));
      const origin = 12.25;
      const rec = new CaptureRecording(rate);
      let hiCount = 0;
      for (let seq = 0; seq < 40; seq++) {
        const first = Math.ceil((256 * seq) / D) * D;
        const next = Math.ceil((256 * (seq + 1)) / D) * D;
        const nLow = (next - first) / D;
        const hiEnd = Math.floor((256 * (seq + 1) * 1000) / rate);
        const nHi = hiEnd - hiCount;
        hiCount = hiEnd;
        rec.push({
          v: 1,
          startT: (origin + first / rate) as ClockSeconds,
          lowband: new Float32Array(nLow).fill(seq),
          hiEnergy: new Float32Array(nHi).fill(seq),
          analysisRate: rate / D,
          seq,
        });
      }
      expect(rec.origin).toBeCloseTo(origin, 12);
      // Low-band sample j is input frame j D.
      const j = 1000;
      expect(rec.lowTime(j)).toBeCloseTo(origin + (j * D) / rate, 12);
      expect(rec.lowband[j]).toBe(Math.floor((j * D) / 256));
      // Hi-band sub-block k starts at frame ceil(k rate / 1000).
      const k = 37;
      expect(rec.hiStart(k)).toBeCloseTo(origin + Math.ceil((k * rate) / 1000) / rate, 12);
      expect(rec.hiIndexAt(rec.hiStart(k))).toBe(k);
      expect(rec.hiIndexAt(rec.hiStart(k) + 0.0009)).toBe(k);
      expect(rec.hiEnergy.length).toBe(hiCount);
    });
  }

  it('counts missing blocks and keeps later blocks in place', () => {
    const rec = new CaptureRecording(48000);
    for (const seq of [0, 1, 4]) {
      rec.push({ v: 1, startT: (seq * 256) / 48000 as ClockSeconds, lowband: new Float32Array(86 - (seq % 3 === 2 ? 1 : 0)).fill(1), hiEnergy: new Float32Array(5).fill(1), analysisRate: 16000, seq });
    }
    expect(rec.missingBlocks).toBe(2);
    expect(rec.lowband[Math.ceil((4 * 256) / 3)]).toBe(1);
    expect(rec.lowband[Math.ceil((2 * 256) / 3) + 1]).toBe(0);
  });

  it('rejects a block at another analysis rate', () => {
    const rec = new CaptureRecording(48000);
    expect(() => rec.push({ v: 1, startT: 0 as ClockSeconds, lowband: new Float32Array(4), hiEnergy: new Float32Array(1), analysisRate: 14700, seq: 0 })).toThrow(RangeError);
  });
});

describe('records and rules', () => {
  it('reported calibration: base + output latency + 10 ms, the estimate when unreported; never measured', () => {
    const r = reportedCalibration({ routeKey: 'r1', outputMode: 'speakers', reportedLatencySec: 0.025 }, 'web', budget, 'x');
    expect(r.method).toBe('reported');
    expect(r.roundTripMs).toBeCloseTo(25 + budget.reportedExtraMs, 9);
    expect(r.outputLatencyMs).toBeCloseTo(25, 9);
    expect(isMeasuredFor(r, 'r1')).toBe(false);
    const u = reportedCalibration({ routeKey: 'r1', outputMode: 'speakers' }, 'web', budget, 'x');
    expect(u.roundTripMs).toBe(UNREPORTED_ESTIMATE_MS);
    expect(u.outputLatencyMs).toBeUndefined();
  });

  it('measured means loopback or play-along, this route, not stale (05 W6)', () => {
    expect(isMeasuredFor(cal(), 'r1')).toBe(true);
    expect(isMeasuredFor(cal({ method: 'play-along' }), 'r1')).toBe(true);
    expect(isMeasuredFor(cal(), 'r2')).toBe(false);
    expect(isMeasuredFor(cal({ stale: true }), 'r1')).toBe(false);
    expect(isMeasuredFor(undefined, 'r1')).toBe(false);
  });

  it('quality follows 01 §7.8 acceptance at its boundaries', () => {
    const lb = budget.loopback;
    expect(calibrationQualityOk(cal({ spreadMs: lb.maxMadMs }), budget)).toBe(true);
    expect(calibrationQualityOk(cal({ spreadMs: lb.maxMadMs + 0.01 }), budget)).toBe(false);
    expect(calibrationQualityOk(cal({ clicksDetected: lb.minFound - 1 }), budget)).toBe(false);
    expect(calibrationQualityOk(cal({ roundTripMs: lb.minRtlMs - 0.1 }), budget)).toBe(false);
    expect(calibrationQualityOk(cal({ method: 'play-along', spreadMs: budget.playAlong.maxMadMs }), budget)).toBe(true);
    expect(calibrationQualityOk(cal({ method: 'play-along', spreadMs: budget.playAlong.maxMadMs + 0.01 }), budget)).toBe(false);
    expect(calibrationQualityOk(cal({ method: 'reported' }), budget)).toBe(false);
    expect(playAlongMinNotes(budget)).toBe(6);
  });

  it('W8: a 150 ms calibration is above the ranked RTL ceiling', () => {
    expect(rtlHigh(cal({ roundTripMs: 150 }), maxRtlMs)).toBe(true);
    expect(rtlHigh(cal({ roundTripMs: maxRtlMs }), maxRtlMs)).toBe(false);
  });

  it('W7: a route change marks the old route calibration stale once', () => {
    const c = cal();
    expect(staleOnRouteChange(c, 'r1', 'r2')?.stale).toBe(true);
    expect(staleOnRouteChange(c, 'r1', 'r1')).toBeNull();
    expect(staleOnRouteChange(cal({ stale: true }), 'r1', 'r2')).toBeNull();
    expect(staleOnRouteChange(undefined, 'r1', 'r2')).toBeNull();
  });

  it('starts with loopback on speakers and play-along in headphone modes', () => {
    expect(firstMethod('speakers')).toBe('loopback');
    expect(firstMethod('wired')).toBe('play-along');
    expect(firstMethod('bluetooth')).toBe('play-along');
  });

  it('W6 flow: no Skip without reported latency; the estimate only after both methods failed twice', () => {
    const ios = { outputLatencyReported: false };
    const desk = { outputLatencyReported: true };
    const s = (loopbackFailures: number, playAlongFailures: number, outputMode: 'speakers' | 'wired' = 'speakers') => ({ outputMode, loopbackFailures, playAlongFailures });
    expect(calibrationFlow(s(0, 0), ios)).toEqual({ showSkip: false, offerLoopback: true, offerPlayAlong: false, offerEstimate: false });
    expect(calibrationFlow(s(0, 0), desk).showSkip).toBe(true);
    expect(calibrationFlow(s(1, 0), ios).offerPlayAlong).toBe(true);
    expect(calibrationFlow(s(1, 2), ios).offerEstimate).toBe(false);
    expect(calibrationFlow(s(2, 2), ios).offerEstimate).toBe(true);
    expect(calibrationFlow(s(0, 2, 'wired'), ios).offerEstimate).toBe(true);
    expect(calibrationFlow(s(0, 1, 'wired'), ios)).toEqual({ showSkip: false, offerLoopback: false, offerPlayAlong: true, offerEstimate: false });
    expect(calibrationFlow(s(1, 2), desk).offerEstimate).toBe(true);
  });
});
