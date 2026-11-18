// Builds a self-contained notation test page: esbuild bundles e2e/notation/entry.ts (VexFlow, the notation module
// and the layout table) into one IIFE that is injected with page.setContent, so no server and no network are needed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

const ROOT = process.cwd();
let bundle: string | null = null;

export async function notationBundle(): Promise<string> {
  if (bundle) return bundle;
  const out = await build({
    entryPoints: [join(ROOT, 'e2e/notation/entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    // The notation font is a woff2 asset in the app build; here it is inlined so the page needs no server.
    loader: { '.woff2': 'dataurl' },
  });
  bundle = out.outputFiles[0]!.text;
  return bundle;
}

/** The Bravura woff2 data URL VexFlow embeds (node_modules/vexflow/build/esm/src/fonts/bravura.js). */
export function bravuraDataUrl(): string {
  const src = readFileSync(join(ROOT, 'node_modules/vexflow/build/esm/src/fonts/bravura.js'), 'utf8');
  const m = /'(data:font\/woff2[^']+)'/.exec(src);
  if (!m) throw new Error('Bravura data URL not found in the VexFlow build');
  return m[1]!;
}

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
}

/** A blank page with the notation bundle loaded and `window.notation` ready (fonts loaded). */
export async function openNotationPage(page: Page): Promise<void> {
  const js = await notationBundle();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="score"></div></body></html>');
  await page.addScriptTag({ content: js });
  await page.evaluate(() => (window as unknown as { notation: { ready(): Promise<void> } }).notation.ready());
}
