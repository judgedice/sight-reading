// Headless render entry point for corpus validation (03 C10: "renders in VexFlow without exceptions").
// Needs a global `document` (a browser, or jsdom installed as globals in Node). Throws whatever VexFlow throws.

import type { PreparedExcerpt, RenderOptions, ScoreLayout } from '../core/types.ts';
import { buildLayout } from './score-view.ts';
import { renderExcerpt } from './render-excerpt.ts';
import { metricMisses, resetMetricMisses } from './text-metrics.ts';

export interface HeadlessResult {
  layout: ScoreLayout;
  /** Serialised system SVGs, in order. */
  svgs: string[];
  /** False when some system could not honour the 14 sp minimum bar width. */
  fits: boolean;
  /** Bravura glyphs missing from the metrics table (should be empty). */
  metricMisses: string[];
}

export function renderHeadless(p: PreparedExcerpt, o: RenderOptions): HeadlessResult {
  resetMetricMisses();
  const out = renderExcerpt(p, o);
  const layout = buildLayout(p, out);
  const svgs = out.systems.map((s) => s.svg.outerHTML);
  return { layout, svgs, fits: out.fits, metricMisses: metricMisses() };
}
