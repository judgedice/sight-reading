/** Render overrides for the gate conditions (see `ConditionId`). Deterministic in the scenario index. */
import type { RenderOverrides } from '../scenarios/index.ts';
import type { ConditionId } from './types.ts';

const BLEEDS = [
  { timbre: 'tick', bleedDb: -20 },
  { timbre: 'tick', bleedDb: -10 },
  { timbre: 'wood', bleedDb: -20 },
  { timbre: 'wood', bleedDb: -10 },
] as const;

export function conditionOverrides(condition: ConditionId, k: number): RenderOverrides {
  if (condition === 'clean') {
    return { capture: { phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null }, click: { bleedDb: null } };
  }
  if (condition === 'device') {
    const b = BLEEDS[k % BLEEDS.length] as (typeof BLEEDS)[number];
    return {
      capture: { phoneMic: { highPassHz: Math.floor(k / 4) % 2 === 0 ? 150 : 100 }, room: null, agc: null, captureRateHz: 48000, noiseDbfs: k % 2 === 0 ? -50 : -45 },
      click: { timbre: b.timbre, bleedDb: b.bleedDb },
    };
  }
  return {};
}
