/** Test data for the results and sheets tests: real grade() output over fixtures/grade, wrapped in an AttemptRecord. Not shipped. */
import { readFileSync } from 'node:fs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AttemptRecord, Configs, GradeFixture, PlayerProfile, Tip } from '../../../core/types.ts';
import { join } from 'node:path';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { gradeWithPatterns } from '../../../grade/index.ts';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { loadConfigs, resolveTolerances } from '../../../rules/index.ts';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { selectTips } from '../../../tips/index.ts';
import { initialSessionView, type SessionView } from '../../../session/index.ts';
import { makeAttempt, makeProfile } from '../../../store/test-data.ts';

const read = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as unknown;
export const cfg: Configs = loadConfigs({
  grading: read('config/grading-config.json'),
  levels: read('config/levels.json'),
  instruments: read('config/instruments.json'),
  progression: read('config/progression.json'),
  tips: read('config/tips.json'),
  budget: read('config/measurement-budget.json'),
  trumpetValves: read('data/trumpet-valves.json'),
} as never);

export function readFixture(id: string): GradeFixture {
  return read(`fixtures/grade/${id}.json`) as GradeFixture;
}

/** An attempt whose score is the real grade() output for the fixture. */
export function attemptFrom(id: string, over: Partial<AttemptRecord> = {}): AttemptRecord {
  const fx = readFixture(id);
  const instrument = cfg.instrumentById[fx.instrumentId]!;
  const tolerances = resolveTolerances(fx.input.expected, { instrument, level: fx.input.level, bpm: fx.input.bpm, meter: fx.input.meter }, cfg);
  const score = gradeWithPatterns({ ...fx.input, instrument, cfg, tolerances });
  return makeAttempt(1, {
    id: `attempt-${id}`,
    instrumentId: fx.instrumentId,
    levelServed: fx.input.level,
    bpm: fx.input.bpm,
    judgments: fx.input.alignment.judgments,
    score,
    endReason: score.status === 'incomplete' ? 'complete' : 'complete',
    calibration: { method: 'loopback', latencyCompensationMs: 40, outputMode: 'speakers', recheck: null },
    ...over,
  });
}

export function tipsFor(record: AttemptRecord): Tip[] {
  const score = record.score!;
  return selectTips({
    patterns: score.patterns,
    instrument: cfg.instrumentById[record.instrumentId]!,
    level: record.levelServed,
    recentTipIds: [],
    recentPrimaries: [],
    catalog: cfg.tips,
  });
}

export function sessionStore(over: Partial<SessionView> = {}): StoreApi<SessionView> {
  return createStore<SessionView>()(() => ({ ...initialSessionView(), state: 'results', ...over }));
}

export { makeProfile };
export type { PlayerProfile };
