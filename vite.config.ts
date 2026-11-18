import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `base: './'` makes every asset URL relative, so dist/ serves from any subpath
// or origin. Routes are hash routes. The PWA plugin is added by P19.
export default defineConfig({
  base: './',
  plugins: [react()],
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
