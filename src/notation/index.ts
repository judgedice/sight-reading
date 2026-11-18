// notation/ (P7 static render; P15 adds the overlay behind overlay-seam.ts). 01 §5.8.
export { VexScoreView, buildLayout, expectedChains, vexflowRenderCount, writeNoteState, type VexScoreViewOptions } from './score-view.ts';
export type { NotationOverlay, OverlayHost, OverlaySystem } from './overlay-seam.ts';
export { tickablesPerBar, systemHeightPx } from './render-excerpt.ts';
export { renderHeadless, type HeadlessResult } from './headless.ts';
export { ensureNotationFonts } from './fonts.ts';
export { pitchY, ledgerLineCount, stepsBelowTopLine } from './pitch-geometry.ts';
export { SvgOverlay, type OverlayOptions } from './overlay/index.ts';
