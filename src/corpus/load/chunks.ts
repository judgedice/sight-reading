/**
 * Chunk fetching, caching and idle prefetch (01 §6.2). Every byte comes through the injected
 * `assets.getJson`, so this module has no fetch, no DOM and no clock.
 */
import type { PlatformServices } from '../../core/platform.ts';
import type { CorpusManifest, ExcerptChunk } from '../../core/types.ts';
import { CorpusLoadError } from './errors.ts';

export type CorpusAssets = PlatformServices['assets'];

/** Corpus files are served under this relative path (01 §6.2: public/corpus/v1/). */
export const CORPUS_ROOT = 'corpus/v1/';

/**
 * In-flight and settled chunk promises, per assets object and keyed by the chunk's content hash.
 * Chunk names are hashed, so a hash names immutable content. Keying by assets keeps two
 * platforms (or two test fakes) from sharing a cache.
 */
const chunkCaches = new WeakMap<CorpusAssets, Map<string, Promise<ExcerptChunk>>>();

function cacheFor(assets: CorpusAssets): Map<string, Promise<ExcerptChunk>> {
  let cache = chunkCaches.get(assets);
  if (!cache) {
    cache = new Map();
    chunkCaches.set(assets, cache);
  }
  return cache;
}

/** Fetches one corpus JSON file. Synchronous throws from the fetch become rejections. */
export function fetchCorpusJson<T>(assets: CorpusAssets, file: string): Promise<T> {
  return Promise.resolve()
    .then(() => assets.getJson<T>(CORPUS_ROOT + file))
    .catch((cause: unknown) => {
      throw new CorpusLoadError('fetch-failed', `cannot fetch corpus file ${file}`, { cause });
    });
}

function checkChunk(chunk: ExcerptChunk, shard: string): ExcerptChunk {
  if (chunk.schemaVersion !== 1 || chunk.shard !== shard || !Array.isArray(chunk.excerpts)) {
    throw new CorpusLoadError('malformed', `chunk for ${shard} has the wrong schemaVersion, shard name or shape`);
  }
  return chunk;
}

/**
 * Returns the chunk for `shard`, fetching it only if it is not already cached. A failed fetch or
 * a malformed chunk is evicted, so the next call retries it.
 */
export function fetchChunk(m: CorpusManifest, shard: string, assets: CorpusAssets): Promise<ExcerptChunk> {
  const ref = m.chunks[shard];
  if (!ref) {
    return Promise.reject(new CorpusLoadError('malformed', `manifest has no chunk for ${shard}`));
  }
  const cache = cacheFor(assets);
  const cached = cache.get(ref.hash);
  if (cached) return cached;

  const pending: Promise<ExcerptChunk> = fetchCorpusJson<ExcerptChunk>(assets, ref.file).then((chunk) => checkChunk(chunk, shard));
  cache.set(ref.hash, pending);
  pending.catch(() => {
    if (cache.get(ref.hash) === pending) cache.delete(ref.hash);
  });
  return pending;
}

/**
 * Fetches the chunks of levels `level - 1`, `level` and `level + 1` once `idle` runs the task
 * (01 §6.2: "prefetch ... in idle time"). The caller supplies the scheduler, for example a
 * requestIdleCallback wrapper. Chunks of the level itself come first. Failures are swallowed
 * here and retried on demand. The returned promise never rejects.
 */
export function prefetchNeighbours(
  m: CorpusManifest,
  level: number,
  assets: CorpusAssets,
  idle: (run: () => void) => void,
): Promise<void> {
  const shards = new Map<string, number>();
  for (const e of m.entries) {
    const distance = Math.abs(e.level - level);
    if (distance > 1) continue;
    const best = shards.get(e.shard);
    if (best === undefined || distance < best) shards.set(e.shard, distance);
  }
  const order = [...shards.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([shard]) => shard);

  return new Promise<void>((resolve) => {
    idle(() => {
      void runSequentially(order, (shard) => fetchChunk(m, shard, assets)).then(resolve);
    });
  });
}

async function runSequentially(shards: readonly string[], load: (shard: string) => Promise<unknown>): Promise<void> {
  for (const shard of shards) {
    try {
      await load(shard);
    } catch {
      // The chunk was evicted from the cache; loadExcerpt retries it when the excerpt is needed.
    }
  }
}
