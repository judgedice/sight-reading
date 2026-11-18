// Grade scenarios for the bare-runtime job (02 §4.9 case 15): grade() over every fixtures/grade input, in the
// ES2022-only context and under Node, must give byte-identical results. JSON is bundled by esbuild, so nothing here
// touches fs.
import type { Configs, GradeFixture, RawConfigs } from '../../src/core/types.ts';
import { grade } from '../../src/grade/grade.ts';
import { loadConfigs, resolveTolerances } from '../../src/rules/index.ts';
import gradingRaw from '../../config/grading-config.json';
import levelsRaw from '../../config/levels.json';
import instrumentsRaw from '../../config/instruments.json';
import progressionRaw from '../../config/progression.json';
import tipsRaw from '../../config/tips.json';
import budgetRaw from '../../config/measurement-budget.json';
import valvesRaw from '../../data/trumpet-valves.json';

import fx00 from '../../fixtures/grade/case01-perfect-flute-l4.json';
import fx01 from '../../fixtures/grade/case01-perfect-voice-l2.json';
import fx02 from '../../fixtures/grade/case02-late-30ms-l1.json';
import fx03 from '../../fixtures/grade/case03-late-by-tbad.json';
import fx04 from '../../fixtures/grade/case04-drift-0.05.json';
import fx05 from '../../fixtures/grade/case04-drift-0.15.json';
import fx06 from '../../fixtures/grade/case05-key-signature-f-sharp.json';
import fx07 from '../../fixtures/grade/case06-stop-2-beats-bar-5.json';
import fx08 from '../../fixtures/grade/case06-variant-skip-and-rejoin.json';
import fx09 from '../../fixtures/grade/case07-voice-30c-flat.json';
import fx10 from '../../fixtures/grade/case08-voice-octave-low.json';
import fx11 from '../../fixtures/grade/case09-trumpet-wrong-partial.json';
import fx12 from '../../fixtures/grade/case10-incomplete.json';
import fx13 from '../../fixtures/grade/case11-restart.json';
import fx14 from '../../fixtures/grade/case11-variant-skip-ahead.json';
import fx15 from '../../fixtures/grade/case12-tolerance-trumpet-l1-132.json';
import fx16 from '../../fixtures/grade/case12-tolerance-trumpet-l1-60.json';
import fx17 from '../../fixtures/grade/case12-tolerance-trumpet-l5-132.json';
import fx18 from '../../fixtures/grade/case12-tolerance-trumpet-l5-60.json';
import fx19 from '../../fixtures/grade/case12-tolerance-trumpet-l9-132.json';
import fx20 from '../../fixtures/grade/case12-tolerance-trumpet-l9-60.json';
import fx21 from '../../fixtures/grade/case12-tolerance-violin-l9-132.json';
import fx22 from '../../fixtures/grade/case12-tolerance-voice-l9-132.json';
import fx23 from '../../fixtures/grade/case13-short-steady-flute.json';
import fx24 from '../../fixtures/grade/case14-reported-calibration.json';

const FIXTURES = [fx00, fx01, fx02, fx03, fx04, fx05, fx06, fx07, fx08, fx09, fx10, fx11, fx12, fx13, fx14, fx15, fx16, fx17, fx18, fx19, fx20, fx21, fx22, fx23, fx24] as unknown as GradeFixture[];

let cfgCache: Configs | null = null;
function configs(): Configs {
  if (cfgCache) return cfgCache;
  const raw = { grading: gradingRaw, levels: levelsRaw, instruments: instrumentsRaw, progression: progressionRaw, tips: tipsRaw, budget: budgetRaw, trumpetValves: valvesRaw } as unknown as RawConfigs;
  cfgCache = loadConfigs(raw);
  return cfgCache;
}

export function gradeScenario(fx: GradeFixture): unknown {
  const cfg = configs();
  const instrument = cfg.instrumentById[fx.instrumentId];
  if (!instrument) throw new Error(`unknown instrument ${fx.instrumentId}`);
  const { input } = fx;
  const tolerances = resolveTolerances(input.expected, { instrument, level: input.level, bpm: input.bpm, meter: input.meter }, cfg);
  return { tolerances, score: grade({ ...input, instrument, cfg, tolerances }) };
}

export const GRADE_SCENARIOS: { id: string; run: () => unknown }[] = FIXTURES.map((fx) => ({ id: `grade-${fx.id}`, run: () => gradeScenario(fx) }));
