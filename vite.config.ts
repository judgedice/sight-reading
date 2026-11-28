import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` makes every asset URL relative, so dist/ serves from any subpath
// or origin. Routes are hash routes.
//
// PWA (P19). The service worker is src/platform/web/sw/sw.ts, compiled by vite-plugin-pwa (`injectManifest`), which
// replaces `self.__WB_MANIFEST` with the shell list. Registration is not injected: the page registers `sw.js` from
// src/platform/web/sw/register.ts, only when capabilities.serviceWorker is true. The manifest is the hand-written
// public/manifest.webmanifest, so `manifest: false`.

/**
 * Adds the manifest link, the 180 px apple-touch-icon and the iOS standalone meta tags (05 W14). It runs after Vite's
 * own HTML pass, so the relative paths are emitted as written.
 */
function pwaHead(): Plugin {
  return {
    name: 'sightread-pwa-head',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './icons/apple-touch-icon.png' }, injectTo: 'head' },
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#F4F1EA', media: '(prefers-color-scheme: light)' },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#111113', media: '(prefers-color-scheme: dark)' },
          injectTo: 'head',
        },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        {
          tag: 'meta',
          attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
          injectTo: 'head',
        },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Sightread' }, injectTo: 'head' },
      ],
    },
  };
}

/**
 * Ships the repo's LICENSES/*.txt as `LICENSES/<name>.txt` in the build, so the Credits links resolve in dist/ as they
 * do on the dev server (which serves the project root). Not in the service worker's shell list (.txt).
 */
function licenceFiles(): Plugin {
  const dir = fileURLToPath(new URL('./LICENSES/', import.meta.url));
  return {
    name: 'sightread-licence-files',
    apply: 'build',
    generateBundle() {
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
        this.emitFile({ type: 'asset', fileName: `LICENSES/${name}`, source: readFileSync(dir + name) });
      }
    },
  };
}

/** `vexflow-src/x.js` → one VexFlow source module (tsconfig.json paths; src/notation/font/vexflow-bravura.ts). */
export const vexflowSrcAlias = {
  find: /^vexflow-src\//,
  replacement: fileURLToPath(new URL('./node_modules/vexflow/build/esm/src/', import.meta.url)),
};

export default defineConfig({
  base: './',
  resolve: { alias: [vexflowSrcAlias] },
  plugins: [
    react(),
    pwaHead(),
    licenceFiles(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/platform/web/sw',
      filename: 'sw.ts',
      manifest: false,
      injectRegister: false,
      devOptions: { enabled: false },
      injectManifest: {
        // The shell: HTML, the build's JS and CSS, fonts, images and the manifest. The corpus is excluded: it is
        // cached at run time by policy.ts, not in the install step.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}', 'manifest.webmanifest'],
        // The native shell's chunk (platform/native/boot.ts) is never loaded in a browser: it is not precached.
        globIgnores: ['corpus/**', 'sw.js', 'assets/native-*.js'],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // The Tauri shell's own chunk (src/app/main.tsx imports platform/native/boot.ts on demand) gets a name the
        // service worker's precache list can leave out.
        chunkFileNames: (chunk) => (chunk.facadeModuleId?.includes('/src/platform/native/boot.') ? 'assets/native-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
