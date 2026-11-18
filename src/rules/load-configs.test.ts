import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawConfigs } from '../core/types.ts';
import { ConfigError, loadConfigs } from './load-configs.ts';

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')) as unknown;

const raw = (): RawConfigs => ({
  grading: readJson('config/grading-config.json'),
  levels: readJson('config/levels.json'),
  instruments: readJson('config/instruments.json'),
  progression: readJson('config/progression.json'),
  tips: readJson('config/tips.json'),
  budget: readJson('config/measurement-budget.json'),
  trumpetValves: readJson('data/trumpet-valves.json'),
});

/** Walk a dotted path with array indexes and apply a change. */
function edit(r: RawConfigs, file: keyof RawConfigs, path: (string | number)[], apply: (parent: Record<string | number, unknown>, key: string | number) => void): RawConfigs {
  const copy = structuredClone(r);
  let node = copy[file] as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) node = node[k] as Record<string | number, unknown>;
  apply(node, path[path.length - 1] as string | number);
  return copy;
}

describe('loadConfigs', () => {
  it('returns deep-frozen configs with indexes and a combined version', () => {
    const cfg = loadConfigs(raw());
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.grading.timing.levelBands[0])).toBe(true);
    expect(Object.isFrozen(cfg.tips.tips[0])).toBe(true);
    expect(() => {
      (cfg.levels.levels as unknown as unknown[]).push(1);
    }).toThrow(TypeError);
    expect(Object.keys(cfg.instrumentById)).toHaveLength(24);
    expect(Object.keys(cfg.levelByNumber)).toHaveLength(10);
    expect(cfg.levelByNumber[5]?.scanSec).toBe(45);
    expect(cfg.configVersion).toBe('grading-2.1.0+levels-1.0.0+instruments-1.0.0+progression-1.0.0+tips-1.0.0+budget-1.0.0');
  });

  it('does not freeze or alias the caller input', () => {
    const input = raw();
    const cfg = loadConfigs(input);
    expect(Object.isFrozen(input.grading)).toBe(false);
    expect(cfg.grading).not.toBe(input.grading);
  });

  it('is deterministic', () => {
    expect(loadConfigs(raw())).toEqual(loadConfigs(raw()));
  });

  it('rejects a missing required field', () => {
    const bad = edit(raw(), 'grading', ['live', 'provisionalMs'], (p, k) => delete p[k]);
    expect(() => loadConfigs(bad)).toThrow(ConfigError);
    expect(() => loadConfigs(bad)).toThrow(/live\.provisionalMs: missing/);
  });

  it('rejects a wrong type, an unknown property and a bad enum', () => {
    expect(() => loadConfigs(edit(raw(), 'grading', ['live', 'hysteresisCents'], (p, k) => (p[k] = '10')))).toThrow(/expected number/);
    expect(() => loadConfigs(edit(raw(), 'progression', ['skip', 'extra'], (p, k) => (p[k] = 1)))).toThrow(/unknown property/);
    expect(() => loadConfigs(edit(raw(), 'instruments', ['instruments', 0, 'family'], (p, k) => (p[k] = 'theremin')))).toThrow(/must be one of/);
    expect(() => loadConfigs(edit(raw(), 'instruments', ['instruments', 0, 'detection', 'windowSamples'], (p, k) => (p[k] = 700)))).toThrow(/must be one of/);
  });

  it('rejects a document that is not an object', () => {
    expect(() => loadConfigs({ ...raw(), levels: [] })).toThrow(/expected object/);
    expect(() => loadConfigs({ ...raw(), tips: null })).toThrow(ConfigError);
  });

  it('rejects non-finite numbers and wrong tuple lengths', () => {
    expect(() => loadConfigs(edit(raw(), 'grading', ['timing', 'levelBands', 0, 'levels'], (p, k) => (p[k] = [1])))).toThrow(/at least 2 items/);
    expect(() => loadConfigs(edit(raw(), 'grading', ['matchWindow', 'minMs'], (p, k) => (p[k] = Number.NaN)))).toThrow(/expected number/);
  });

  it('reports cross-document problems', () => {
    const dupId = edit(raw(), 'instruments', ['instruments', 1, 'id'], (p, k) => (p[k] = 'voice-soprano'));
    expect(() => loadConfigs(dupId)).toThrow(/duplicated/);
    const badPattern = edit(raw(), 'tips', ['tips', 0, 'patterns'], (p, k) => (p[k] = ['E99']));
    expect(() => loadConfigs(badPattern)).toThrow(/unknown pattern "E99"/);
    const gap = edit(raw(), 'grading', ['timing', 'levelBands', 1, 'levels'], (p, k) => (p[k] = [5, 6]));
    expect(() => loadConfigs(gap)).toThrow(/tile 1\.\.10/);
    const weights = edit(raw(), 'grading', ['components', 'weights', 0, 'P'], (p, k) => (p[k] = 0.6));
    expect(() => loadConfigs(weights)).toThrow(/must equal 1/);
    const tier = edit(raw(), 'instruments', ['instruments', 0, 'tiers', 'A'], (p, k) => (p[k] = [10, 20]));
    expect(() => loadConfigs(tier)).toThrow(/outside fullWrittenRange/);
    const longDesc = edit(raw(), 'levels', ['levels', 0, 'description'], (p, k) => (p[k] = 'x'.repeat(61)));
    expect(() => loadConfigs(longDesc)).toThrow(/over 60 characters/);
  });
});
