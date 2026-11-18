// Font readiness. Importing 'vexflow/bravura' registers Bravura (and Academico, unused) as FontFaces from data:
// URLs embedded in the VexFlow build, so no font file is ever fetched. Layout does not wait for them (text-metrics.ts
// measures from a table); this only lets a caller hold the reveal until the glyphs can paint.

import 'vexflow/bravura';

/** Resolves once Bravura is loaded, or at once where there is no FontFace API (Node, jsdom). Never rejects. */
export async function ensureNotationFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await document.fonts.load('30pt Bravura');
  } catch {
    // A missing font only affects painting, never layout.
  }
}
