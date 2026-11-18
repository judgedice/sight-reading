// Builds the audio test page: esbuild bundles e2e/audio/entry.ts (the real WebAudioBackend) and, separately,
// src/platform/web/audio/capture.worklet.ts (the real worklet). The page is served from a routed localhost
// origin (a secure context, so getUserMedia works) with no web server; the worklet and the DSP-worker stand-in
// load from blob URLs.
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

const ROOT = process.cwd();
export const ORIGIN = 'http://localhost:4599';
let bundles: { entry: string; worklet: string } | null = null;

async function bundle(file: string): Promise<string> {
  const out = await build({
    entryPoints: [join(ROOT, file)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  return out.outputFiles[0]!.text;
}

export async function audioBundles(): Promise<{ entry: string; worklet: string }> {
  bundles ??= { entry: await bundle('e2e/audio/entry.ts'), worklet: await bundle('src/platform/web/audio/capture.worklet.ts') };
  return bundles;
}

export async function openAudioPage(page: Page): Promise<void> {
  const b = await audioBundles();
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><button id="unlock">Start</button></body></html>' }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((code) => {
    (window as unknown as { __workletCode: string }).__workletCode = code;
  }, b.worklet);
  await page.addScriptTag({ content: b.entry });
}
