/**
 * "How sure we are" (01-ux section 15.3): one level per try, from data the try already has. Pure; the thresholds come
 * from `config/grading-config.json` (`ui.sure`), never from here.
 */
import type { AttemptRecord, GradingConfig } from '../../../core/types.ts';

export type SureLevel = 'clear' | 'mostly' | 'unsure';
export type SureConfig = GradingConfig['ui']['sure'];

export interface SureFacts {
  /** Detected notes. */
  total: number;
  /** Notes whose confirming frames agree (steady and clear). */
  steady: number;
  /** Marks that changed after the try (`NoteJudgment.rejudged`). */
  changed: number;
}

export function sureFacts(record: Pick<AttemptRecord, 'detected' | 'judgments'>): SureFacts {
  return {
    total: record.detected.length,
    steady: record.detected.filter((d) => d.framesAgree).length,
    changed: record.judgments.filter((j) => j.rejudged).length,
  };
}

/** The level for the numbers. No detected notes is unsure: nothing was heard to be sure about. */
export function sureLevelOf(f: SureFacts, cfg: SureConfig): SureLevel {
  if (f.total === 0) return 'unsure';
  const agree = f.steady / f.total;
  if (agree >= cfg.clearAgree && f.changed <= cfg.clearMaxChanged) return 'clear';
  if (agree >= cfg.mostlyAgree && f.changed <= cfg.mostlyMaxChanged) return 'mostly';
  return 'unsure';
}

/** Clear: at least `clearAgree` agree and at most `clearMaxChanged` changed. Mostly: at least `mostlyAgree` and at most `mostlyMaxChanged`. Else unsure. */
export function sureLevel(record: Pick<AttemptRecord, 'detected' | 'judgments'>, cfg: SureConfig): SureLevel {
  return sureLevelOf(sureFacts(record), cfg);
}
