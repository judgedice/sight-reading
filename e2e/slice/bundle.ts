// Compiles e2e/slice/node-helpers.ts for Node with esbuild (JSON imports inlined) and loads it. See node-helpers.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type * as Helpers from './node-helpers.ts';

export type NodeHelpers = typeof Helpers;

let loaded: Promise<NodeHelpers> | null = null;

export function loadNodeHelpers(): Promise<NodeHelpers> {
  loaded ??= (async () => {
    const root = process.cwd();
    const out = await build({
      entryPoints: [join(root, 'e2e/slice/node-helpers.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'silent',
    });
    const dir = join(root, 'test-results', 'slice-e2e');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `node-helpers-${process.pid}.mjs`);
    writeFileSync(file, out.outputFiles[0]!.text);
    return (await import(pathToFileURL(file).href)) as NodeHelpers;
  })();
  return loaded;
}
