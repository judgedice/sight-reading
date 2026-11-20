// The calibration status (round 2, R2-03): the four states, agreement with Ranked availability over a generated
// table, and the old behaviour of causes 2 to 4 beside the fix.
import { describe, expect, it } from 'vitest';
import type { Calibration, OutputMode } from '../../core/types.ts';
import { rankedAvailability } from '../../session/gates/index.ts';
import { makeCalibration } from '../../store/test-data.ts';
import { calibrationStatus, recheckShiftApplies, type CalFailure, type CalStatusFacts } from './calibration-status.ts';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const localDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const facts = (over: Partial<CalStatusFacts> = {}): CalStatusFacts => ({ calibrations: [], routeKey: 'r-a', outputMode: 'speakers', lastFailure: null, now: NOW, localDay, ...over });
const cal = (over: Partial<Calibration> = {}): Calibration => ({ ...makeCalibration('r-a'), measuredAt: '2026-11-18T09:00:00.000Z', ...over });
const failure: CalFailure = { at: '2026-11-18T14:00:00.000Z', method: 'loopback', reason: 'calibrate.fail.loopback.spread' };

describe('the four states (01-ux §4)', () => {
  it('ok: a measured, current calibration for this route, with output, day and delay', () => {
    expect(calibrationStatus(facts({ calibrations: [cal({ roundTripMs: 80.4 })] }))).toMatchObject({ state: 'ok', output: 'speakers', oldOutput: null, when: 'today', ms: 80, reason: null });
  });

  it('ok: when reads today, yesterday, or a date', () => {
    const at = (iso: string) => calibrationStatus(facts({ calibrations: [cal({ measuredAt: iso })] })).when;
    expect(at('2026-11-18T01:00:00.000Z')).toBe('today');
    expect(at('2026-11-17T20:00:00.000Z')).toBe('yesterday');
    expect(at('2026-10-02T20:00:00.000Z')).toEqual({ date: '2026-10-02' });
    expect(at('not a date')).toEqual({ date: 'not a date' });
  });

  it('none: nothing stored', () => {
    expect(calibrationStatus(facts())).toMatchObject({ state: 'none', output: null, when: null, ms: null, reason: null });
  });

  it('none: a reported estimate is not a calibration', () => {
    expect(calibrationStatus(facts({ calibrations: [cal({ method: 'reported' })] })).state).toBe('none');
  });

  it('changed: a measured one exists for another route or output, or is stale', () => {
    expect(calibrationStatus(facts({ calibrations: [cal({ routeKey: 'r-old', outputMode: 'wired' })] }))).toMatchObject({ state: 'changed', output: 'speakers', oldOutput: 'wired' });
    expect(calibrationStatus(facts({ calibrations: [cal({ stale: true })] })).state).toBe('changed');
  });

  it('changed names the newest earlier calibration', () => {
    const s = calibrationStatus(
      facts({ calibrations: [cal({ routeKey: 'r-1', outputMode: 'wired', measuredAt: '2026-11-01T00:00:00Z' }), cal({ routeKey: 'r-2', outputMode: 'bluetooth', measuredAt: '2026-11-10T00:00:00Z' })] }),
    );
    expect(s.oldOutput).toBe('bluetooth');
  });

  it('failed: the last run failed and nothing is stored for this route; the reason is the copy key', () => {
    expect(calibrationStatus(facts({ lastFailure: { ...failure, vars: { found: 3, total: 10 } } }))).toMatchObject({ state: 'failed', reason: 'calibrate.fail.loopback.spread', reasonVars: { found: 3, total: 10 } });
    expect(calibrationStatus(facts({ lastFailure: failure, calibrations: [cal({ routeKey: 'r-old' })] })).state).toBe('failed');
  });

  it('a stored calibration for this route beats a leftover failure (the run that stored it clears the key)', () => {
    expect(calibrationStatus(facts({ lastFailure: failure, calibrations: [cal()] })).state).toBe('ok');
  });

  it('with the route unknown, any measured calibration for the chosen output counts', () => {
    expect(calibrationStatus(facts({ routeKey: null, calibrations: [cal({ routeKey: 'r-z' })] })).state).toBe('ok');
    expect(calibrationStatus(facts({ routeKey: null, outputMode: 'wired', calibrations: [cal({ routeKey: 'r-z' })] })).state).toBe('changed');
  });
});

describe('one source of truth: ok exactly when Ranked is not blocked on calibration', () => {
  it('holds over every combination of calibrations, routes and output modes', () => {
    const modes: OutputMode[] = ['speakers', 'wired', 'bluetooth'];
    const routes = ['r-a', 'r-b'];
    const variants: Partial<Calibration>[] = [];
    for (const method of ['loopback', 'play-along', 'reported'] as const)
      for (const stale of [false, true])
        for (const outputMode of modes)
          for (const routeKey of routes) variants.push({ method, stale, outputMode, routeKey });
    const sets: Calibration[][] = [[]];
    for (const v of variants) sets.push([cal(v)]);
    for (let i = 0; i < variants.length; i += 5) sets.push([cal(variants[i]), cal(variants[(i * 7 + 3) % variants.length])]);
    let n = 0;
    let ok = 0;
    for (const calibrations of sets)
      for (const routeKey of [null, ...routes, 'r-never'])
        for (const outputMode of modes)
          for (const lastFailure of [null, failure]) {
            const f = facts({ calibrations, routeKey, outputMode, lastFailure });
            const s = calibrationStatus(f);
            const r = rankedAvailability({ routeKey, outputMode, calibrations, listening: true, permission: 'granted' });
            expect(s.state === 'ok', JSON.stringify({ calibrations, routeKey, outputMode })).toBe(r.block !== 'calibration');
            n++;
            if (s.state === 'ok') ok++;
          }
    expect(n).toBeGreaterThan(1000);
    expect(ok).toBeGreaterThan(100);
    expect(ok).toBeLessThan(n);
  });
});

/** The banner's old test, as `app-services.ts` had it: any stored calibration that is not `reported`. */
const oldBannerWouldShow = (calibrations: readonly Calibration[], dismissed: boolean): boolean => !calibrations.some((c) => c.method !== 'reported') && !dismissed;

describe('cause 2: dismissing lasted one page load', () => {
  it('old behaviour: the dismissal was in memory, so a reload brought the banner back', () => {
    let dismissed = false;
    dismissed = true;
    expect(oldBannerWouldShow([], dismissed)).toBe(false);
    dismissed = false; // page reload: createValue([]) starts empty again
    expect(oldBannerWouldShow([], dismissed)).toBe(true);
  });

  it('fix: there is no banner and no dismissal; the status is derived from stored facts, so a reload gives the same answer', () => {
    const f = facts();
    expect(calibrationStatus(f)).toEqual(calibrationStatus({ ...f }));
    expect(Object.keys(f)).not.toContain('dismissed');
  });
});

describe('cause 3: the banner and Ranked used different tests', () => {
  it('old behaviour: with a calibration for another output, the banner stayed quiet while Ranked was blocked', () => {
    const calibrations = [cal({ routeKey: 'r-old', outputMode: 'wired' })];
    expect(oldBannerWouldShow(calibrations, false)).toBe(false);
    expect(rankedAvailability({ routeKey: 'r-a', outputMode: 'speakers', calibrations, listening: true, permission: 'granted' }).block).toBe('calibration');
  });

  it('old behaviour, the reverse: a stale calibration also kept the banner quiet', () => {
    const calibrations = [cal({ stale: true })];
    expect(oldBannerWouldShow(calibrations, false)).toBe(false);
    expect(rankedAvailability({ routeKey: 'r-a', outputMode: 'speakers', calibrations, listening: true, permission: 'granted' }).block).toBe('calibration');
  });

  it('fix: the status is not ok in those cases, and says why (changed)', () => {
    expect(calibrationStatus(facts({ calibrations: [cal({ routeKey: 'r-old', outputMode: 'wired' })] })).state).toBe('changed');
    expect(calibrationStatus(facts({ calibrations: [cal({ stale: true })] })).state).toBe('changed');
  });
});

describe('cause 4: the recheck-shift line with nothing to compare', () => {
  const recheck = { promptRecalibrate: true };
  it('old behaviour: promptRecalibrate alone showed the line, whatever the try was calibrated with', () => {
    // ResultsPanel: `recalibrate || record.calibration.recheck?.promptRecalibrate`, with no look at `calibration.method`.
    const oldShows = (c: { method: string; recheck: { promptRecalibrate: boolean } | null }): boolean => c.recheck?.promptRecalibrate === true;
    expect(oldShows({ method: 'none', recheck })).toBe(true);
    expect(oldShows({ method: 'reported', recheck })).toBe(true);
  });

  it('fix: the line shows only for a try that had a measured calibration', () => {
    expect(recheckShiftApplies({ method: 'none', recheck })).toBe(false);
    expect(recheckShiftApplies({ method: 'reported', recheck })).toBe(false);
    expect(recheckShiftApplies({ method: 'loopback', recheck })).toBe(true);
    expect(recheckShiftApplies({ method: 'play-along', recheck })).toBe(true);
    expect(recheckShiftApplies({ method: 'loopback', recheck: { promptRecalibrate: false } })).toBe(false);
    expect(recheckShiftApplies({ method: 'loopback', recheck: null })).toBe(false);
  });
});
