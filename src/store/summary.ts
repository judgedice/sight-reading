import type { AttemptRecord, AttemptSummary } from '../core/types.ts';

/** The history row for an attempt (04 history). */
export function summarizeAttempt(a: AttemptRecord): AttemptSummary {
  const credit = a.credit;
  return {
    id: a.id,
    createdAt: a.createdAt,
    excerptId: a.excerptId,
    instrumentId: a.instrumentId,
    levelServed: a.levelServed,
    ranked: a.score?.ranked ?? false,
    endReason: a.endReason,
    score: a.score?.score ?? null,
    grade: a.score?.grade ?? null,
    xp: a.score?.xp.total ?? 0,
    title: credit.movement ? `${credit.work}: ${credit.movement}` : credit.work,
    composer: credit.composer,
    // A scale try (PLAN ruling 68): the screens name it from `scale`, never from the credit.
    ...(a.kind === 'scale' && a.scale ? { kind: 'scale' as const, scale: a.scale } : {}),
  };
}
