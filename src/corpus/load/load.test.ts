// Corpus loading against fixtures/corpus/ (01 §13.1 corpus, 03 §11 items 7 and 9). The fake assets
// serve the fixture files by basename and record every request, so fetch counts are exact.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CorpusApi } from '../../core/api.ts';
import type { CorpusIndex, CorpusManifest, ExcerptChunk, ManifestEntry, ManifestFile } from '../../core/types.ts';
import { decodeCorpusManifest, decodeManifestEntries } from './decode.ts';
import { CorpusLoadError } from './errors.ts';
import { loadExcerpt, loadManifest, prefetchNeighbours } from './index.ts';
import type { CorpusAssets } from './chunks.ts';

const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/corpus/', import.meta.url));
const readFixture = <T>(name: string): T => JSON.parse(readFileSync(FIXTURE_DIR + name, 'utf8')) as T;

const LEVEL5_ID = 'arriaga-sq34038344-viola-mv4-m154-163';
const LEVEL5_SHARD = 'shard-L05-01';

interface FakeOptions {
  /** Serve these parsed objects instead of the fixture file of the same basename. */
  overrides?: Record<string, unknown>;
  /** Throw on the first `count` requests for a basename. */
  failFirst?: Record<string, number>;
}

function fakeAssets(options: FakeOptions = {}): { assets: CorpusAssets; requests: string[] } {
  const requests: string[] = [];
  const failures = new Map(Object.entries(options.failFirst ?? {}));
  const assets: CorpusAssets = {
    getJson<T>(relPath: string): Promise<T> {
      requests.push(relPath);
      const name = relPath.slice(relPath.lastIndexOf('/') + 1);
      const left = failures.get(name) ?? 0;
      if (left > 0) {
        failures.set(name, left - 1);
        return Promise.reject(new Error(`simulated network failure for ${name}`));
      }
      if (options.overrides && name in options.overrides) {
        return Promise.resolve(options.overrides[name] as T);
      }
      return Promise.resolve(readFixture<T>(name));
    },
  };
  return { assets, requests };
}

const golden = readFixture<ManifestEntry[]>('manifest-entries.json');
const manifestFile = readFixture<ManifestFile>('manifest.3a2136cde3.json');
const indexFile = readFixture<CorpusIndex>('index.json');

async function loadFixtureManifest(options?: FakeOptions): Promise<{ m: CorpusManifest; assets: CorpusAssets; requests: string[] }> {
  const fake = fakeAssets(options);
  const m = await loadManifest(fake.assets);
  return { m, ...fake };
}

describe('manifest decode', () => {
  it('decodes the column manifest to the golden ManifestEntry objects', () => {
    const entries = decodeManifestEntries(manifestFile);
    expect(entries).toHaveLength(golden.length);
    expect(entries).toEqual(golden);
  });

  it('decodes dictionary and tag columns to strings', () => {
    const entries = decodeManifestEntries(manifestFile);
    const first = entries[0];
    expect(first?.composer).toBe('Juan Crisóstomo de Arriaga');
    expect(first?.tags).toEqual(['accidentals', 'quartet', 'repeated-notes', 'rests', 'role:viola', 'slurred-run', 'source-clef:alto']);
  });

  it('omits originalFamily when its cell is null', () => {
    const file: ManifestFile = {
      ...manifestFile,
      rows: manifestFile.rows.map((r, i) => (i === 0 ? r.map((c, j) => (manifestFile.columns[j] === 'originalFamily' ? null : c)) : r)),
    };
    const first = decodeManifestEntries(file)[0];
    expect(first).toBeDefined();
    expect('originalFamily' in (first as ManifestEntry)).toBe(false);
  });

  it('rejects a row with the wrong number of cells', () => {
    const file: ManifestFile = { ...manifestFile, rows: [[...(manifestFile.rows[0] ?? []), 'extra']] };
    expect(() => decodeManifestEntries(file)).toThrow(CorpusLoadError);
  });

  it('rejects an out-of-range dictionary index', () => {
    const j = manifestFile.columns.indexOf('composer');
    const rows = manifestFile.rows.map((r, i) => (i === 0 ? r.map((c, k) => (k === j ? 999 : c)) : r));
    expect(() => decodeManifestEntries({ ...manifestFile, rows })).toThrow(/out of range/);
  });

  it('rejects a manifest missing a required column', () => {
    const drop = manifestFile.columns.indexOf('bars');
    const file: ManifestFile = {
      ...manifestFile,
      columns: manifestFile.columns.filter((_, j) => j !== drop),
      rows: manifestFile.rows.map((r) => r.filter((_, j) => j !== drop)),
    };
    expect(() => decodeManifestEntries(file)).toThrow(/no bars column/);
  });

  it('rejects an entry whose shard is not listed in index.json', () => {
    const index: CorpusIndex = { ...indexFile, chunks: indexFile.chunks.filter((c) => c.shard !== LEVEL5_SHARD) };
    const withdrawn = { schemaVersion: 1 as const, ids: [] };
    expect(() => decodeCorpusManifest(index, manifestFile, withdrawn)).toThrow(/does not list/);
  });

  it('rejects files with a mismatched corpus version or schema version', () => {
    const withdrawn = { schemaVersion: 1 as const, ids: [] };
    expect(() => decodeCorpusManifest(indexFile, { ...manifestFile, corpusVersion: 'other' }, withdrawn)).toThrow(/names corpus/);
    expect(() => decodeCorpusManifest({ ...indexFile, schemaVersion: 2 as unknown as 1 }, manifestFile, withdrawn)).toThrow(/schemaVersion/);
  });
});

describe('loadManifest', () => {
  it('fetches index, manifest and withdrawn, and no excerpt chunk', async () => {
    const { m, requests } = await loadFixtureManifest();
    expect(requests).toEqual([
      'corpus/v1/index.json',
      `corpus/v1/${indexFile.manifest.file}`,
      'corpus/v1/withdrawn.json',
    ]);
    expect(m.corpusVersion).toBe(indexFile.corpusVersion);
    expect(m.entries).toEqual(golden);
    expect(m.stats).toEqual(manifestFile.stats);
    expect(Object.keys(m.chunks).sort()).toEqual(indexFile.chunks.map((c) => c.shard).sort());
    expect(m.chunks[LEVEL5_SHARD]).toEqual({
      file: indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.file,
      hash: indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.hash,
      bytes: indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.bytes,
    });
    expect(m.attributions).toEqual(indexFile.attributions);
    expect(m.withdrawn).toEqual([]);
  });

  it('carries withdrawn ids from withdrawn.json into the manifest', async () => {
    const { m } = await loadFixtureManifest({ overrides: { 'withdrawn.json': { schemaVersion: 1, ids: [LEVEL5_ID] } } });
    expect(m.withdrawn).toEqual([LEVEL5_ID]);
  });
});

describe('loadExcerpt', () => {
  it('fetches only the chunk that holds the id, and reuses it', async () => {
    const { m, assets, requests } = await loadFixtureManifest();
    const before = requests.length;

    const doc = await loadExcerpt(m, LEVEL5_ID, assets);
    expect(doc.id).toBe(LEVEL5_ID);
    expect(requests.slice(before)).toEqual([`corpus/v1/${indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.file}`]);

    const sameChunk = await loadExcerpt(m, golden.find((e) => e.shard === LEVEL5_SHARD && e.id !== LEVEL5_ID)?.id ?? '', assets);
    expect(sameChunk.id).not.toBe(LEVEL5_ID);
    expect(requests.length).toBe(before + 1);
  });

  it('returns the excerpt document exactly as the chunk holds it', async () => {
    const { m, assets } = await loadFixtureManifest();
    const chunkFile = indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.file ?? '';
    const chunk = readFixture<ExcerptChunk>(chunkFile);
    const expected = chunk.excerpts.find((x) => x.id === LEVEL5_ID);
    expect(await loadExcerpt(m, LEVEL5_ID, assets)).toEqual(expected);
  });

  it('refuses an id in withdrawn.json even when its chunk is cached', async () => {
    const first = await loadFixtureManifest();
    await loadExcerpt(first.m, LEVEL5_ID, first.assets);
    const chunkRequests = first.requests.filter((r) => r.includes(LEVEL5_SHARD)).length;

    const withdrawn = { schemaVersion: 1, ids: [LEVEL5_ID] };
    const { m: later } = await loadFixtureManifest({ overrides: { 'withdrawn.json': withdrawn } });
    const cached = { ...first.m, withdrawn: [LEVEL5_ID] };
    await expect(loadExcerpt(later, LEVEL5_ID, first.assets)).rejects.toMatchObject({ code: 'withdrawn' });
    await expect(loadExcerpt(cached, LEVEL5_ID, first.assets)).rejects.toMatchObject({ code: 'withdrawn' });
    expect(first.requests.filter((r) => r.includes(LEVEL5_SHARD)).length).toBe(chunkRequests);
  });

  it('rejects an id that is not in the manifest', async () => {
    const { m, assets } = await loadFixtureManifest();
    await expect(loadExcerpt(m, 'no-such-excerpt', assets)).rejects.toMatchObject({ code: 'unknown-id' });
  });

  it('retries a chunk whose fetch failed', async () => {
    const chunkFile = indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.file ?? '';
    const { m, assets, requests } = await loadFixtureManifest({ failFirst: { [chunkFile]: 1 } });
    await expect(loadExcerpt(m, LEVEL5_ID, assets)).rejects.toMatchObject({ code: 'fetch-failed' });
    const doc = await loadExcerpt(m, LEVEL5_ID, assets);
    expect(doc.id).toBe(LEVEL5_ID);
    expect(requests.filter((r) => r.endsWith(chunkFile)).length).toBe(2);
  });

  it('rejects a chunk whose shard name does not match the manifest', async () => {
    const chunkFile = indexFile.chunks.find((c) => c.shard === LEVEL5_SHARD)?.file ?? '';
    const bad = { ...readFixture<ExcerptChunk>(chunkFile), shard: 'shard-L99-99' };
    const { m, assets } = await loadFixtureManifest({ overrides: { [chunkFile]: bad } });
    await expect(loadExcerpt(m, LEVEL5_ID, assets)).rejects.toMatchObject({ code: 'malformed' });
  });
});

describe('prefetchNeighbours', () => {
  it('fetches the chunks of levels L-1, L and L+1 and nothing else', async () => {
    const { m, assets, requests } = await loadFixtureManifest();
    const before = requests.length;
    await prefetchNeighbours(m, 5, assets, (run) => run());

    const fetchedShards = requests.slice(before).map((r) => m.entries.find((e) => r.endsWith(m.chunks[e.shard]?.file ?? '~'))?.shard);
    expect(new Set(fetchedShards)).toEqual(new Set(['shard-L04-01', 'shard-L05-01', 'shard-L06-01']));
    expect(requests.slice(before)).toHaveLength(3);
  });

  it('does not refetch chunks already cached', async () => {
    const { m, assets, requests } = await loadFixtureManifest();
    await loadExcerpt(m, LEVEL5_ID, assets);
    const before = requests.length;
    await prefetchNeighbours(m, 5, assets, (run) => run());
    expect(requests.length - before).toBe(2);
  });

  it('waits for the injected idle scheduler before fetching', async () => {
    const { m, assets, requests } = await loadFixtureManifest();
    const before = requests.length;
    const queued: (() => void)[] = [];
    const done = prefetchNeighbours(m, 1, assets, (run) => queued.push(run));
    expect(requests.length).toBe(before);
    queued.forEach((run) => run());
    await done;
    expect(requests.length).toBeGreaterThan(before);
  });

  it('never rejects, and a failed chunk is fetched again on demand', async () => {
    const chunkFile = indexFile.chunks.find((c) => c.shard === 'shard-L04-01')?.file ?? '';
    const { m, assets, requests } = await loadFixtureManifest({ failFirst: { [chunkFile]: 1 } });
    await expect(prefetchNeighbours(m, 5, assets, (run) => run())).resolves.toBeUndefined();
    const before = requests.length;
    await prefetchNeighbours(m, 5, assets, (run) => run());
    expect(requests.slice(before).filter((r) => r.endsWith(chunkFile))).toHaveLength(1);
  });
});

describe('api conformance', () => {
  it('exports loadManifest and loadExcerpt with the CorpusApi signatures', () => {
    const api: Pick<CorpusApi, 'loadManifest' | 'loadExcerpt'> = { loadManifest, loadExcerpt };
    expect(typeof api.loadManifest).toBe('function');
    expect(typeof api.loadExcerpt).toBe('function');
  });
});
