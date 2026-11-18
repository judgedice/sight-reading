// A Bravura-only replacement for 'vexflow/bravura'. The stock entry also embeds Academico and Academico Bold
// (about 330 KB gzip of unused text fonts). This module does what that entry does, minus those two: it registers
// Bravura from a data: URL (no network request) and selects it as VexFlow's music font.
// Everything VexFlow exports comes through 'vexflow/core', so importers use this path instead of 'vexflow/bravura'.

import { Font, VexFlow } from 'vexflow/core';
import { Bravura } from './bravura-data.ts';

VexFlow.BUILD.INFO = 'vexflow-bravura-only';
VexFlow.setFonts('Bravura');

/** Settles once the Bravura FontFace is registered. Never rejects (no FontFace API in Node and jsdom). */
export const bravuraLoaded: Promise<unknown> = Font.load('Bravura', Bravura, { display: 'block' }).catch(() => undefined);

export * from 'vexflow/core';
export { default } from 'vexflow/core';
