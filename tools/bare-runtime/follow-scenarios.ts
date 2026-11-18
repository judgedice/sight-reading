// Follow scenarios for the bare-runtime job (02 §4.9 case 15, 01 §13.3): finalAlign over every fixtures/follow stream,
// in the ES2022-only context and under Node, must give byte-identical alignments. `finalAlign` also replays the live
// follower to mark `rejudged`, so the live follower and the displacement detector run here too. JSON is bundled by
// esbuild, so nothing here touches fs. The follow fixtures carry no meter; every one is in an x/4 meter, so the
// meter is rebuilt from the expected notes (src/follow/final-align.fixtures.test.ts checks this against the corpus).
import type { Configs, FollowFixture, RawConfigs } from '../../src/core/types.ts';
import { makeMeter } from '../../src/core/time.ts';
import { finalAlign } from '../../src/follow/final-align.ts';
import { loadConfigs, resolveTolerances } from '../../src/rules/index.ts';
import { beatsPerBarOf, finalDetected, followConfigFor } from '../../src/testkit/predicates/subjects.ts';
import gradingRaw from '../../config/grading-config.json';
import levelsRaw from '../../config/levels.json';
import instrumentsRaw from '../../config/instruments.json';
import progressionRaw from '../../config/progression.json';
import tipsRaw from '../../config/tips.json';
import budgetRaw from '../../config/measurement-budget.json';
import valvesRaw from '../../data/trumpet-valves.json';

import fx00 from '../../fixtures/follow/back-2-beats.json';
import fx01 from '../../fixtures/follow/early-150.json';
import fx02 from '../../fixtures/follow/extra-in-rest.json';
import fx03 from '../../fixtures/follow/fast-run.json';
import fx04 from '../../fixtures/follow/flat.json';
import fx05 from '../../fixtures/follow/late-150.json';
import fx06 from '../../fixtures/follow/live-final-divergence.json';
import fx07 from '../../fixtures/follow/missed.json';
import fx08 from '../../fixtures/follow/octave-non-voice.json';
import fx09 from '../../fixtures/follow/octave-voice.json';
import fx10 from '../../fixtures/follow/on-time.json';
import fx11 from '../../fixtures/follow/pickup-late.json';
import fx12 from '../../fixtures/follow/rejoin-next-downbeat.json';
import fx13 from '../../fixtures/follow/repeat-merge.json';
import fx14 from '../../fixtures/follow/repeat-split.json';
import fx15 from '../../fixtures/follow/sharp.json';
import fx16 from '../../fixtures/follow/skip-bar-ahead.json';
import fx17 from '../../fixtures/follow/slurred-run.json';
import fx18 from '../../fixtures/follow/stop-bar-5.json';
import fx19 from '../../fixtures/follow/tie.json';
import fx20 from '../../fixtures/follow/wrong-note-key-signature.json';

const FIXTURES = [fx00, fx01, fx02, fx03, fx04, fx05, fx06, fx07, fx08, fx09, fx10, fx11, fx12, fx13, fx14, fx15, fx16, fx17, fx18, fx19, fx20] as unknown as FollowFixture[];

let cfgCache: Configs | null = null;
function configs(): Configs {
  if (cfgCache) return cfgCache;
  const raw = { grading: gradingRaw, levels: levelsRaw, instruments: instrumentsRaw, progression: progressionRaw, tips: tipsRaw, budget: budgetRaw, trumpetValves: valvesRaw } as unknown as RawConfigs;
  cfgCache = loadConfigs(raw);
  return cfgCache;
}

const QUARTER = 4;

export function followScenario(fx: FollowFixture): unknown {
  const cfg = configs();
  const instrument = cfg.instrumentById[fx.instrumentId];
  if (!instrument) throw new Error(`unknown instrument ${fx.instrumentId}`);
  const meter = makeMeter(beatsPerBarOf(fx.expected), QUARTER);
  const tolerances = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter }, cfg);
  return finalAlign(followConfigFor(fx, instrument, cfg, tolerances), finalDetected(fx.stream));
}

export const FOLLOW_SCENARIOS: { id: string; run: () => unknown }[] = FIXTURES.map((fx) => ({ id: `follow-${fx.id}`, run: () => followScenario(fx) }));
