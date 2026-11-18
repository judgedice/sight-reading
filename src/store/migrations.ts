/**
 * Export-file migrations (01 section 11): one pure function per version step, each taking a file at version n
 * and returning one at version n+1. Individual documents carry their own `schemaVersion`; none has moved past 1.
 */
import { defaultAppSettings } from './defaults.ts';

export const CURRENT_EXPORT_VERSION = 1;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * v0 (pre-release export) to v1: adds `kv`, `settings.shown` and the attempt flag `countsAsSkip`.
 */
export function migrateV0ToV1(f: Obj): Obj {
  const out: Obj = { ...f, version: 1 };
  if (!isObj(out['kv'])) out['kv'] = {};
  const settings = isObj(out['settings']) ? { ...out['settings'] } : (defaultAppSettings() as unknown as Obj);
  if (!isObj(settings['shown'])) settings['shown'] = { installCoach: false, autoLockHint: false };
  out['settings'] = settings;
  if (Array.isArray(out['attempts'])) {
    out['attempts'] = out['attempts'].map((a: unknown) => (isObj(a) && a['countsAsSkip'] === undefined ? { ...a, countsAsSkip: false } : a));
  }
  return out;
}

/** `MIGRATIONS[n]` upgrades a version-n file to version n+1. */
export const MIGRATIONS: Readonly<Record<number, (f: Obj) => Obj>> = {
  0: migrateV0ToV1,
};

export class MigrationError extends Error {
  constructor(
    readonly code: 'newer-version' | 'unknown-version',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Upgrades an export-file-shaped value to the current version. Does not validate the result. */
export function migrateExport(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  let version = raw['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new MigrationError('unknown-version', 'Unknown export version.');
  }
  if (version > CURRENT_EXPORT_VERSION) {
    throw new MigrationError('newer-version', 'This backup was made by a newer version of Sightread.');
  }
  let cur: Obj = raw;
  while (version < CURRENT_EXPORT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new MigrationError('unknown-version', `No migration from version ${version}.`);
    cur = step(cur);
    version += 1;
  }
  return cur;
}
