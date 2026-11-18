// P10b acceptance (01 §15 row P10b, PLAN R34/R35): every follow fixture's final predicates hold on `finalAlign`
// over the detected notes of its stream, the displaced segments of the restart and skip fixtures come out of the
// relabel pass, and the live outcome `finalAlign` rebuilds from the detected notes equals the one the live follower
// streamed (so `rejudged` means the same either way).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FollowerEvent, FollowFixture, RenderStreamLine } from '../core/types.ts';
import { makeMeter } from '../core/time.ts';
import { configs, corpusDoc } from '../../fixtures/follow/gen/io.ts';
import { resolveTolerances } from '../rules/index.ts';
import { beatsPerBarOf, checkPredicates, finalDetected, finalSubject, followConfigFor, formatFailures, runFollowStream, streamViolations } from '../testkit/predicates/index.ts';
import { FOLLOW_SCENARIOS } from '../../tools/bare-runtime/follow-scenarios.ts';
import { alignFinal, finalAlign, LiveFollower, liveOutcomeOf, replayLive } from './index.ts';

const dir = new URL('../../fixtures/follow/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as FollowFixture] as const);

function setup(fx: FollowFixture) {
  const cfg = configs();
  const instrument = cfg.instrumentById[fx.instrumentId]!;
  const meter = corpusDoc(fx.excerptId).meter;
  const tolerances = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter }, cfg);
  return followConfigFor(fx, instrument, cfg, tolerances);
}

describe('finalAlign on fixtures/follow (expectFinal)', () => {
  it.each(fixtures)('%s', (_f, fx) => {
    const config = setup(fx);
    const final = finalAlign(config, finalDetected(fx.stream));
    const fails = checkPredicates(finalSubject(final), fx.expectFinal);
    expect(fails, `final:\n${formatFailures(fails)}`).toEqual([]);
    expect(final.judgments.map((j) => j.expectedIdx)).toEqual(fx.expected.map((e) => e.idx));
  });

  it.each(fixtures)('%s: the rebuilt live outcome equals the streamed one', (_f, fx) => {
    const config = setup(fx);
    const events = runFollowStream(fx.stream, new LiveFollower(config));
    const detected = finalDetected(fx.stream);
    const streamed = liveOutcomeOf(events);
    expect([...replayLive(config, detected).entries()].sort((a, b) => a[0] - b[0])).toEqual([...streamed.entries()].sort((a, b) => a[0] - b[0]));
    expect(JSON.stringify(alignFinal(config, detected, streamed))).toBe(JSON.stringify(finalAlign(config, detected)));
  });

  it.each(fixtures)('%s: a final event after the live stream keeps 01 §9.9 / §9.7 invariants', (_f, fx) => {
    const config = setup(fx);
    const events = runFollowStream(fx.stream, new LiveFollower(config));
    const final = alignFinal(config, finalDetected(fx.stream), liveOutcomeOf(events));
    const all: FollowerEvent[] = [...events, { type: 'final', alignment: final }];
    const header: RenderStreamLine = { kind: 'header', schemaVersion: 1, excerptId: fx.excerptId, instrumentId: fx.instrumentId, writtenKey: { fifths: 0, mode: 'major' }, bpm: fx.bpm, level: fx.level, description: '' };
    const lines: RenderStreamLine[] = [header, ...all.map((event): RenderStreamLine => ({ kind: 'event', atMs: 0, event }))];
    expect(streamViolations(lines, all, fx.expected.length)).toEqual([]);
  });

  it.each(fixtures)('%s: deterministic, and the bare-runtime meter reading matches the corpus', (_f, fx) => {
    const config = setup(fx);
    const d = finalDetected(fx.stream);
    expect(JSON.stringify(finalAlign(config, d))).toBe(JSON.stringify(finalAlign(config, d)));
    const m = corpusDoc(fx.excerptId).meter;
    expect(makeMeter(beatsPerBarOf(fx.expected), m.beatType)).toEqual(m);
    expect(m.beatType).toBe(4);
  });

  it('the bare-runtime follow scenarios compute the same alignments (02 §4.9 case 15)', () => {
    expect(FOLLOW_SCENARIOS.map((s) => s.id)).toEqual(fixtures.map(([, fx]) => `follow-${fx.id}`));
    for (const [k, [, fx]] of fixtures.entries()) {
      expect(JSON.stringify(FOLLOW_SCENARIOS[k]!.run())).toBe(JSON.stringify(finalAlign(setup(fx), finalDetected(fx.stream))));
    }
  });
});
