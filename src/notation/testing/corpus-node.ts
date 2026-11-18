// Test helper (Node only): the 24 fixture-corpus documents, read through fixtures/corpus/index.json.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CorpusIndex, ExcerptChunk, ExcerptDoc, ExpectedGolden } from '../../core/types.ts';

const ROOT = process.cwd();
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;

let cache: ExcerptDoc[] | null = null;
export function fixtureDocs(): ExcerptDoc[] {
  if (cache) return cache;
  const index = readJson<CorpusIndex>('fixtures/corpus/index.json');
  cache = index.chunks.flatMap((c) => readJson<ExcerptChunk>(`fixtures/corpus/${c.file}`).excerpts);
  return cache;
}

export function fixtureDoc(id: string): ExcerptDoc {
  const d = fixtureDocs().find((x) => x.id === id);
  if (!d) throw new Error(`no fixture-corpus excerpt ${id}`);
  return d;
}

export function goldenFiles(): string[] {
  return readJson<{ files: string[] }>('fixtures/expected/index.json').files;
}

export function golden(file: string): ExpectedGolden {
  return readJson<ExpectedGolden>(`fixtures/expected/${file}`);
}
