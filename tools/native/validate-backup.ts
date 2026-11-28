// Checks a backup file with the app's own import validator (`parseExportFile`, src/store/export-import.ts: migrations,
// then the schema validator the import button uses) and prints what it holds as one JSON line. Exits 1 when the app
// would refuse the file. Used by the native end-to-end `data` scenario (tools/native/e2e-linux.mjs).
//
//   pnpm exec tsx tools/native/validate-backup.ts <file>
import { readFileSync } from 'node:fs';
import { parseExportFile, StoreImportError } from '../../src/store/index.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: validate-backup.ts <file>');
  process.exit(2);
}
try {
  const parsed = parseExportFile(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      version: parsed.version,
      appVersion: parsed.appVersion,
      profileId: parsed.profile?.id ?? null,
      calibrations: parsed.calibrations.map((c) => ({ routeKey: c.routeKey, roundTripMs: c.roundTripMs, platform: c.platform })),
      attempts: parsed.attempts.length,
      kvKeys: Object.keys(parsed.kv).length,
    })}\n`,
  );
} catch (e) {
  const detail = e instanceof StoreImportError ? `${e.code}: ${e.message} ${e.details ?? ''}` : String(e);
  process.stdout.write(`${JSON.stringify({ ok: false, error: detail })}\n`);
  process.exit(1);
}
