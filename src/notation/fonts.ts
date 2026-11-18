// Font readiness. Importing ./font/vexflow-bravura.ts registers Bravura only (not Academico) as a FontFace from the bundled
// woff2 asset (a relative URL, never a CDN). Layout does not wait for it (text-metrics.ts
// measures from a table); this only lets a caller hold the reveal until the glyphs can paint.

import { bravuraLoaded } from './font/vexflow-bravura.ts';

/** Resolves once Bravura is loaded, or at once where there is no FontFace API (Node, jsdom). Never rejects. */
export async function ensureNotationFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await bravuraLoaded;
    await document.fonts.load('30pt Bravura');
  } catch {
    // A missing font only affects painting, never layout.
  }
}
