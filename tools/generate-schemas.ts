/**
 * Generates `schemas/*.schema.json` from the types in `src/core/types.ts` (01 §3, §14 item 6).
 *
 *   pnpm schemas            write the files
 *   pnpm schemas --check    exit 1 if any committed schema differs from the types (CI drift check)
 *
 * Output is deterministic: definitions are sorted by name and every object's keys keep the
 * generator's declaration order, so two runs produce byte-identical files.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator, type Config } from 'ts-json-schema-generator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_DIR = join(root, 'schemas');
const TYPES_FILE = join(root, 'src/core/types.ts');

/** Schema file name (without `.schema.json`) → root type in src/core/types.ts. */
export const SCHEMA_TARGETS: Readonly<Record<string, string>> = {
  // Corpus (03 §6.13, §8; validated by the Python pipeline too)
  excerpt: 'ExcerptDoc',
  'excerpt-chunk': 'ExcerptChunk',
  'corpus-index': 'CorpusIndex',
  manifest: 'ManifestFile',
  attributions: 'AttributionsFile',
  withdrawn: 'WithdrawnFile',
  'review-verdict': 'ReviewVerdict',
  // Config (01 §0, §14 item 5)
  'grading-config': 'GradingConfig',
  levels: 'LevelsConfig',
  instruments: 'InstrumentsConfig',
  progression: 'ProgressionConfig',
  tips: 'TipsConfig',
  'measurement-budget': 'MeasurementBudget',
  'trumpet-valves': 'TrumpetValveTable',
  scales: 'ScalesConfig',
  // Persistence (01 §11)
  'attempt-record': 'AttemptRecord',
  'player-profile': 'PlayerProfile',
  calibration: 'Calibration',
  'app-settings': 'AppSettings',
  'export-file': 'ExportFileV1',
  'audio-env': 'AudioEnv',
  // Fixtures (01 §14 items 8–11)
  'expected-golden': 'ExpectedGolden',
  'follow-fixture': 'FollowFixture',
  'grade-fixture': 'GradeFixture',
  'render-stream-line': 'RenderStreamLine',
  'follower-event': 'FollowerEvent',
  'level-tagger-golden': 'LevelTaggerGolden',
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function sortDefinitions(schema: Json): Json {
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && schema.definitions) {
    const defs = schema.definitions as Record<string, Json>;
    const sorted: Record<string, Json> = {};
    for (const k of Object.keys(defs).sort()) sorted[k] = defs[k] as Json;
    return { ...schema, definitions: sorted };
  }
  return schema;
}

/** Returns file name → file contents for every target. Pure apart from reading the source. */
export function generateSchemas(): Record<string, string> {
  const config: Config = {
    path: TYPES_FILE,
    tsconfig: join(root, 'tsconfig.core.json'),
    type: '*',
    expose: 'export',
    topRef: true,
    jsDoc: 'extended',
    skipTypeCheck: true,
    additionalProperties: false,
    sortProps: false,
    strictTuples: true,
    encodeRefs: true,
  };
  const generator = createGenerator(config);
  const out: Record<string, string> = {};
  for (const [name, type] of Object.entries(SCHEMA_TARGETS)) {
    const schema = generator.createSchema(type) as unknown as Json;
    const withId = { $id: `${name}.schema.json`, ...(sortDefinitions(schema) as Record<string, Json>) };
    out[`${name}.schema.json`] = `${JSON.stringify(withId, null, 2)}\n`;
  }
  return out;
}

/** Compares generated output with the committed files; returns a list of problems. */
export function checkSchemas(generated: Record<string, string>): string[] {
  const problems: string[] = [];
  const committed = existsSync(SCHEMA_DIR) ? readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')) : [];
  for (const [file, text] of Object.entries(generated)) {
    const path = join(SCHEMA_DIR, file);
    if (!existsSync(path)) problems.push(`missing: schemas/${file}`);
    else if (readFileSync(path, 'utf8') !== text) problems.push(`drift: schemas/${file} differs from src/core/types.ts`);
  }
  for (const file of committed) {
    if (!(file in generated)) problems.push(`stale: schemas/${file} has no target in tools/generate-schemas.ts`);
  }
  return problems;
}

function main(argv: string[]): void {
  const generated = generateSchemas();
  if (argv.includes('--check')) {
    const problems = checkSchemas(generated);
    if (problems.length > 0) {
      console.error(problems.join('\n'));
      console.error('Run `pnpm schemas` and commit the result.');
      process.exit(1);
    }
    return;
  }
  mkdirSync(SCHEMA_DIR, { recursive: true });
  for (const [file, text] of Object.entries(generated)) writeFileSync(join(SCHEMA_DIR, file), text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
