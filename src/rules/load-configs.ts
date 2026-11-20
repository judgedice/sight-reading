/**
 * Config loading (01 §5.4, §14 item 5): `loadConfigs(raw)` validates each raw config document against its
 * generated JSON Schema, checks cross-document invariants, and returns deep-frozen objects with indexes.
 *
 * The validator below is a small interpreter for the JSON Schema subset the generated schemas use
 * (`$ref`, `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`,
 * `minItems`, `maxItems`, `anyOf`). It is plain code (no `new Function`), so it runs under a strict CSP and in
 * the bare runtime. CI additionally validates every config file with Ajv in strict mode.
 */
import type {
  ConfigFileKey,
  Configs,
  GradingConfig,
  Instrument,
  InstrumentsConfig,
  LevelDef,
  LevelsConfig,
  MeasurementBudget,
  ProgressionConfig,
  RawConfigs,
  TipsConfig,
  TrumpetValveTable,
} from '../core/types.ts';
import gradingSchema from '../../schemas/grading-config.schema.json';
import instrumentsSchema from '../../schemas/instruments.schema.json';
import levelsSchema from '../../schemas/levels.schema.json';
import budgetSchema from '../../schemas/measurement-budget.schema.json';
import progressionSchema from '../../schemas/progression.schema.json';
import tipsSchema from '../../schemas/tips.schema.json';
import valvesSchema from '../../schemas/trumpet-valves.schema.json';

// ---- schema validation -----------------------------------------------------------------

interface SchemaNode {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean | SchemaNode;
  items?: SchemaNode;
  minItems?: number;
  maxItems?: number;
  anyOf?: SchemaNode[];
  definitions?: Record<string, SchemaNode>;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function validateNode(root: SchemaNode, node: SchemaNode, value: unknown, path: string, errors: string[]): void {
  if (node.$ref !== undefined) {
    const prefix = '#/definitions/';
    if (!node.$ref.startsWith(prefix)) throw new Error(`Unsupported $ref ${node.$ref}`);
    const target = root.definitions?.[node.$ref.slice(prefix.length)];
    if (!target) throw new Error(`Unresolved $ref ${node.$ref}`);
    validateNode(root, target, value, path, errors);
    return;
  }
  if (node.anyOf) {
    const attempts = node.anyOf.map((alt) => {
      const sub: string[] = [];
      validateNode(root, alt, value, path, sub);
      return sub;
    });
    if (!attempts.some((a) => a.length === 0)) errors.push(`${path}: matches none of the allowed shapes`);
    return;
  }
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: expected ${types.join(' | ')}`);
      return;
    }
  }
  if (node.const !== undefined && value !== node.const) errors.push(`${path}: must equal ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.includes(value)) errors.push(`${path}: must be one of ${node.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${path}: needs at least ${node.minItems} items`);
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${path}: needs at most ${node.maxItems} items`);
    const itemSchema = node.items;
    if (itemSchema) value.forEach((item, i) => validateNode(root, itemSchema, item, `${path}[${i}]`, errors));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const props = node.properties ?? {};
    for (const key of node.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: missing`);
    }
    for (const [key, child] of Object.entries(obj)) {
      const propSchema = props[key];
      if (propSchema) {
        validateNode(root, propSchema, child, `${path}.${key}`, errors);
      } else if (node.additionalProperties === false) {
        errors.push(`${path}.${key}: unknown property`);
      } else if (typeof node.additionalProperties === 'object') {
        validateNode(root, node.additionalProperties, child, `${path}.${key}`, errors);
      }
    }
  }
}

/** Thrown by `loadConfigs` when a document fails schema or invariant checks. */
export class ConfigError extends Error {
  readonly file: ConfigFileKey | 'cross-check';
  readonly problems: readonly string[];
  constructor(file: ConfigFileKey | 'cross-check', problems: string[]) {
    super(`Invalid config (${file}): ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? `; and ${problems.length - 8} more` : ''}`);
    this.name = 'ConfigError';
    this.file = file;
    this.problems = problems;
  }
}

const SCHEMAS: Record<ConfigFileKey, SchemaNode> = {
  grading: gradingSchema as SchemaNode,
  levels: levelsSchema as SchemaNode,
  instruments: instrumentsSchema as SchemaNode,
  progression: progressionSchema as SchemaNode,
  tips: tipsSchema as SchemaNode,
  budget: budgetSchema as SchemaNode,
  trumpetValves: valvesSchema as SchemaNode,
};

function validateAgainstSchema(file: ConfigFileKey, value: unknown): void {
  const root = SCHEMAS[file];
  const errors: string[] = [];
  validateNode(root, root, value, file, errors);
  if (errors.length > 0) throw new ConfigError(file, errors);
}

/**
 * The problems of `value` against one of the generated schemas, with the interpreter `loadConfigs` uses (for config
 * documents outside `Configs`, such as `config/scales.json`). Empty when the value is valid.
 */
export function schemaProblems(schema: object, value: unknown, label = '$'): string[] {
  const root = schema as SchemaNode;
  const errors: string[] = [];
  validateNode(root, root, value, label, errors);
  return errors;
}

// ---- invariants across and within documents ------------------------------------------------

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

function checkRanges(label: string, rows: { levels: [number, number] }[], problems: string[]): void {
  const sorted = [...rows].sort((a, b) => a.levels[0] - b.levels[0]);
  let expected = 1;
  for (const r of sorted) {
    if (r.levels[0] !== expected || r.levels[1] < r.levels[0]) problems.push(`${label}: level ranges must tile 1..10 without gaps or overlap`);
    expected = r.levels[1] + 1;
  }
  if (expected !== 11) problems.push(`${label}: level ranges must end at 10`);
}

function crossCheck(c: {
  grading: GradingConfig;
  levels: LevelsConfig;
  instruments: InstrumentsConfig;
  progression: ProgressionConfig;
  tips: TipsConfig;
  budget: MeasurementBudget;
  trumpetValves: TrumpetValveTable;
}): void {
  const problems: string[] = [];

  // levels: exactly 1..10, in order, descriptions within the 60 character limit
  c.levels.levels.forEach((l, i) => {
    if (l.level !== i + 1) problems.push(`levels.levels[${i}].level must be ${i + 1}`);
    if (l.description.length > 60) problems.push(`levels.levels[${i}].description is over 60 characters`);
  });
  if (c.levels.levels.length !== 10) problems.push('levels.levels must hold 10 levels');

  // grading: ranges tile, weights sum to 1, grade scale descends
  checkRanges('grading.timing.levelBands', c.grading.timing.levelBands, problems);
  for (const group of ['voice', 'continuous', 'fixed'] as const) {
    checkRanges(`grading.intonation.bands[${group}]`, c.grading.intonation.bands.filter((b) => b.group === group), problems);
  }
  for (const group of ['continuous', 'fixed'] as const) {
    checkRanges(`grading.components.weights[${group}]`, c.grading.components.weights.filter((b) => b.group === group), problems);
  }
  c.grading.components.weights.forEach((r, i) => {
    if (!near(r.P + r.I + r.R, 1)) problems.push(`grading.components.weights[${i}]: P + I + R must equal 1`);
  });
  if (!near(c.grading.components.rhythm.onsetWeight + c.grading.components.rhythm.durationWeight, 1)) {
    problems.push('grading.components.rhythm: onsetWeight + durationWeight must equal 1');
  }
  const scale = c.grading.grades.scale;
  scale.forEach((row, i) => {
    const prev = scale[i - 1];
    if (prev && row.minScore >= prev.minScore) problems.push(`grading.grades.scale[${i}]: minScore must descend`);
  });
  if (scale[scale.length - 1]?.minScore !== 0) problems.push('grading.grades.scale: the last grade must start at 0');
  if (!scale.some((r) => r.grade === c.grading.grades.passGrade)) problems.push('grading.grades.passGrade is not in the scale');

  // instruments: unique ids, ranges ordered, tiers inside the full range
  const ids = new Set<string>();
  c.instruments.instruments.forEach((inst, i) => {
    if (ids.has(inst.id)) problems.push(`instruments[${i}].id "${inst.id}" is duplicated`);
    ids.add(inst.id);
    if (inst.fullWrittenRange[0] > inst.fullWrittenRange[1]) problems.push(`instruments[${i}].fullWrittenRange is reversed`);
    for (const [tier, band] of Object.entries(inst.tiers)) {
      if (band[0] > band[1]) problems.push(`instruments[${i}].tiers.${tier} is reversed`);
      if (band[0] < inst.fullWrittenRange[0] || band[1] > inst.fullWrittenRange[1]) {
        problems.push(`instruments[${i}].tiers.${tier} lies outside fullWrittenRange`);
      }
    }
    if (inst.clefs.length === 0) problems.push(`instruments[${i}].clefs must not be empty`);
  });

  // tips: unique ids, every reference resolves
  const patternIds = new Set<string>();
  for (const p of c.tips.patterns) {
    if (patternIds.has(p.id)) problems.push(`tips.patterns: "${p.id}" is duplicated`);
    patternIds.add(p.id);
    for (const inst of p.instruments ?? []) if (!ids.has(inst)) problems.push(`tips.patterns ${p.id}: unknown instrument "${inst}"`);
  }
  const tipIds = new Set<string>();
  for (const t of c.tips.tips) {
    if (tipIds.has(t.id)) problems.push(`tips.tips: "${t.id}" is duplicated`);
    tipIds.add(t.id);
    for (const p of t.patterns) if (!patternIds.has(p)) problems.push(`tips.tips ${t.id}: unknown pattern "${p}"`);
    for (const inst of t.instruments ?? []) if (!ids.has(inst)) problems.push(`tips.tips ${t.id}: unknown instrument "${inst}"`);
  }
  const sel = c.tips.selection;
  if (!patternIds.has(sel.cleanReadPatternId)) problems.push('tips.selection.cleanReadPatternId is not a pattern');
  if (!tipIds.has(sel.cleanReadTipId)) problems.push('tips.selection.cleanReadTipId is not a tip');

  // progression: rank table ascends
  const ranks = c.progression.ranks.table;
  ranks.forEach((r, i) => {
    const prev = ranks[i - 1];
    if (r.rank !== i + 1) problems.push(`progression.ranks.table[${i}].rank must be ${i + 1}`);
    if (prev && (r.xp <= prev.xp || r.minLevel < prev.minLevel)) problems.push(`progression.ranks.table[${i}]: xp and minLevel must ascend`);
  });

  // trumpet valve table: strictly ascending written MIDI
  c.trumpetValves.entries.forEach((e, i) => {
    const prev = c.trumpetValves.entries[i - 1];
    if (prev && e.writtenMidi <= prev.writtenMidi) problems.push(`trumpetValves.entries[${i}].writtenMidi must ascend`);
  });

  if (problems.length > 0) throw new ConfigError('cross-check', problems);
}

// ---- freezing and indexes --------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Validate and freeze the raw config documents. Throws `ConfigError` on any schema or invariant failure.
 * The input is deep-copied first, so the caller's objects are never frozen or aliased.
 */
export function loadConfigs(raw: RawConfigs): Configs {
  const copy = {} as Record<ConfigFileKey, unknown>;
  for (const key of Object.keys(SCHEMAS) as ConfigFileKey[]) {
    validateAgainstSchema(key, raw[key]);
    copy[key] = JSON.parse(JSON.stringify(raw[key])) as unknown; // configs are plain JSON
  }
  const grading = copy.grading as GradingConfig;
  const levels = copy.levels as LevelsConfig;
  const instruments = copy.instruments as InstrumentsConfig;
  const progression = copy.progression as ProgressionConfig;
  const tips = copy.tips as TipsConfig;
  const budget = copy.budget as MeasurementBudget;
  const trumpetValves = copy.trumpetValves as TrumpetValveTable;
  crossCheck({ grading, levels, instruments, progression, tips, budget, trumpetValves });

  const instrumentById: Record<string, Instrument> = {};
  for (const inst of instruments.instruments) instrumentById[inst.id] = inst;
  const levelByNumber: Record<number, LevelDef> = {};
  for (const l of levels.levels) levelByNumber[l.level] = l;

  const configs: Configs = {
    grading,
    levels,
    instruments,
    progression,
    tips,
    budget,
    trumpetValves,
    instrumentById,
    levelByNumber,
    configVersion: [
      grading.configVersion,
      levels.configVersion,
      instruments.configVersion,
      progression.configVersion,
      tips.configVersion,
      budget.budgetVersion,
    ].join('+'),
  };
  return deepFreeze(configs);
}
