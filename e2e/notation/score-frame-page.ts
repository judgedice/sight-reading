// Builds the ScoreFrame (D3) test page: esbuild bundles score-frame-entry.ts (React, notation, the frame and the token
// CSS) and page.setContent injects the JS and CSS. No server and no network.
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Page } from '@playwright/test';

const ROOT = process.cwd();
let bundle: { js: string; css: string } | null = null;

async function frameBundle(): Promise<{ js: string; css: string }> {
  if (bundle) return bundle;
  const out = await build({
    entryPoints: [join(ROOT, 'e2e/notation/score-frame-entry.ts')],
    bundle: true,
    write: false,
    outdir: join(ROOT, 'test-results/score-frame-bundle'),
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const js = out.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  const css = out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  bundle = { js, css };
  return bundle;
}

/** The performance screen's skeleton: toolbar, score frame, status line, inside the injected safe-area insets. */
const PAGE_CSS = `
:root {
  --sai-top: var(--test-sai-top, env(safe-area-inset-top, 0px));
  --sai-right: var(--test-sai-right, env(safe-area-inset-right, 0px));
  --sai-bottom: var(--test-sai-bottom, env(safe-area-inset-bottom, 0px));
  --sai-left: var(--test-sai-left, env(safe-area-inset-left, 0px));
}
html, body { margin: 0; padding: 0; }
body { block-size: 100dvh; overflow: auto; font-family: system-ui; }
#toolbar { position: fixed; inset-inline: 0; top: var(--sai-top); block-size: var(--toolbar-h); background: #eee; }
#status { position: fixed; inset-inline: 0; bottom: var(--sai-bottom); block-size: var(--status-h); background: #eee; }
#frame-root { position: fixed; inset-inline: 0; top: calc(var(--sai-top) + var(--toolbar-h));
  bottom: calc(var(--sai-bottom) + var(--status-h)); display: flex; }
#frame-root > .sf-host { flex: 1; min-inline-size: 0; }
`;

export async function openFramePage(page: Page): Promise<void> {
  const { js, css } = await frameBundle();
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${PAGE_CSS}</style><style>${css}</style></head>` +
      '<body><div id="toolbar"></div><div id="frame-root"></div><div id="status"></div></body></html>',
  );
  await page.addScriptTag({ content: js });
}
