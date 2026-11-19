/**
 * What a calibration run will play, for the screen (presentation only; 04 §5.9). Every count comes from
 * `config/measurement-budget.json` and the run's own constants, so the stage list always matches what is heard.
 * Pure.
 */
import type { OutputMode } from '../core/types.ts';
import { CLOCK_RATE_SEC } from './clock-rate.ts';
import type { CalibrationBudget } from './loopback.ts';
import { PLAY_ALONG_LEAD_SEC, SILENCE_SEC, TONE_GAP_SEC, type CalibrationStageId } from './run.ts';
import { RECHECK_BEATS, RECHECK_BPM, RECHECK_LEAD_SEC } from './self-test.ts';
import { SANITY_TONE_SEC } from './tone.ts';

export interface CalibrationPlanStage {
  id: CalibrationStageId;
  /** Sounds the player hears in this stage (clicks, or 1 for the tone). */
  sounds: number;
  /** Of those, how many are accented (louder): the count-in's first beat. */
  accented: number;
}

export interface CalibrationPlan {
  /** The audible stages, in the order they play. */
  stages: CalibrationPlanStage[];
  /** Stages a speaker run has that this route leaves out (headphones: no loopback, tone or count-in). */
  skipped: CalibrationStageId[];
  /** About how long the whole run takes, seconds, rounded up to 5. */
  seconds: number;
}

/** Mean of the loopback's random 400 to 700 ms gaps (loopback.ts `randomClickTimes`), seconds. */
const MEAN_GAP_SEC = 0.55;

const roundUp5 = (sec: number): number => Math.max(5, Math.ceil(sec / 5) * 5);

export function calibrationPlan(budget: CalibrationBudget, outputMode: OutputMode): CalibrationPlan {
  const maxLag = budget.loopback.maxRtlMs / 1000;
  if (outputMode !== 'speakers') {
    const n = budget.playAlong.clicks;
    const sec = CLOCK_RATE_SEC + PLAY_ALONG_LEAD_SEC + (n - 1) * (60 / budget.playAlong.bpm) + budget.playAlong.maxRtlMs / 1000 + 0.4;
    return { stages: [{ id: 'play-along', sounds: n, accented: 0 }], skipped: ['timing', 'template', 'pitch', 'count-in'], seconds: roundUp5(sec) };
  }
  const { clicks, templateClicks } = budget.loopback;
  const stages: CalibrationPlanStage[] = [{ id: 'timing', sounds: clicks, accented: 0 }];
  if (templateClicks > 0) stages.push({ id: 'template', sounds: templateClicks, accented: 0 });
  stages.push({ id: 'pitch', sounds: 1, accented: 0 });
  stages.push({ id: 'count-in', sounds: RECHECK_BEATS, accented: 1 });
  const loopbackSec = 0.1 + SILENCE_SEC + (clicks + templateClicks - 1) * MEAN_GAP_SEC + TONE_GAP_SEC + SANITY_TONE_SEC + maxLag + 0.1;
  const recheckSec = RECHECK_LEAD_SEC + (RECHECK_BEATS - 1) * (60 / RECHECK_BPM) + maxLag + 0.1;
  return { stages, skipped: [], seconds: roundUp5(CLOCK_RATE_SEC + loopbackSec + recheckSec) };
}
