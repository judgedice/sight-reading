/**
 * Corpus loading (01 §5.5 loadManifest and loadExcerpt, §6.2). Selection and transposition are
 * in later modules and use the manifest this module returns.
 */
import type { CorpusIndex, CorpusManifest, ExcerptDoc, ManifestEntry, ManifestFile, WithdrawnFile } from '../../core/types.ts';
import { decodeCorpusManifest } from './decode.ts';
import { CorpusLoadError } from './errors.ts';
import { type CorpusAssets, fetchChunk, fetchCorpusJson } from './chunks.ts';

export { CorpusLoadError, type CorpusLoadErrorCode } from './errors.ts';
export { prefetchNeighbours } from './chunks.ts';

/** Lookup tables per manifest object, built once. */
interface ManifestLookup {
  byId: Map<string, ManifestEntry>;
  withdrawn: Set<string>;
}
const lookups = new WeakMap<CorpusManifest, ManifestLookup>();

function lookupFor(m: CorpusManifest): ManifestLookup {
  let lookup = lookups.get(m);
  if (!lookup) {
    lookup = {
      byId: new Map(m.entries.map((e) => [e.id, e])),
      withdrawn: new Set(m.withdrawn),
    };
    lookups.set(m, lookup);
  }
  return lookup;
}

/**
 * Fetches `index.json`, then the manifest it names and `withdrawn.json`, and decodes them into a
 * `CorpusManifest`. No excerpt chunk is fetched here.
 */
export async function loadManifest(assets: CorpusAssets): Promise<CorpusManifest> {
  const index = await fetchCorpusJson<CorpusIndex>(assets, 'index.json');
  const [manifest, withdrawn] = await Promise.all([
    fetchCorpusJson<ManifestFile>(assets, index.manifest.file),
    fetchCorpusJson<WithdrawnFile>(assets, 'withdrawn.json'),
  ]);
  return decodeCorpusManifest(index, manifest, withdrawn);
}

/**
 * Returns one excerpt. It fetches only the chunk that holds the id, and reuses it when cached.
 * An id listed in `m.withdrawn` is refused (code `withdrawn`), even if its chunk is cached.
 */
export async function loadExcerpt(m: CorpusManifest, id: string, assets: CorpusAssets): Promise<ExcerptDoc> {
  const { byId, withdrawn } = lookupFor(m);
  if (withdrawn.has(id)) {
    throw new CorpusLoadError('withdrawn', `excerpt ${id} is withdrawn`);
  }
  const entry = byId.get(id);
  if (!entry) {
    throw new CorpusLoadError('unknown-id', `excerpt ${id} is not in the manifest`);
  }
  const chunk = await fetchChunk(m, entry.shard, assets);
  const doc = chunk.excerpts.find((x) => x.id === id);
  if (!doc) {
    throw new CorpusLoadError('malformed', `chunk ${entry.shard} does not contain ${id}`);
  }
  return doc;
}
