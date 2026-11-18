// Bare-runtime job (01 §13.3): esbuild bundles tools/bare-runtime/scenarios.ts (and the pure packages it imports) into
// one IIFE, runs it in a Node `vm` context with only the ES2022 globals, and checks the output is byte-identical to the
// same scenarios run directly under Node. Usage: tsx tools/bare-runtime/run.ts  (exit 1 on any difference).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ENTRY = fileURLToPath(new URL('./scenarios.ts', import.meta.url));

export async function bundle(): Promise<string> {
  const res = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__bare',
    target: 'es2022',
    platform: 'neutral',
    logLevel: 'silent',
  });
  const out = res.outputFiles[0];
  if (!out) throw new Error('bare-runtime: esbuild produced no output');
  return out.text;
}

/** Host extras V8 adds to every context that are not ES2022 built-ins. */
const NON_ES_GLOBALS = ['console'];

/** Runs the bundle in a fresh context with only the ECMAScript built-ins: no console, timers, process, DOM. */
export function runBundled(code: string): string {
  const context = vm.createContext(Object.create(null) as object);
  vm.runInContext(NON_ES_GLOBALS.map((g) => `delete globalThis.${g};`).join(''), context);
  vm.runInContext(`${code}\n;globalThis.__out = __bare.runAll();`, context, { timeout: 60_000 });
  const out = (context as { __out?: unknown }).__out;
  if (typeof out !== 'string') throw new Error('bare-runtime: scenarios did not return a string');
  return out;
}

export async function runDirect(): Promise<string> {
  const mod = (await import('./scenarios.ts')) as { runAll: () => string };
  return mod.runAll();
}

async function main(): Promise<number> {
  const [bare, direct] = [runBundled(await bundle()), await runDirect()];
  if (bare !== direct) {
    process.stderr.write('bare-runtime: output differs from the Node run\n');
    return 1;
  }
  const n = (JSON.parse(bare) as unknown[]).length;
  process.stdout.write(`bare-runtime: ${n} scenarios byte-identical (${bare.length} bytes)\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
