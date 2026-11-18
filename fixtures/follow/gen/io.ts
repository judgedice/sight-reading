/** File access for the fixture generator and its tests (Node only). */
import { readFileSync } from 'node:fs';
import { loadConfigs } from '../../../src/rules/load-configs.ts';
import type { Configs, CorpusIndex, ExcerptChunk, ExcerptDoc, ExpectedGolden, RawConfigs } from '../../../src/core/types.ts';

export const ROOT = new URL('../../../', import.meta.url);
export const readText = (rel: string): string => readFileSync(new URL(rel, ROOT), 'utf8');
export const readJson = <T>(rel: string): T => JSON.parse(readText(rel)) as T;

let cached: Configs | null = null;
export function configs(): Configs {
  if (cached) return cached;
  const raw: RawConfigs = {
    grading: readJson('config/grading-config.json'),
    levels: readJson('config/levels.json'),
    instruments: readJson('config/instruments.json'),
    progression: readJson('config/progression.json'),
    tips: readJson('config/tips.json'),
    budget: readJson('config/measurement-budget.json'),
    trumpetValves: readJson('data/trumpet-valves.json'),
  };
  cached = loadConfigs(raw);
  return cached;
}

let docsCache: ExcerptDoc[] | null = null;
export function corpusDocs(): ExcerptDoc[] {
  if (docsCache) return docsCache;
  const index = readJson<CorpusIndex>('fixtures/corpus/index.json');
  docsCache = index.chunks.flatMap((c) => readJson<ExcerptChunk>(`fixtures/corpus/${c.file}`).excerpts);
  return docsCache;
}
export function corpusDoc(id: string): ExcerptDoc {
  const d = corpusDocs().find((x) => x.id === id);
  if (!d) throw new Error(`no fixture-corpus excerpt ${id}`);
  return d;
}

export function goldenFiles(): string[] {
  return readJson<{ files: string[] }>('fixtures/expected/index.json').files;
}
export const golden = (file: string): ExpectedGolden => readJson<ExpectedGolden>(`fixtures/expected/${file}`);
