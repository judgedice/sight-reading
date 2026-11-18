/** The app's configs, parsed once from config/ (01 §5.3: one resolver for the follower, renderer and grader). */
import type { Configs, RawConfigs } from '../../core/types.ts';
// eslint-disable-next-line boundaries/dependencies -- composition root (01 §4.2)
import { loadConfigs } from '../../rules/index.ts';
import gradingJson from '../../../config/grading-config.json';
import instrumentsJson from '../../../config/instruments.json';
import levelsJson from '../../../config/levels.json';
import budgetJson from '../../../config/measurement-budget.json';
import progressionJson from '../../../config/progression.json';
import tipsJson from '../../../config/tips.json';
import valvesJson from '../../../data/trumpet-valves.json';

let cached: Configs | null = null;

export function appConfigs(): Configs {
  cached ??= loadConfigs({
    grading: gradingJson,
    levels: levelsJson,
    instruments: instrumentsJson,
    progression: progressionJson,
    tips: tipsJson,
    budget: budgetJson,
    trumpetValves: valvesJson,
  } as unknown as RawConfigs);
  return cached;
}
