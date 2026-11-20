import { describe, expect, it } from 'vitest';
import v0 from './fixtures/export-v0.json';
import { exportAll, importAll, parseExportFile, StoreImportError, NOT_A_BACKUP_MESSAGE } from './export-import.ts';
import { migrateExport } from './migrations.ts';
import { acknowledgeStorageLoss, checkStorage, type InstallMirror, type StorageLossDeps } from './storage-loss.ts';
import { defaultAppSettings } from './defaults.ts';
import { normaliseSettings } from './settings-read.ts';
import { KV_INSTALL } from './keys.ts';
import { MemoryKv, makeAttempt, makeCalibration, makeProfile, memoryRepos } from './test-data.ts';

describe('settings read (round 2 defaults)', () => {
  it('fills autoReference, ghostsLive and showHeard on an older record', () => {
    const old = defaultAppSettings();
    delete old.practice.autoReference;
    delete old.display.ghostsLive;
    delete old.display.showHeard;
    const read = normaliseSettings(old);
    expect(read.practice.autoReference).toBe(true);
    expect(read.display.ghostsLive).toBe('from4');
    expect(read.display.showHeard).toBe(false);
  });
  it('keeps stored values and returns the same object when complete', () => {
    const s = defaultAppSettings();
    s.practice.autoReference = false;
    s.display.ghostsLive = 'never';
    s.display.showHeard = true;
    expect(normaliseSettings(s)).toBe(s);
  });
  it('rejects an unknown ghostsLive value', () => {
    const s = defaultAppSettings();
    (s.display as { ghostsLive?: string }).ghostsLive = 'sometimes';
    expect(normaliseSettings(s).display.ghostsLive).toBe('from4');
  });
});

describe('migrations', () => {
  it('upgrades the committed v0 fixture to a valid v1 file', () => {
    const f = parseExportFile(structuredClone(v0));
    expect(f.version).toBe(1);
    expect(f.kv).toEqual({});
    expect(f.settings.shown).toEqual({ installCoach: false, autoLockHint: false });
    expect(f.attempts.every((a) => a.countsAsSkip === false)).toBe(true);
    expect(f.attempts).toHaveLength(2);
  });
  it('rejects a newer version with its own code', () => {
    expect(() => parseExportFile({ ...structuredClone(v0), version: 2 })).toThrow(StoreImportError);
    try {
      parseExportFile({ ...structuredClone(v0), version: 2 });
    } catch (e) {
      expect((e as StoreImportError).code).toBe('newer-version');
    }
  });
  it('passes non-objects through for the validator to reject', () => {
    expect(migrateExport(5)).toBe(5);
  });
});

describe('export and import', () => {
  async function seeded() {
    const kv = new MemoryKv();
    const r = memoryRepos(kv);
    await r.profile.put(makeProfile());
    for (let i = 0; i < 4; i++) await r.attempts.add(makeAttempt(i));
    await r.calibrations.put(makeCalibration('a'));
    await kv.set('hint-seen', { a: [1, 2, null] });
    await kv.set(KV_INSTALL, { installId: 'dev-1', createdAt: 'x', hadProfile: true });
    return { kv, r };
  }

  it('round-trips deep-equal and keeps device-local keys out of the file', async () => {
    const { kv, r } = await seeded();
    const file = await exportAll(r, kv);
    expect(Object.keys(file.kv)).toEqual(['hint-seen']);
    const kv2 = new MemoryKv();
    const r2 = memoryRepos(kv2);
    await kv2.set(KV_INSTALL, { installId: 'dev-2', createdAt: 'y', hadProfile: false });
    await importAll(r2, JSON.parse(JSON.stringify(file)), kv2);
    const again = await exportAll(r2, kv2);
    expect({ ...again, exportedAt: '' }).toEqual({ ...file, exportedAt: '' });
    expect(await kv2.get(KV_INSTALL)).toEqual({ installId: 'dev-2', createdAt: 'y', hadProfile: false });
  });

  it('replaces existing data', async () => {
    const { kv, r } = await seeded();
    const file = await exportAll(r, kv);
    await r.attempts.add(makeAttempt(99));
    await kv.set('extra', 1);
    await importAll(r, file, kv);
    expect(await r.attempts.byId(makeAttempt(99).id)).toBeUndefined();
    expect(await kv.get('extra')).toBeUndefined();
  });

  it('rejects garbage and touches nothing', async () => {
    const { kv, r } = await seeded();
    for (const bad of [null, 'x', {}, { format: 'other' }, { format: 'sightread-export', version: 1 }]) {
      await expect(importAll(r, bad, kv)).rejects.toThrow(NOT_A_BACKUP_MESSAGE);
    }
    const file = await exportAll(r, kv);
    const broken = { ...file, attempts: [{ ...file.attempts[0], bpm: 'fast' }] };
    await expect(importAll(r, broken, kv)).rejects.toBeInstanceOf(StoreImportError);
    expect(await r.attempts.all()).toHaveLength(4);
    expect(await r.profile.get()).toBeDefined();
  });

  it('imports a file with no profile', async () => {
    const { kv, r } = await seeded();
    const file = { ...(await exportAll(r, kv)), profile: null };
    await importAll(r, file, kv);
    expect(await r.profile.get()).toBeUndefined();
  });
});

describe('storage-loss detector', () => {
  function setup() {
    const kv = new MemoryKv();
    const r = memoryRepos(kv);
    let stored: string | null = null;
    const mirror: InstallMirror = { get: () => stored, set: (id) => { stored = id; } };
    let n = 0;
    const deps: StorageLossDeps = { kv, repos: r, mirror, idGen: () => `id-${++n}`, clockWall: () => '2026-01-01T00:00:00.000Z' };
    return { kv, r, mirror, deps, clearMirror: () => { stored = null; } };
  }

  it('first run writes both markers and reports first-run, then ok', async () => {
    const s = setup();
    expect((await checkStorage(s.deps)).status).toBe('first-run');
    expect(s.mirror.get()).toBe('id-1');
    expect((await checkStorage(s.deps)).status).toBe('ok');
  });
  it('marker without mirror is lost', async () => {
    const s = setup();
    await checkStorage(s.deps);
    s.clearMirror();
    expect((await checkStorage(s.deps)).status).toBe('lost');
  });
  it('mirror without marker is lost (IndexedDB wiped)', async () => {
    const s = setup();
    await checkStorage(s.deps);
    await s.kv.delete(KV_INSTALL);
    expect((await checkStorage(s.deps)).status).toBe('lost');
  });
  it('marker present but profile gone is lost only after a profile existed', async () => {
    const s = setup();
    await checkStorage(s.deps);
    expect((await checkStorage(s.deps)).status).toBe('ok'); // onboarding not finished: no profile yet
    await s.r.profile.put(makeProfile());
    expect((await checkStorage(s.deps)).status).toBe('ok'); // records hadProfile
    await s.r.clearAll();
    await s.kv.set(KV_INSTALL, { installId: 'id-1', createdAt: 'x', hadProfile: true });
    expect((await checkStorage(s.deps)).status).toBe('lost');
  });
  it('acknowledging starts a fresh pair', async () => {
    const s = setup();
    await checkStorage(s.deps);
    s.clearMirror();
    await acknowledgeStorageLoss(s.deps);
    expect((await checkStorage(s.deps)).status).toBe('ok');
  });
});
