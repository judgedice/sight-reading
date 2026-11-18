// Builds the overlay test page: esbuild bundles e2e/notation/overlay-entry.ts and page.setContent injects it.
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

const ROOT = process.cwd();
let bundle: string | null = null;

async function overlayBundle(): Promise<string> {
  if (bundle) return bundle;
  const out = await build({
    entryPoints: [join(ROOT, 'e2e/notation/overlay-entry.ts')],
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

export async function openOverlayPage(page: Page): Promise<void> {
  const js = await overlayBundle();
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>:root{--correct:#00756A;--error:#C5300A;--ghost:#7A3EC8;--ghost-replay:#6B6B6B;--text-muted:#575C66;--active:#1A1A1A;--playhead-bar:rgba(47,75,216,.08);--playhead-next:rgba(47,75,216,.6)}body{margin:0;background:#FFFDF8;color:#1A1A1A}</style></head><body><div id="score"></div></body></html>');
  await page.addScriptTag({ content: js });
  await page.evaluate(() => (window as unknown as { overlayRig: { ready(): Promise<void> } }).overlayRig.ready());
}
