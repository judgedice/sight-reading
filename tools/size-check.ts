// Bundle budget check (PLAN ruling 39). Builds the app with the notation dev chunk included (VITE_NOTATION_DEV=1,
// into dist-size/, so the production dist/ stays clean), then gzips every emitted .js and .css file.
//   initial = files index.html loads (script, modulepreload, stylesheet) and their static imports
//   total   = every .js and .css file
// Font assets (PLAN ruling 53): every .woff2 is reported separately by its file size (already compressed) and must be at
// most 260 KB each; fonts do not count toward the JavaScript and CSS budgets.
// Limits (PLAN ruling 66): 150 KB gzip initial, 560 KB gzip total (1 KB = 1000 bytes). Sound files under
// public/sounds load per instrument on demand and are not counted. Pass --dist <dir> to measure an existing build.
// Exits 1 over budget.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';

export const INITIAL_LIMIT = 150_000;
export const TOTAL_LIMIT = 560_000;
export const FONT_LIMIT = 260_000;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const gz = (b: Buffer): number => gzipSync(b, { level: 9 }).length;

export interface SizeReport {
  initial: number;
  total: number;
  files: { file: string; gzip: number; initial: boolean }[];
  /** woff2 assets by raw size in bytes. */
  fonts: { file: string; bytes: number }[];
}

/** Pure measurement of a built directory. */
export function measure(dist: string): SizeReport {
  const all = walk(dist)
    .map((p) => posix.relative(dist.split('\\').join('/'), p.split('\\').join('/')))
    .filter((f) => /\.(js|css)$/.test(f));
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = new Set<string>();
  const visit = (rel: string): void => {
    const f = posix.normalize(rel);
    if (initial.has(f) || !all.includes(f)) return;
    initial.add(f);
    if (!f.endsWith('.js')) return;
    const src = readFileSync(join(dist, f), 'utf8');
    // Static imports only: `import ... from "./x.js"` and `import "./x.js"`, not `import("./x.js")`.
    for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?["'](\.[^"']+)["']/g)) {
      visit(posix.join(posix.dirname(f), m[1]!));
    }
  };
  for (const m of html.matchAll(/(?:src|href)="\.?\/?([^"]+\.(?:js|css))"/g)) visit(m[1]!);
  const files = all.map((file) => ({ file, gzip: gz(readFileSync(join(dist, file))), initial: initial.has(file) }));
  const fonts = walk(dist)
    .map((p) => posix.relative(dist.split('\\').join('/'), p.split('\\').join('/')))
    .filter((f) => f.endsWith('.woff2'))
    .map((file) => ({ file, bytes: statSync(join(dist, file)).size }));
  return {
    fonts,
    initial: files.filter((f) => f.initial).reduce((a, f) => a + f.gzip, 0),
    total: files.reduce((a, f) => a + f.gzip, 0),
    files,
  };
}

function main(): void {
  const i = process.argv.indexOf('--dist');
  let dist = i >= 0 ? process.argv[i + 1]! : '';
  if (!dist) {
    dist = 'dist-size';
    execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', dist, '--emptyOutDir'], {
      stdio: 'inherit',
      env: { ...process.env, VITE_NOTATION_DEV: '1' },
    });
  }
  const r = measure(dist);
  if (i < 0) rmSync(dist, { recursive: true, force: true });
  const kb = (n: number): string => (n / 1000).toFixed(1).padStart(7) + ' KB';
  for (const f of [...r.files].sort((a, b) => b.gzip - a.gzip)) process.stdout.write(`${kb(f.gzip)} gzip  ${f.initial ? 'initial' : 'lazy   '}  ${f.file}\n`);
  process.stdout.write(`initial ${kb(r.initial)} (limit ${INITIAL_LIMIT / 1000} KB)\n`);
  process.stdout.write(`total   ${kb(r.total)} (limit ${TOTAL_LIMIT / 1000} KB)\n`);
  for (const f of r.fonts) process.stdout.write(`${kb(f.bytes)} woff2  font      ${f.file} (limit ${FONT_LIMIT / 1000} KB)\n`);
  if (r.fonts.length === 0) console.error('No woff2 font asset found in the build.');
  const bad = r.initial > INITIAL_LIMIT || r.total > TOTAL_LIMIT || r.fonts.length === 0 || r.fonts.some((f) => f.bytes > FONT_LIMIT);
  if (bad) console.error('Bundle budget exceeded.');
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && /size-check\.[cm]?[jt]s$/.test(process.argv[1])) main();
