/** Export and import (01 sections 5.9 and 11). Platform-neutral: works on any `StoreRepos` and `KeyValue`. */
import Ajv from 'ajv';
import type { ExportFileV1, JsonValue } from '../core/types.ts';
import type { KeyValue, StoreRepos } from '../core/platform.ts';
import type { StoreApi } from '../core/api.ts';
import exportSchema from '../../schemas/export-file.schema.json';
import { isReservedKvKey } from './keys.ts';
import { CURRENT_EXPORT_VERSION, MigrationError, migrateExport } from './migrations.ts';

/** 04 copy: "That file isn't a Sightread backup." */
export const NOT_A_BACKUP_MESSAGE = "That file isn't a Sightread backup.";

export class StoreImportError extends Error {
  constructor(
    readonly code: 'not-a-backup' | 'newer-version',
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'StoreImportError';
  }
}

let exportAppVersion = '0.0.0';
/** The composition root sets the build's version once at start-up; `exportAll` stamps it on the file. */
export function setExportAppVersion(v: string): void {
  exportAppVersion = v;
}

const ajv = new Ajv({ strict: false, allErrors: false });
const validateFile = ajv.compile(exportSchema);

/** Migrates and validates; throws `StoreImportError`. */
export function parseExportFile(f: unknown): ExportFileV1 {
  if (typeof f !== 'object' || f === null || (f as { format?: unknown }).format !== 'sightread-export') {
    throw new StoreImportError('not-a-backup', NOT_A_BACKUP_MESSAGE);
  }
  let migrated: unknown;
  try {
    migrated = migrateExport(f);
  } catch (e) {
    if (e instanceof MigrationError) {
      if (e.code === 'newer-version') throw new StoreImportError('newer-version', e.message);
      throw new StoreImportError('not-a-backup', NOT_A_BACKUP_MESSAGE, e.message);
    }
    throw e;
  }
  if (!validateFile(migrated)) {
    const first = validateFile.errors?.[0];
    throw new StoreImportError('not-a-backup', NOT_A_BACKUP_MESSAGE, first ? `${first.instancePath} ${first.message ?? ''}`.trim() : undefined);
  }
  return migrated as unknown as ExportFileV1;
}

export const exportAll: StoreApi['exportAll'] = async (r, kv) => {
  const kvOut: Record<string, JsonValue> = {};
  for (const key of (await kv.keys()).sort()) {
    if (isReservedKvKey(key)) continue;
    const v = await kv.get(key);
    if (v !== undefined) kvOut[key] = v;
  }
  const profile = (await r.profile.get()) ?? null;
  return {
    format: 'sightread-export',
    version: CURRENT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: exportAppVersion,
    profile,
    attempts: await r.attempts.all(),
    calibrations: await r.calibrations.all(),
    settings: await r.settings.get(),
    kv: kvOut,
  };
};

/** Replaces all data with the file's. The file is fully validated before anything is deleted. Device-local kv keys survive. */
export const importAll: StoreApi['importAll'] = async (r: StoreRepos, f: unknown, kv: KeyValue) => {
  const file = parseExportFile(f);

  const reserved: Record<string, JsonValue> = {};
  for (const key of await kv.keys()) {
    if (!isReservedKvKey(key)) continue;
    const v = await kv.get(key);
    if (v !== undefined) reserved[key] = v;
  }

  await r.clearAll();
  for (const key of await kv.keys()) await kv.delete(key);
  for (const [key, v] of Object.entries(reserved)) await kv.set(key, v);
  for (const [key, v] of Object.entries(file.kv)) {
    if (!isReservedKvKey(key)) await kv.set(key, v);
  }
  if (file.profile) await r.profile.put(file.profile);
  for (const a of file.attempts) await r.attempts.add(a);
  for (const c of file.calibrations) await r.calibrations.put(c);
  await r.settings.put(file.settings);
};
