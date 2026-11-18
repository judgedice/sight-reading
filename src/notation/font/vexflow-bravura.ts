// A Bravura-only replacement for 'vexflow/bravura'. The stock entry also embeds Academico and Academico Bold
// (about 330 KB gzip of unused text fonts) and Bravura itself as a base64 data: URL. This module registers Bravura
// from a binary woff2 asset served next to the bundle (relative URL, so any base path works; no third-party request)
// and selects it as VexFlow's music font. The woff2 is shipped as a file rather than base64 in the JS chunk: woff2 is
// already compressed, and base64 in JS cost about 250 KB gzip of the bundle budget (PLAN ruling 39).
// Everything VexFlow exports comes through 'vexflow/core', so importers use this path instead of 'vexflow/bravura'.
//
// bravura.woff2 is vendored from vexflow 5.2.0 build/esm/src/fonts/bravura.js (Bravura, SIL OFL 1.1; see
// LICENSES/OFL-1.1-Bravura.txt), decoded from its data: URL. After a VexFlow upgrade, decode it again.

import { Font, VexFlow } from 'vexflow/core';
// Vite emits the file and imports its URL, relative to the bundle with `base: './'` (01 §13.4: no absolute paths).
// The esbuild test harnesses (e2e/notation, e2e/ios) load it as a data: URL instead (`loader: { '.woff2': 'dataurl' }`).
import bravuraUrl from './bravura.woff2';

VexFlow.BUILD.INFO = 'vexflow-bravura-only';
VexFlow.setFonts('Bravura');

/** Settles once the Bravura FontFace is loaded. Never rejects (no FontFace API in Node and jsdom). */
export const bravuraLoaded: Promise<unknown> = Font.load('Bravura', bravuraUrl, { display: 'block' }).catch(() => undefined);

export * from 'vexflow/core';
export { default } from 'vexflow/core';
