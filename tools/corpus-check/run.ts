// `pnpm corpus:check`: validates public/corpus/ and exits 1 on any failure (03 C10, PLAN rulings 24 and 25).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCheck } from './check.ts';

const DENYLIST = resolve(import.meta.dirname, '../corpus-build/denylist.yaml');

const out = (s: string): void => void process.stdout.write(s + '\n');
const t0 = Date.now();
const r = await runCheck();
const byGate: Record<string, number> = {};
for (const f of r.failures) byGate[f.gate] = (byGate[f.gate] ?? 0) + 1;
out(`corpus ${r.corpusVersion}: ${r.excerpts} excerpts, ${r.rendered} rendered headless, served levels ${r.servedLevels.join(',') || 'none'}`);
out(`selector cells ${r.selectorCells}, stats.fit mismatches ${r.fitMismatches}, same-group fingerprint pairs exempted ${r.fingerprintPairsExempt}`);
const shown = r.failures.filter((f) => f.gate !== 'H-serve');
for (const f of shown.slice(0, 200)) out(`FAIL ${f.gate} ${f.id}: ${f.reason}`);
const serve = r.failures.filter((f) => f.gate === 'H-serve');
for (const f of serve.slice(0, 10)) out(`FAIL ${f.gate} ${f.id}: ${f.reason}`);
if (serve.length > 10) out(`... ${serve.length - 10} more H-serve failures`);
if (r.badIds.length > 0) out(`excerpts to denylist: ${r.badIds.length}`);
out(r.failures.length === 0 ? `corpus:check passed in ${((Date.now() - t0) / 1000).toFixed(1)} s` : `corpus:check FAILED (${JSON.stringify(byGate)})`);
if (process.argv.includes('--write-denylist')) {
  // Excerpt ids that failed a per-excerpt gate, added to denylist.yaml (entries already there are kept).
  const old = readFileSync(DENYLIST, 'utf8');
  const have = new Set([...old.matchAll(/^\s*- id: (\S+)/gm)].map((m) => m[1]));
  const head = old.split('\n').filter((l) => l.startsWith('#')).join('\n');
  const lines = old.split('\n').filter((l) => /^\s+- id:|^\s+(reason|gate):/.test(l));
  const seen = new Set<string>();
  for (const f of r.failures) {
    if (!r.badIds.includes(f.id) || have.has(f.id) || seen.has(f.id)) continue;
    seen.add(f.id);
    lines.push(`  - id: ${f.id}`, `    gate: ${f.gate}`, `    reason: ${JSON.stringify(f.reason)}`);
  }
  writeFileSync(DENYLIST, `${head}\ndenylist:${lines.length === 0 ? ' []' : '\n' + lines.join('\n')}\n`);
  out(`denylist.yaml: ${seen.size} excerpts added (${have.size} already listed)`);
}
process.exit(r.failures.length === 0 ? 0 : 1);
