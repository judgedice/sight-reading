// Deterministic text measurement for VexFlow (P7).
//
// VexFlow 5 sizes every glyph by measuring Bravura text on a canvas. That makes layout depend on whether the font
// has finished loading (and is impossible in jsdom). Instead we hand VexFlow a measurement "canvas" backed by a
// table of Bravura metrics captured once from real Chromium (bravura-metrics.ts, regenerated and checked by
// e2e/notation/bravura-metrics.spec.ts). Layout is then identical in Node, jsdom and every browser, and render()
// can run before the font face has loaded: the SVG <text> glyphs simply paint once it has.

import { Element } from './font/vexflow-bravura.ts';
import { BRAVURA_METRICS, BRAVURA_METRICS_EM_PX } from './bravura-metrics.ts';

/** [advance width, actualBoundingBoxLeft, actualBoundingBoxRight, ascent, descent], per 1 px of font size. */
export type GlyphMetric = readonly [number, number, number, number, number];

const PT_TO_PX = 4 / 3;

interface ParsedFont {
  sizePx: number;
  family: string;
}

/** Parse the CSS font shorthand VexFlow writes (for example "30pt Bravura,Academico" or "italic bold 10pt X"). */
export function parseFont(font: string): ParsedFont {
  const m = /(-?\d*\.?\d+)(pt|px|em|rem|%)?\s+(.+)$/.exec(font.trim());
  if (!m) return { sizePx: 10, family: '' };
  const v = Number(m[1]);
  const unit = m[2] ?? 'px';
  const sizePx = unit === 'pt' ? v * PT_TO_PX : unit === 'em' || unit === 'rem' ? v * 16 : unit === '%' ? (v * 16) / 100 : v;
  const family = (m[3] ?? '').split(',')[0]!.trim().replace(/^["']|["']$/g, '');
  return { sizePx, family };
}

/** Codepoint key used by the table ('e0a4'). */
export function glyphKey(ch: string): string {
  return ch.codePointAt(0)!.toString(16);
}

const misses = new Set<string>();

/** Bravura glyphs measured with the fallback since the last reset (tests assert this stays empty). */
export function metricMisses(): string[] {
  return [...misses].sort();
}

export function resetMetricMisses(): void {
  misses.clear();
}

let fallbackCtx: OffscreenCanvasRenderingContext2D | null | undefined;
function realContext(): OffscreenCanvasRenderingContext2D | null {
  if (fallbackCtx === undefined) {
    fallbackCtx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8).getContext('2d') : null;
  }
  return fallbackCtx;
}

interface Box {
  width: number;
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

function measureFallback(font: string, text: string): Box {
  const ctx = realContext();
  if (ctx) {
    ctx.font = font;
    const m = ctx.measureText(text);
    return {
      width: m.width,
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
    };
  }
  // Plain approximation for text fonts in environments with no canvas (Node, jsdom).
  const { sizePx } = parseFont(font);
  const width = 0.5 * sizePx * [...text].length;
  return { width, left: 0, right: width, ascent: 0.7 * sizePx, descent: 0.2 * sizePx };
}

/** Measure `text` in `font` from the Bravura table (per-glyph advance sums; ink box union). */
export function measureGlyphText(font: string, text: string): Box {
  const { sizePx, family } = parseFont(font);
  if (text === '') return { width: 0, left: 0, right: 0, ascent: 0, descent: 0 };
  if (family !== 'Bravura') return measureFallback(font, text);
  const k = sizePx / BRAVURA_METRICS_EM_PX;
  let x = 0;
  let left = Infinity;
  let right = -Infinity;
  let ascent = -Infinity;
  let descent = -Infinity;
  for (const ch of text) {
    const key = glyphKey(ch);
    const g = (BRAVURA_METRICS as Record<string, GlyphMetric | undefined>)[key];
    let b: Box;
    if (g) {
      b = { width: g[0] * k, left: g[1] * k, right: g[2] * k, ascent: g[3] * k, descent: g[4] * k };
    } else {
      misses.add(key);
      b = measureFallback(font, ch);
    }
    left = Math.min(left, b.left - x);
    right = Math.max(right, x + b.right);
    ascent = Math.max(ascent, b.ascent);
    descent = Math.max(descent, b.descent);
    x += b.width;
  }
  return { width: x, left, right, ascent, descent };
}

function toTextMetrics(b: Box, sizePx: number): TextMetrics {
  return {
    width: b.width,
    actualBoundingBoxLeft: b.left,
    actualBoundingBoxRight: b.right,
    actualBoundingBoxAscent: b.ascent,
    actualBoundingBoxDescent: b.descent,
    fontBoundingBoxAscent: sizePx * 0.8,
    fontBoundingBoxDescent: sizePx * 0.2,
    emHeightAscent: sizePx * 0.8,
    emHeightDescent: sizePx * 0.2,
    hangingBaseline: sizePx * 0.8,
    alphabeticBaseline: 0,
    ideographicBaseline: -sizePx * 0.2,
  } as TextMetrics;
}

/** The minimal 2D-context surface VexFlow's TextMetricsCache touches. */
class TableContext {
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  direction = 'ltr';
  lang = 'en';
  /** Every measured (font, text) pair, when recording is on (used to build the metrics table). */
  recorded: Set<string> | null = null;

  measureText(text: string): TextMetrics {
    if (this.recorded) this.recorded.add(`${this.font}\u0000${text}`);
    return toTextMetrics(measureGlyphText(this.font, text), parseFont(this.font).sizePx);
  }
}

const tableContext = new TableContext();
const tableCanvas = { getContext: (): TableContext => tableContext };
let installed = false;

/** Point VexFlow's text measurement at the Bravura table. Idempotent; called by render(). */
export function installTableMetrics(): void {
  if (installed) return;
  Element.setTextMeasurementCanvas(tableCanvas as unknown as HTMLCanvasElement);
  installed = true;
}

/** Start or stop recording measured strings (for the metrics generator and its coverage test). */
export function recordMeasuredText(on: boolean): Set<string> | null {
  const prev = tableContext.recorded;
  tableContext.recorded = on ? new Set() : null;
  return prev;
}

/** The strings recorded since recording was switched on. */
export function measuredText(): string[] {
  return [...(tableContext.recorded ?? [])].sort();
}
