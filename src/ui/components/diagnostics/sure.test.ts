import { describe, expect, it } from 'vitest';
import gradingJson from '../../../../config/grading-config.json';
import type { DetectedNote, NoteJudgment } from '../../../core/types.ts';
import { sureFacts, sureLevel, sureLevelOf, type SureConfig, type SureLevel } from './sure.ts';

const cfg = gradingJson.ui.sure as SureConfig;

/** A record with `total` detected notes of which `agree` agree, and `changed` re-judged marks. */
function rec(total: number, agree: number, changed: number) {
  const detected = Array.from({ length: total }, (_, i) => ({ id: i, framesAgree: i < agree }) as unknown as DetectedNote);
  const judgments = Array.from({ length: Math.max(total, changed) }, (_, i) => ({ rejudged: i < changed }) as unknown as NoteJudgment);
  return { detected, judgments };
}

describe('sureLevel', () => {
  it('reads the thresholds from config', () => {
    expect(cfg).toEqual({ clearAgree: 0.9, clearMaxChanged: 2, mostlyAgree: 0.75, mostlyMaxChanged: 5 });
  });

  const table: [string, number, number, number, SureLevel][] = [
    ['all agree, none changed', 20, 20, 0, 'clear'],
    ['exactly 90% agree, 2 changed', 20, 18, 2, 'clear'],
    ['just under 90% agree', 20, 17, 0, 'mostly'],
    ['90% agree but 3 changed', 20, 18, 3, 'mostly'],
    ['exactly 75% agree, 5 changed', 20, 15, 5, 'mostly'],
    ['100% agree, 5 changed', 20, 20, 5, 'mostly'],
    ['100% agree, 6 changed', 20, 20, 6, 'unsure'],
    ['just under 75% agree', 20, 14, 0, 'unsure'],
    ['half agree', 10, 5, 1, 'unsure'],
    ['nothing heard', 0, 0, 0, 'unsure'],
  ];
  for (const [name, total, agree, changed, level] of table) {
    it(`${name}: ${level}`, () => {
      expect(sureLevel(rec(total, agree, changed), cfg)).toBe(level);
    });
  }

  it('follows the config, not constants', () => {
    const strict = { ...cfg, clearAgree: 1, clearMaxChanged: 0 };
    expect(sureLevel(rec(20, 19, 0), strict)).toBe('mostly');
    expect(sureLevelOf({ total: 20, steady: 19, changed: 0 }, cfg)).toBe('clear');
  });

  it('counts steady notes and changed marks', () => {
    expect(sureFacts(rec(28, 27, 1))).toEqual({ total: 28, steady: 27, changed: 1 });
  });
});
