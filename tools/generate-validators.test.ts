import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { AJV_OPTIONS, SCHEMA_FILE, checkValidator, generateValidator } from './generate-validators.ts';
import validate from '../src/store/export-file-validator.js';

describe('generated export-file validator', () => {
  it('matches schemas/export-file.schema.json (run `pnpm validators` after `pnpm schemas`)', () => {
    expect(checkValidator(generateValidator())).toEqual([]);
  });

  it('gives the same verdict and first error as the Ajv runtime', () => {
    const runtime = new Ajv(AJV_OPTIONS).compile(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as object);
    const cases: unknown[] = [
      {},
      { format: 'sightread-export', version: 1 },
      { format: 'sightread-export', version: 1, exportedAt: 'x', appVersion: '1', profile: null, attempts: [], calibrations: [], settings: null, kv: {} },
      { format: 'sightread-export', version: 1, exportedAt: 'x', appVersion: '1', profile: null, attempts: 'no', calibrations: [], settings: null, kv: {} },
      [],
      null,
    ];
    for (const c of cases) {
      expect(validate(c)).toBe(runtime(c));
      expect(validate.errors ?? null).toEqual(runtime.errors ?? null);
    }
  });
});
