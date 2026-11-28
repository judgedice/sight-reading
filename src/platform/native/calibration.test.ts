// Native calibration rules that are plain numbers (AUDIO-DESIGN section 5): predicted latency, the 2 ms staleness test
// and the loopback pre-check. The service around them is tested in src/app/compose/native-calibration.test.ts.
import { describe, expect, it } from 'vitest';
import { CROSS_CHECK_MS, nativeLatencyKey, NATIVE_SHORT_GAP_SEC, precheckPasses, predictedMoved, predictedMsOf, PRECHECK, STALE_PREDICTED_MS } from './calibration.ts';

describe('predicted latency', () => {
  it('is output plus input in ms, and null when either side is unknown', () => {
    expect(predictedMsOf({ outputSec: 0.025, inputSec: 0.01 })).toBeCloseTo(35, 9);
    expect(predictedMsOf({ outputSec: 0.025, inputSec: null })).toBeNull();
    expect(predictedMsOf({ outputSec: null, inputSec: 0.01 })).toBeNull();
    expect(predictedMsOf(null)).toBeNull();
  });

  it('counts as moved only beyond 2 ms, and never against a null', () => {
    expect(STALE_PREDICTED_MS).toBe(2);
    expect(predictedMoved(35, 37.1)).toBe(true);
    expect(predictedMoved(35, 32.9)).toBe(true);
    expect(predictedMoved(35, 36.9)).toBe(false);
    expect(predictedMoved(35, 33.1)).toBe(false);
    expect(predictedMoved(35, 37)).toBe(false);
    expect(predictedMoved(35, null)).toBe(false);
    expect(predictedMoved(null, 35)).toBe(false);
    expect(predictedMoved(null, null)).toBe(false);
  });
});

describe('loopback pre-check (rule 3)', () => {
  const ok = { found: 8, roundTripMs: 40, madMs: 0.2 };
  it('passes on at least 7 of 8, MAD at most 0.5 ms and a round trip under 100 ms', () => {
    expect(PRECHECK).toEqual({ minFound: 7, maxMadMs: 0.5, maxRoundTripMs: 100 });
    expect(precheckPasses(ok)).toBe(true);
    expect(precheckPasses({ ...ok, found: 7 })).toBe(true);
    expect(precheckPasses({ ...ok, madMs: 0.5 })).toBe(true);
    expect(precheckPasses({ ...ok, roundTripMs: 99.9 })).toBe(true);
  });
  it('fails on any one of them, and on nothing measured', () => {
    expect(precheckPasses({ ...ok, found: 6 })).toBe(false);
    expect(precheckPasses({ ...ok, madMs: 0.51 })).toBe(false);
    expect(precheckPasses({ ...ok, roundTripMs: 100 })).toBe(false);
    expect(precheckPasses({ found: 8, roundTripMs: null, madMs: null })).toBe(false);
    expect(precheckPasses({ found: 8, roundTripMs: 40, madMs: null })).toBe(false);
  });
  it('names its constants as the design does', () => {
    expect(CROSS_CHECK_MS).toBe(1.5);
    expect(NATIVE_SHORT_GAP_SEC).toEqual([0.2, 0.35]);
    expect(nativeLatencyKey('r-1')).toBe('native:latency:r-1');
  });
});
