/** Range pictures for onboarding, from the shared range model. */
import type { Configs, Instrument } from '../../../core/types.ts';
import { keyboardSpan, pictureNotes, rangeModel, staffPlan } from '../../../instruments/range.ts';
import type { RangeData } from '../../../ui/components/range/index.ts';

/** Everyone starts at difficulty 1 (round 3, R75): the picker shows that range. */
export const START_DIFFICULTY = 1;

export function rangeData(cfg: Configs, inst: Instrument, level: number): RangeData {
  const model = rangeModel(cfg, inst, level);
  return { model, staff: staffPlan(inst, pictureNotes(model)), keyboard: keyboardSpan(model, inst) };
}
