/**
 * `config/scales.json` (PLAN ruling 68): validated against its generated schema, then checked as music. Every scale
 * must name a known pattern and instrument, spell with a real key signature, and stay inside its set's span, which
 * itself sits inside the instrument's full written range. Adding a voice or instrument is adding a set: no code.
 */
import type { Configs, ScalesConfig } from '../../core/types.ts';
import { schemaProblems } from '../../rules/index.ts';
import { toMidi } from '../../theory/index.ts';
import scalesSchema from '../../../schemas/scales.schema.json';
import { parseMeter } from '../select/levels.ts';
import { parsePitchName, scaleKey, scaleRange, scaleRefOf, scaleRhythm } from './generate.ts';

export class ScalesConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: string[]) {
    super(`Invalid config (scales): ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? `; and ${problems.length - 8} more` : ''}`);
    this.name = 'ScalesConfigError';
    this.problems = problems;
  }
}

/** Problems with a scales config beyond its schema; empty when every scale can be written as listed. */
export function scaleProblems(config: ScalesConfig, cfg: Configs): string[] {
  const out: string[] = [];
  if (!cfg.levelByNumber[config.level]) out.push(`level ${config.level} is not a difficulty`);
  try {
    parseMeter(config.rhythm.meter);
    scaleRhythm(2, { meter: config.rhythm.meter, noteBeats: config.rhythm.noteBeats, minLastBeats: config.rhythm.minLastBeats });
  } catch (e) {
    out.push(`rhythm: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!(config.tempo.minBpm > 0) || config.tempo.minBpm > config.tempo.maxBpm) out.push('tempo: minBpm must be positive and at most maxBpm');
  const patternIds = new Set<string>();
  for (const p of config.patterns) {
    if (patternIds.has(p.id)) out.push(`pattern ${p.id}: duplicate id`);
    patternIds.add(p.id);
    if (p.degrees.length < 2) out.push(`pattern ${p.id}: needs at least two degrees`);
    if (p.degrees.some((d) => !Number.isInteger(d) || d < 1)) out.push(`pattern ${p.id}: degrees are whole numbers from 1`);
  }
  const instruments = new Set<string>();
  for (const set of config.sets) {
    const where = `set ${set.instrumentId}`;
    if (instruments.has(set.instrumentId)) out.push(`${where}: listed twice`);
    instruments.add(set.instrumentId);
    const inst = cfg.instrumentById[set.instrumentId];
    if (!inst) {
      out.push(`${where}: unknown instrument`);
      continue;
    }
    let span: [number, number];
    try {
      span = [toMidi(parsePitchName(set.span[0])), toMidi(parsePitchName(set.span[1]))];
    } catch (e) {
      out.push(`${where}: span ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const [full0, full1] = inst.fullWrittenRange;
    if (span[0] > span[1]) out.push(`${where}: span runs downwards`);
    if (span[0] < full0 || span[1] > full1) out.push(`${where}: span ${set.span.join('-')} is outside the full range ${full0}-${full1} (MIDI)`);
    const ids = new Set<string>();
    for (const def of set.scales) {
      const at = `${where} scale ${def.id}`;
      if (ids.has(def.id)) out.push(`${at}: duplicate id`);
      ids.add(def.id);
      if (!patternIds.has(def.pattern)) {
        out.push(`${at}: unknown pattern ${def.pattern}`);
        continue;
      }
      if (def.bpm < config.tempo.minBpm || def.bpm > config.tempo.maxBpm) out.push(`${at}: bpm ${def.bpm} is outside the tempo range`);
      try {
        const ref = scaleRefOf(config, def);
        scaleKey(ref);
        const [lo, hi] = scaleRange(ref);
        if (lo < span[0] || hi > span[1]) out.push(`${at}: notes ${lo}-${hi} leave the span ${set.span.join('-')}`);
      } catch (e) {
        out.push(`${at}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return out;
}

/** Validates and freezes `config/scales.json`. Throws `ScalesConfigError` on any problem. */
export function loadScales(raw: unknown, cfg: Configs): ScalesConfig {
  const problems = schemaProblems(scalesSchema, raw, 'scales');
  if (problems.length > 0) throw new ScalesConfigError(problems);
  const config = JSON.parse(JSON.stringify(raw)) as ScalesConfig;
  const music = scaleProblems(config, cfg);
  if (music.length > 0) throw new ScalesConfigError(music);
  return deepFreeze(config);
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const c of Object.values(v as Record<string, unknown>)) deepFreeze(c);
  }
  return v;
}
