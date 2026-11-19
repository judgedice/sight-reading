/** Range pictures and the difficulty row for onboarding, from the shared range and setup models. */
import type { Configs, Instrument } from '../../../core/types.ts';
import { keyboardSpan, pictureNotes, rangeModel, staffPlan } from '../../../instruments/range.ts';
import { defaultAppSettings } from '../../../store/index.ts';
import type { RangeData } from '../../../ui/components/range/index.ts';
import type { DifficultyRowView } from '../../../ui/components/setup/index.ts';
import { setupModel, type EligibleFn } from '../setup/model.ts';

/** The difficulty onboarding shows on the picker page (05 section 6.4). */
export const START_DIFFICULTY = 2;

export function rangeData(cfg: Configs, inst: Instrument, level: number): RangeData {
  const model = rangeModel(cfg, inst, level);
  return { model, staff: staffPlan(inst, pictureNotes(model)), keyboard: keyboardSpan(model, inst) };
}

/** Until the app reports eligible counts, every difficulty counts as served with plenty of music. */
export const assumeServed: EligibleFn = () => 99;

/** The difficulty row for one instrument and level, without "Follow my progress" (the control hides the switch). */
export function difficultyRowFor(cfg: Configs, instrumentId: string, level: number, eligible: EligibleFn, description: string): DifficultyRowView {
  const practice = { ...defaultAppSettings().practice, instrumentId, level };
  const model = setupModel(practice, { cfg, eligible, showBeta: true, playerLevel: () => level });
  return { ...model.difficulty, description };
}
