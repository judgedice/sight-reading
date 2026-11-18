import { join } from 'node:path';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

const ROOT = process.cwd();
export const ORIGIN = 'http://localhost:4598';
let cache: { entry: string; worklet: string } | null = null;

async function bundle(file: string): Promise<string> {
  const out = await build({ entryPoints: [join(ROOT, file)], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  return out.outputFiles[0]!.text;
}

export async function openSyntheticPage(page: Page, search = ''): Promise<void> {
  cache ??= { entry: await bundle('e2e/synthetic/entry.ts'), worklet: await bundle('src/platform/web/audio/capture.worklet.ts') };
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><button id="unlock">Start</button></body></html>' }),
  );
  await page.goto(`${ORIGIN}/${search}`);
  const worklet = cache.worklet;
  await page.evaluate((code) => {
    (window as unknown as { __workletCode: string }).__workletCode = code;
  }, worklet);
  await page.addScriptTag({ content: cache.entry });
}
