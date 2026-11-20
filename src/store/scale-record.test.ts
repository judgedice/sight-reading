// Scale tries in the store (PLAN ruling 68): `kind` and `scale` are additive and optional. A backup made before scales
// existed imports unchanged and reads as excerpts; a backup with scale tries round-trips with its labels. No store or
// export migration is needed: the export stays at version 1 and the IndexedDB schema at version 1.
import { describe, expect, it } from 'vitest';
import type { AttemptRecord, ScaleRef } from '../core/types.ts';
import { MemoryKv, makeAttempt, memoryRepos } from './test-data.ts';
import { exportAll, importAll, parseExportFile } from './export-import.ts';
import { CURRENT_EXPORT_VERSION } from './migrations.ts';
import { summarizeAttempt } from './summary.ts';

const REF: ScaleRef = {
  id: 'five-note-c',
  pattern: 'five-note',
  degrees: [1, 2, 3, 4, 5, 4, 3, 2, 1],
  tonic: { step: 'C', alter: 0, octave: 3 },
  mode: 'major',
  meter: '4/4',
  noteBeats: 1,
  minLastBeats: 2,
};

const scaleTry = (i: number): AttemptRecord => {
  const a = makeAttempt(i, { instrumentId: 'voice-baritone', excerptId: 'scale:voice-baritone:five-note-c', kind: 'scale', scale: REF });
  return { ...a, credit: { ...a.credit, composer: '', work: REF.id, corpus: 'generated', license: 'PD' } };
};

describe('scale tries in the store (PLAN ruling 68)', () => {
  it('a backup with a scale try and an older excerpt try round-trips; the older one has no kind and reads as an excerpt', async () => {
    const kv = new MemoryKv();
    const repos = memoryRepos(kv);
    const old = makeAttempt(0);
    expect('kind' in old).toBe(false);
    await repos.attempts.add(old);
    await repos.attempts.add(scaleTry(1));
    const file = await exportAll(repos, kv);
    expect(file.version).toBe(CURRENT_EXPORT_VERSION);
    expect(CURRENT_EXPORT_VERSION).toBe(1);
    // The precompiled validator accepts both shapes.
    const parsed = parseExportFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.attempts.map((a) => a.kind ?? 'excerpt').sort()).toEqual(['excerpt', 'scale']);

    const kv2 = new MemoryKv();
    const back = memoryRepos(kv2);
    await importAll(back, JSON.parse(JSON.stringify(file)), kv2);
    const all = await back.attempts.all();
    expect(all.find((a) => a.kind === 'scale')).toMatchObject({ scale: REF, excerptId: 'scale:voice-baritone:five-note-c' });
    expect(summarizeAttempt(all.find((a) => a.kind === undefined)!)).not.toHaveProperty('kind');
    expect(summarizeAttempt(all.find((a) => a.kind === 'scale')!)).toMatchObject({ kind: 'scale', scale: REF });
  });

  it('the validator refuses an unknown kind', async () => {
    const kv = new MemoryKv();
    const repos = memoryRepos(kv);
    await repos.attempts.add(scaleTry(0));
    const file = JSON.parse(JSON.stringify(await exportAll(repos, kv))) as { attempts: Record<string, unknown>[] };
    expect(() => parseExportFile(file)).not.toThrow();
    file.attempts[0]!['kind'] = 'etude';
    expect(() => parseExportFile(file)).toThrow();
  });
});
