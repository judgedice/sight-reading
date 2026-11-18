/** Writes `ref/*.wav` and `ref/checksums.json`. Run: pnpm tsx src/testkit/ref/generate-refs.ts */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REF_NAMES, renderRefWavBytes } from '../ref-wavs.ts';

const dir = fileURLToPath(new URL('.', import.meta.url));
const sums: Record<string, string> = {};
for (const name of REF_NAMES) {
  const bytes = renderRefWavBytes(name);
  writeFileSync(`${dir}${name}.wav`, bytes);
  sums[name] = createHash('sha256').update(bytes).digest('hex');
}
writeFileSync(`${dir}checksums.json`, `${JSON.stringify({ _source: '01 section 14 item 12; sha256 of the 16-bit PCM WAV bytes; Node 22', sha256: sums }, null, 2)}\n`);
console.warn(JSON.stringify(sums, null, 2));
