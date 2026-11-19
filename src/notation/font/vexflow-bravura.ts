// A Bravura-only replacement for 'vexflow/bravura'. The stock entry also embeds Academico and Academico Bold
// (about 330 KB gzip of unused text fonts) and Bravura itself as a base64 data: URL. This module registers Bravura
// from a binary woff2 asset served next to the bundle (relative URL, so any base path works; no third-party request)
// and selects it as VexFlow's music font. The woff2 is shipped as a file rather than base64 in the JS chunk: woff2 is
// already compressed, and base64 in JS cost about 250 KB gzip of the bundle budget (PLAN ruling 39).
// Importers use this path instead of 'vexflow/bravura' or 'vexflow/core'. It re-exports only the classes the notation
// module uses, each from its own VexFlow source module ('vexflow-src/*', mapped in tsconfig.json paths, vite.config.ts
// and vitest.config.ts). 'vexflow/core' pulls in the whole library through the VexFlow class (EasyScore, Factory,
// tablature, chord symbols and the rest), about 27 KB gzip the app never runs (PLAN ruling 39). Add a re-export
// below when the notation module needs another class.
//
// bravura.woff2 is vendored from vexflow 5.2.0 build/esm/src/fonts/bravura.js (Bravura, SIL OFL 1.1; see
// LICENSES/OFL-1.1-Bravura.txt), decoded from its data: URL. After a VexFlow upgrade, decode it again.

import { Font } from 'vexflow-src/font.js';
import { Metrics, MetricsDefaults } from 'vexflow-src/metrics.js';
// Vite emits the file and imports its URL, relative to the bundle with `base: './'` (01 §13.4: no absolute paths).
// The esbuild test harnesses (e2e/notation, e2e/ios) load it as a data: URL instead (`loader: { '.woff2': 'dataurl' }`).
import bravuraUrl from './bravura.woff2';

// What `VexFlow.setFonts('Bravura')` does in vexflow 5.2.0 (build/esm/src/vexflow.js): Bravura is the music font and,
// as it is not a text font, the text font stack falls back to Academico (never loaded here; text is measured from a
// table, see text-metrics.ts). Re-check after a VexFlow upgrade.
MetricsDefaults.fontFamily = 'Bravura';
MetricsDefaults.textFontFamily = [...new Set(['Academico', ...String(Metrics.get('fontFamily')).split(',')])].join(',');
Metrics.clear();

/** Settles once the Bravura FontFace is loaded. Never rejects (no FontFace API in Node and jsdom). */
export const bravuraLoaded: Promise<unknown> = Font.load('Bravura', bravuraUrl, { display: 'block' }).catch(() => undefined);

export { Accidental } from 'vexflow-src/accidental.js';
export { Articulation } from 'vexflow-src/articulation.js';
export { BarlineType } from 'vexflow-src/stavebarline.js';
export { Beam } from 'vexflow-src/beam.js';
export { Curve } from 'vexflow-src/curve.js';
export { Dot } from 'vexflow-src/dot.js';
export { Element } from 'vexflow-src/element.js';
export { Font };
export { Formatter } from 'vexflow-src/formatter.js';
export { Metrics, MetricsDefaults };
export { Modifier } from 'vexflow-src/modifier.js';
export { Stave } from 'vexflow-src/stave.js';
export { StaveHairpin } from 'vexflow-src/stavehairpin.js';
export { StaveNote } from 'vexflow-src/stavenote.js';
export { StaveTie } from 'vexflow-src/stavetie.js';
export { SVGContext } from 'vexflow-src/svgcontext.js';
export { Tuplet } from 'vexflow-src/tuplet.js';
export { Voice } from 'vexflow-src/voice.js';
