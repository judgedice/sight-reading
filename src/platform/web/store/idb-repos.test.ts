import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { exportAll, importAll } from '../../../store/export-import.ts';
import { KV_PERSIST_REQUESTED } from '../../../store/keys.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { acknowledgeStorageLoss, checkStorage, type InstallMirror } from '../../../store/storage-loss.ts';
import { makeAttempt, makeCalibration, makeProfile, makeScore } from '../../../store/test-data.ts';
import { LocalStorageMirror } from './local-mirror.ts';
import { openStore, type OpenedStore } from './idb-repos.ts';
import { requestPersistOnce } from './persist.ts';
import type { AttemptRecord } from '../../../core/types.ts';

let s: OpenedStore;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  s = await openStore();
});
afterEach(() => s.close());

const ranked = (score: number): Partial<AttemptRecord> => ({ score: makeScore(score), endReason: 'complete' });

describe('profile and settings', () => {
  it('get is undefined until put; put replaces', async () => {
    expect(await s.repos.profile.get()).toBeUndefined();
    await s.repos.profile.put(makeProfile());
    await s.repos.profile.put(makeProfile({ id: 'other', xp: 5 }));
    expect((await s.repos.profile.get())?.id).toBe('other');
  });
  it('settings default, then persist', async () => {
    expect(await s.repos.settings.get()).toEqual(defaultAppSettings());
    const next = { ...defaultAppSettings(), onboardingDone: true };
    await s.repos.settings.put(next);
    expect(await s.repos.settings.get()).toEqual(next);
  });
});

describe('attempts', () => {
  beforeEach(async () => {
    for (let i = 0; i < 30; i++) await s.repos.attempts.add(makeAttempt(i, i % 3 === 0 ? ranked(50 + i) : {}));
  });
  it('recent is newest first and bounded', async () => {
    const r = await s.repos.attempts.recent(5);
    expect(r.map((a) => a.id)).toEqual([29, 28, 27, 26, 25].map((i) => makeAttempt(i).id));
    expect(await s.repos.attempts.recent(0)).toEqual([]);
    expect(await s.repos.attempts.recent(100)).toHaveLength(30);
  });
  it('byId', async () => {
    expect((await s.repos.attempts.byId(makeAttempt(7).id))?.excerptId).toBe('ex-2');
    expect(await s.repos.attempts.byId('nope')).toBeUndefined();
  });
  it('add rejects a duplicate id', async () => {
    await expect(s.repos.attempts.add(makeAttempt(1))).rejects.toThrow();
  });
  it('all is oldest first', async () => {
    const all = await s.repos.attempts.all();
    expect(all.map((a) => a.id)).toEqual(Array.from({ length: 30 }, (_, i) => makeAttempt(i).id));
  });
  it('list filters, orders, pages', async () => {
    expect(await s.repos.attempts.list({})).toHaveLength(30);
    expect((await s.repos.attempts.list({ instrumentId: 'flute' })).every((x) => x.instrumentId === 'flute')).toBe(true);
    expect(await s.repos.attempts.list({ excerptId: 'ex-1' })).toHaveLength(6);
    const rk = await s.repos.attempts.list({ rankedOnly: true });
    expect(rk).toHaveLength(10);
    expect(rk[0]).toMatchObject({ ranked: true, score: 50 + 27, grade: 'B', xp: 10, title: 'Work 27', composer: 'Composer' });
    const page = await s.repos.attempts.list({ limit: 5, offset: 5 });
    expect(page.map((x) => x.id)).toEqual([24, 23, 22, 21, 20].map((i) => makeAttempt(i).id));
    const from = makeAttempt(10).createdAt;
    const to = makeAttempt(12).createdAt;
    expect((await s.repos.attempts.list({ from, to })).map((x) => x.id)).toEqual([12, 11, 10].map((i) => makeAttempt(i).id));
    expect(await s.repos.attempts.list({ from: to, to: from })).toEqual([]);
    expect(await s.repos.attempts.list({ from })).toHaveLength(20);
    expect(await s.repos.attempts.list({ to })).toHaveLength(13);
  });
  it('unscored attempts summarise with null score and grade', async () => {
    const x = (await s.repos.attempts.list({ limit: 1 }))[0];
    expect(x).toMatchObject({ ranked: false, score: null, grade: null, xp: 0 });
  });
  it('pruneDebug drops debug older than 7 days only', async () => {
    const old = makeAttempt(100, { createdAt: '2026-01-01T00:00:00.000Z', debug: { live: [] } });
    const fresh = makeAttempt(101, { createdAt: '2026-01-09T00:00:00.000Z', debug: { live: [] } });
    await s.repos.attempts.add(old);
    await s.repos.attempts.add(fresh);
    expect(await s.repos.pruneDebug('2026-01-10T00:00:00.000Z')).toBe(1);
    expect((await s.repos.attempts.byId(old.id))?.debug).toBeUndefined();
    expect((await s.repos.attempts.byId(fresh.id))?.debug).toBeDefined();
  });
});

describe('calibrations and kv', () => {
  it('put, get, replace, all', async () => {
    expect(await s.repos.calibrations.get('a')).toBeUndefined();
    await s.repos.calibrations.put(makeCalibration('a'));
    await s.repos.calibrations.put({ ...makeCalibration('a'), roundTripMs: 99 });
    await s.repos.calibrations.put(makeCalibration('b'));
    expect((await s.repos.calibrations.get('a'))?.roundTripMs).toBe(99);
    expect(await s.repos.calibrations.all()).toHaveLength(2);
  });
  it('kv set, get, delete, keys', async () => {
    await s.kv.set('x', { a: [1, 'b'] });
    await s.kv.set('y', null);
    expect(await s.kv.get('x')).toEqual({ a: [1, 'b'] });
    expect((await s.kv.keys()).sort()).toEqual(['x', 'y']);
    await s.kv.delete('x');
    expect(await s.kv.get('x')).toBeUndefined();
  });
  it('clearAll empties every store', async () => {
    await s.repos.profile.put(makeProfile());
    await s.repos.attempts.add(makeAttempt(1));
    await s.repos.calibrations.put(makeCalibration('a'));
    await s.repos.settings.put({ ...defaultAppSettings(), onboardingDone: true });
    await s.kv.set('x', 1);
    await s.repos.clearAll();
    expect(await s.repos.profile.get()).toBeUndefined();
    expect(await s.repos.attempts.all()).toEqual([]);
    expect(await s.repos.calibrations.all()).toEqual([]);
    expect(await s.kv.keys()).toEqual([]);
    expect(await s.repos.settings.get()).toEqual(defaultAppSettings());
  });
  it('reopening keeps data', async () => {
    await s.repos.profile.put(makeProfile());
    s.close();
    s = await openStore();
    expect(await s.repos.profile.get()).toBeDefined();
  });
});

describe('export and import on IndexedDB', () => {
  it('round trip is deep-equal', async () => {
    await s.repos.profile.put(makeProfile());
    for (let i = 0; i < 5; i++) await s.repos.attempts.add(makeAttempt(i, i === 2 ? ranked(80) : {}));
    await s.repos.calibrations.put(makeCalibration('a'));
    await s.repos.settings.put({ ...defaultAppSettings(), onboardingDone: true });
    await s.kv.set('note', { n: 1 });
    await s.kv.set(KV_PERSIST_REQUESTED, true);
    const file = await exportAll(s.repos, s.kv);
    expect(file.kv).toEqual({ note: { n: 1 } });

    globalThis.indexedDB = new IDBFactory();
    const t = await openStore('other');
    await importAll(t.repos, JSON.parse(JSON.stringify(file)), t.kv);
    const again = await exportAll(t.repos, t.kv);
    expect({ ...again, exportedAt: '' }).toEqual({ ...file, exportedAt: '' });
    t.close();
  });
  it('imports the committed v0 fixture', async () => {
    const v0 = (await import('../../../store/fixtures/export-v0.json')).default;
    await importAll(s.repos, structuredClone(v0), s.kv);
    expect(await s.repos.attempts.all()).toHaveLength(2);
    expect((await s.repos.settings.get()).shown.installCoach).toBe(false);
  });
});

describe('storage loss on IndexedDB', () => {
  it('detects IndexedDB wiped while the mirror survives, and recovers on acknowledge', async () => {
    const store = new Map<string, string>();
    const mirror = new LocalStorageMirror({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    let n = 0;
    const deps = () => ({ kv: s.kv, repos: s.repos, mirror, idGen: () => `id-${++n}`, clockWall: () => '2026-01-01T00:00:00.000Z' });
    expect((await checkStorage(deps())).status).toBe('first-run');
    await s.repos.profile.put(makeProfile());
    expect((await checkStorage(deps())).status).toBe('ok');
    s.close();
    globalThis.indexedDB = new IDBFactory(); // Safari evicted the database
    s = await openStore();
    expect((await checkStorage(deps())).status).toBe('lost');
    await acknowledgeStorageLoss(deps());
    expect((await checkStorage(deps())).status).toBe('ok');
  });
  it('LocalStorageMirror survives a throwing storage', () => {
    const m: InstallMirror = new LocalStorageMirror({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
    expect(m.get()).toBeNull();
    expect(() => m.set('a')).not.toThrow();
  });
});

describe('persist', () => {
  it('calls persist() exactly once', async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistOnce(s.kv, { persist })).toBe(true);
    expect(await requestPersistOnce(s.kv, { persist })).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('is a no-op without the API and swallows a rejection', async () => {
    expect(await requestPersistOnce(s.kv, undefined)).toBeNull();
    expect(await requestPersistOnce(s.kv, { persist: async () => { throw new Error('no'); } })).toBe(false);
  });
});
