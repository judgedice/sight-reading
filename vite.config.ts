import react from '@vitejs/plugin-react';
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
          attrs: { name: 'theme-color', content: '#F6F5F1', media: '(prefers-color-scheme: light)' },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#121418', media: '(prefers-color-scheme: dark)' },
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

export default defineConfig({
  base: './',
  plugins: [
    react(),
    pwaHead(),
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
        globIgnores: ['corpus/**', 'sw.js'],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
