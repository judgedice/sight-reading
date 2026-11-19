/**
 * The shipped corpus manifest (public/corpus/v1), for tests that check selection against the real music. The reader
 * is injected so this file stays free of Node types (the pure packages compile with ES2022 only); tests pass one that
 * reads `public/corpus/v1/<file>` from disk.
 */
import type { CorpusIndex, CorpusManifest, ManifestFile, WithdrawnFile } from '../../../core/types.ts';
import { decodeCorpusManifest } from '../../load/decode.ts';

/** Reads a file of `public/corpus/v1/` as text. */
export type CorpusFileReader = (file: string) => string;

let cached: CorpusManifest | null = null;

export function shippedManifest(read: CorpusFileReader): CorpusManifest {
  if (cached) return cached;
  const json = <T>(file: string): T => JSON.parse(read(file)) as T;
  const index = json<CorpusIndex>('index.json');
  cached = decodeCorpusManifest(index, json<ManifestFile>(index.manifest.file), json<WithdrawnFile>('withdrawn.json'));
  return cached;
}
