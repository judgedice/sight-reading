// Unused-copy-keys lint (04 section 13.1 and 10: "every key used in code exists; no unused keys").
// A key counts as used when its full text appears in a non-test source file under src/ (a string literal or a
// template literal), or when a template literal / string concatenation elsewhere builds it from a dynamic prefix:
// `rankedReason.${x}` marks every key that starts with "rankedReason.". Keys in tools/lint-copy.baseline.json are known debt
// (unused when the lint was added) and pass until they are used or removed from the catalogue.
//   pnpm exec tsx tools/lint-copy.ts      exits 1 when a key is unused
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Keys known to be unused at wave 4 (tools/lint-copy.baseline.json); the list may only shrink. */
export const ALLOW: Readonly<Record<string, string>> = Object.fromEntries(
  (JSON.parse(readFileSync(new URL('./lint-copy.baseline.json', import.meta.url), 'utf8')) as { keys: string[] }).keys.map((k) => [k, 'baseline']),
);
const SRC_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.tsx?$|\/test-services\.ts$|\/testkit\//;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p];
  });
}

export interface CopyLintResult {
  keys: number;
  unused: string[];
  /** Allow-list entries that are no longer needed or name no key. */
  staleAllow: string[];
}

/** Pure check: `keys` are the catalogue keys, `sources` the text of every non-test source file. */
export function lintCopy(keys: readonly string[], sources: readonly string[]): CopyLintResult {
  const text = sources.join('\n');
  const prefixes = new Set<string>();
  for (const m of text.matchAll(/[`'"]([A-Za-z][A-Za-z0-9.]*\.)(?:\$\{|['"`]\s*\+)/g)) prefixes.add(m[1]!);
  const keySet = new Set(keys);
  const used = (k: string): boolean => {
    const q = new RegExp(`['"\`]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    return q.test(text) || [...prefixes].some((p) => k.startsWith(p));
  };
  const unused = keys.filter((k) => !used(k) && !(k in ALLOW));
  const staleAllow = Object.keys(ALLOW).filter((k) => !keySet.has(k) || used(k));
  return { keys: keys.length, unused, staleAllow };
}

function main(): void {
  const en = JSON.parse(readFileSync('src/ui/copy/en.json', 'utf8')) as Record<string, string>;
  const files = walk('src').filter((f) => SRC_FILE.test(f) && !TEST_FILE.test(f.split('\\').join('/')) && !f.endsWith('copy.ts'));
  const r = lintCopy(Object.keys(en), files.map((f) => readFileSync(f, 'utf8')));
  for (const k of r.unused) process.stdout.write(`unused copy key: ${k}\n`);
  for (const k of r.staleAllow) process.stdout.write(`stale allow-list entry: ${k}\n`);
  process.stdout.write(`${r.keys} keys, ${r.unused.length} unused, scanned ${files.length} files (${relative('.', 'src')})\n`);
  process.exit(r.unused.length + r.staleAllow.length > 0 ? 1 : 0);
}

if (process.argv[1] && /lint-copy\.[cm]?[jt]s$/.test(process.argv[1])) main();
