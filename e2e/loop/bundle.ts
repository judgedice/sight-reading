// Compiles e2e/loop/node-helpers.ts for Node with esbuild (JSON imports inlined) and loads it (see e2e/slice/bundle.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type * as Helpers from './node-helpers.ts';

export type LoopHelpers = typeof Helpers;

let loaded: Promise<LoopHelpers> | null = null;

export function loadLoopHelpers(): Promise<LoopHelpers> {
  loaded ??= (async () => {
    const root = process.cwd();
    const out = await build({
      entryPoints: [join(root, 'e2e/loop/node-helpers.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    });
    const dir = join(root, 'test-results', 'loop-e2e');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `node-helpers-${process.pid}.mjs`);
    writeFileSync(file, out.outputFiles[0]!.text);
    return (await import(pathToFileURL(file).href)) as LoopHelpers;
  })();
  return loaded;
}
