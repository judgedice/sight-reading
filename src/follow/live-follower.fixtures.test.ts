// P10a acceptance: every follow fixture's live predicates hold on the product LiveFollower (01 §14 item 9, PLAN
// R34/R35), and the live stream keeps 01 §9.9's structural contract (order per note, timing final at onset,
// idempotence). Final predicates (`expectFinal`) are P10b's.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FollowFixture } from '../core/types.ts';
import { configs, corpusDoc } from '../../fixtures/follow/gen/io.ts';
import { resolveTolerances } from '../rules/index.ts';
import { checkPredicates, followConfigFor, formatFailures, liveSubject, runFollowStream, streamViolations } from '../testkit/predicates/index.ts';
import { LiveFollower } from './index.ts';

const dir = new URL('../../fixtures/follow/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as FollowFixture] as const);

function runFixture(fx: FollowFixture) {
  const cfg = configs();
  const instrument = cfg.instrumentById[fx.instrumentId]!;
  const meter = corpusDoc(fx.excerptId).meter;
  const tolerances = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter }, cfg);
  const config = followConfigFor(fx, instrument, cfg, tolerances);
  const events = runFollowStream(fx.stream, new LiveFollower(config));
  return { config, events };
}

describe('LiveFollower on fixtures/follow (expectLive)', () => {
  it('finds the fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  it.each(fixtures)('%s', (_f, fx) => {
    const { events } = runFixture(fx);
    const fails = checkPredicates(liveSubject(events, fx.expected.length), fx.expectLive);
    expect(fails, `live:\n${formatFailures(fails)}`).toEqual([]);
    expect(streamViolations(null, events, fx.expected.length)).toEqual([]);
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1);
  });

  it.each(fixtures)('%s: deterministic (same events on a second run)', (_f, fx) => {
    expect(JSON.stringify(runFixture(fx).events)).toBe(JSON.stringify(runFixture(fx).events));
  });
});
