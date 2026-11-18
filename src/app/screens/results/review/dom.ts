/**
 * Review extras drawn into each system SVG above P15's overlay (04 §6.2, §6.5): heat strip, replay brackets, ghost
 * duration tails and the selection ring; plus the roving-tabindex note buttons (04 §8.3). Framework-free: the React
 * component calls these after every layout. Geometry comes from the ScoreLayout only.
 */
import type { Clef, ScoreLayout } from '../../../../core/types.ts';
import type { HeatCell, ReviewModel, SlipTarget } from './model.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 04 §6.5: the heat strip is 6 px tall; hatch lines 1.5 px at 45°, 8 px (≤ 25%) or 4 px (≤ 50%) apart. */
export const HEAT_H = 6;
const HATCH_W = 1.5;
const HATCH_GAP: Record<1 | 2, number> = { 1: 8, 2: 4 };
/** 04 §6.2: duration tail is a 3 px bar. */
export const TAIL_H = 3;
/** Bravura noteheadBlack width in staff spaces (mirrors notation's overlay geometry). */
const HEAD_W_SP = 1.18;
const SHARP_FLAT_OFFSET = 1.1;

type Attrs = Record<string, string | number>;
const num = (n: number): string => String(Math.round(n * 100) / 100);

function el<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const e = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === 'number' ? num(v) : v);
  return e;
}

export function systemSvgs(host: HTMLElement): Map<number, SVGSVGElement> {
  const out = new Map<number, SVGSVGElement>();
  for (const s of host.querySelectorAll<SVGSVGElement>('svg.sr-system[data-system]')) out.set(Number(s.getAttribute('data-system')), s);
  return out;
}

const svgWidth = (svg: SVGSVGElement, fallback: number): number => {
  const w = Number(svg.getAttribute('width'));
  return Number.isFinite(w) && w > 0 ? w : fallback;
};

/** The extras group of a system, emptied (created on first use). */
function layer(svg: SVGSVGElement, cls: string): SVGGElement {
  let g = svg.querySelector<SVGGElement>(`:scope > g.${cls}`);
  if (!g) {
    g = el(svg.ownerDocument, 'g', { class: cls });
    svg.appendChild(g);
  } else g.replaceChildren();
  return g;
}

/** x-range of a beat span on one system: start and end clamp to the system's own extent. */
function spanOn(layout: ScoreLayout, system: number, a: number, b: number, sysStartX: number, svgW: number): [number, number] | null {
  const pa = layout.beatToPoint(a);
  const pb = layout.beatToPoint(b);
  if (pa.system > system || pb.system < system) return null;
  const x0 = pa.system === system ? pa.x : sysStartX;
  const x1 = pb.system === system ? pb.x : svgW;
  return x1 > x0 ? [x0, x1] : null;
}

export interface DrawArgs {
  host: HTMLElement;
  layout: ScoreLayout;
  model: ReviewModel;
  clef: Clef;
  /** Unique per review instance, for the hatch pattern ids. */
  uid: string;
}

/** Heat strip, brackets and tails, redrawn from scratch (after a layout, or when "My take" comes back). */
export function drawExtras({ host, layout, model, clef, uid }: DrawArgs): void {
  const doc = host.ownerDocument;
  const svgs = systemSvgs(host);
  for (const sys of layout.systems) {
    const svg = svgs.get(sys.index);
    if (!svg) continue;
    const g = layer(svg, 'rv-extras');
    g.setAttribute('data-system', String(sys.index));
    const sp = sys.lineSpacing;
    const firstCell = model.heat.find((h) => h.bar === sys.firstBar);
    const sysStartX = firstCell ? layout.beatToPoint(firstCell.startBeat).x : 0;
    const w = svgWidth(svg, sysStartX);

    const defs = el(doc, 'defs');
    for (const level of [1, 2] as const) {
      const gap = HATCH_GAP[level];
      const pat = el(doc, 'pattern', { id: `${uid}-hatch-${level}-${sys.index}`, width: gap, height: gap, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
      pat.appendChild(el(doc, 'line', { class: 'rv-hatch-line', x1: 0, y1: 0, x2: 0, y2: gap, 'stroke-width': HATCH_W }));
      defs.appendChild(pat);
    }
    g.appendChild(defs);

    // Heat strip: 6 px above each bar (04 §6.5), above the top ledger space.
    const heatY = Math.max(0, sys.staffTopY - 3 * sp - HEAT_H);
    const heat = el(doc, 'g', { class: 'rv-heat' });
    for (const cell of model.heat) {
      if (cell.bar < sys.firstBar || cell.bar > sys.lastBar) continue;
      const span = spanOn(layout, sys.index, cell.startBeat, cell.endBeat, sysStartX, w);
      if (!span) continue;
      heat.appendChild(heatCell(doc, cell, span, heatY, `${uid}-hatch-${cell.level}-${sys.index}`));
    }
    g.appendChild(heat);

    // Replay brackets: above the staff over the replayed ghosts, "bars 5–6 replayed" (04 §6.5).
    const by = sys.staffTopY - 1.5 * sp;
    for (const b of model.brackets) {
      const span = spanOn(layout, sys.index, b.startBeat, b.endBeat, sysStartX, w);
      if (!span) continue;
      const [x0, x1] = span;
      const grp = el(doc, 'g', { class: 'rv-bracket', 'data-from-bar': b.fromBar, 'data-to-bar': b.toBar });
      const startsHere = layout.beatToPoint(b.startBeat).system === sys.index;
      const endsHere = layout.beatToPoint(b.endBeat).system === sys.index;
      const tick = 0.6 * sp;
      const d = `${startsHere ? `M${num(x0)} ${num(by + tick)}V${num(by)}` : `M${num(x0)} ${num(by)}`}H${num(x1)}${endsHere ? `V${num(by + tick)}` : ''}`;
      grp.appendChild(el(doc, 'path', { class: 'rv-bracket-line', d, fill: 'none' }));
      if (startsHere) {
        const t = el(doc, 'text', { class: 'rv-bracket-label', x: x0, y: by - 2 });
        t.textContent = b.label;
        grp.appendChild(t);
      }
      g.appendChild(grp);
    }

    // Ghost duration tails (04 §6.2, review only): from the ghost's right edge to its played end.
    const headW = HEAD_W_SP * sp;
    for (const t of model.tails) {
      const pt = layout.beatToPoint(t.beat);
      if (pt.system !== sys.index) continue;
      const end = layout.beatToPoint(t.beat + t.durBeats);
      const ghost = model.ghosts.find((gh) => gh.detectedId === t.detectedId);
      const shift = ghost && (ghost.kind === 'sharp' || ghost.kind === 'flat') ? SHARP_FLAT_OFFSET * headW : 0;
      const x = pt.x + shift + headW;
      const x1 = end.system === sys.index ? end.x : w;
      if (x1 <= x) continue;
      const y = layout.staffY(sys.index, t.pitch, clef);
      g.appendChild(el(doc, 'rect', { class: t.replay ? 'rv-tail rv-tail-replay' : 'rv-tail', 'data-detected-id': t.detectedId, x, y: y - TAIL_H / 2, width: x1 - x, height: TAIL_H }));
    }
  }
}

function heatCell(doc: Document, cell: HeatCell, [x0, x1]: [number, number], y: number, patternId: string): SVGGElement {
  const g = el(doc, 'g', { class: 'rv-heat-cell', 'data-bar': cell.bar, 'data-level': cell.level });
  g.appendChild(el(doc, 'rect', { class: 'rv-heat-track', x: x0 + 1, y, width: Math.max(0, x1 - x0 - 2), height: HEAT_H }));
  if (cell.level === 1 || cell.level === 2) g.appendChild(el(doc, 'rect', { class: 'rv-heat-hatch', x: x0 + 1, y, width: Math.max(0, x1 - x0 - 2), height: HEAT_H, fill: `url(#${patternId})` }));
  else if (cell.level === 3) g.appendChild(el(doc, 'rect', { class: 'rv-heat-solid', x: x0 + 1, y, width: Math.max(0, x1 - x0 - 2), height: HEAT_H }));
  if (cell.label) {
    // Hover (title) or focus shows the bar's count (04 §6.5).
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'img');
    g.setAttribute('aria-label', cell.label);
    const title = el(doc, 'title');
    title.textContent = cell.label;
    g.appendChild(title);
  } else g.setAttribute('aria-hidden', 'true');
  return g;
}

export function clearExtras(host: HTMLElement): void {
  for (const g of host.querySelectorAll('g.rv-extras, g.rv-select')) g.remove();
}

/** The first drawn group of an expected note (tied pieces after it are not separate buttons). */
export function noteGroup(host: HTMLElement, idx: number): SVGGElement | null {
  return host.querySelector<SVGGElement>(`.sr-note[data-expected-idx="${idx}"]`);
}

/** The drawn ghost of a played note. */
export function ghostGroup(host: HTMLElement, detectedId: number): SVGGElement | null {
  return host.querySelector<SVGGElement>(`.sr-ghost[data-detected-id="${detectedId}"]`);
}

/** Notes as focusable buttons with a roving tabindex (04 §8.3); returns the decorated groups by expected index. */
export function decorateNotes(host: HTMLElement, model: ReviewModel, focusIdx: number | null): Map<number, SVGGElement> {
  const out = new Map<number, SVGGElement>();
  const first = model.notes[0]?.idx ?? null;
  const tabStop = focusIdx ?? first;
  for (const n of model.notes) {
    const g = noteGroup(host, n.idx);
    if (!g) continue;
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', n.idx === tabStop ? '0' : '-1');
    g.setAttribute('aria-label', n.ariaLabel);
    g.setAttribute('data-rv-idx', String(n.idx));
    g.classList.add('rv-note');
    out.set(n.idx, g);
  }
  return out;
}

export function setTabStop(notes: Map<number, SVGGElement>, idx: number): void {
  for (const [i, g] of notes) g.setAttribute('tabindex', i === idx ? '0' : '-1');
}

/** The selection ring: around the note box, or around the ghost of an extra (04 §7.4 focus ring). */
export function drawSelection(host: HTMLElement, layout: ScoreLayout, model: ReviewModel, eventIdOf: (idx: number) => string | undefined, t: SlipTarget | null, clef: Clef): void {
  for (const g of host.querySelectorAll('g.rv-select')) g.replaceChildren();
  if (!t) return;
  const svgs = systemSvgs(host);
  let box: { system: number; x: number; y: number; w: number; h: number } | null = null;
  if (t.kind === 'note') {
    const id = eventIdOf(t.idx);
    const b = id ? layout.noteBoxes.get(id) : undefined;
    if (b) box = b;
  } else {
    const x = model.extras.find((e) => e.detectedId === t.detectedId);
    if (x) {
      const pt = layout.beatToPoint(x.beat);
      const sys = layout.systems.find((s) => s.index === pt.system);
      const sp = sys?.lineSpacing ?? 10;
      const y = layout.staffY(pt.system, x.ghost.writtenPitch, clef);
      box = { system: pt.system, x: pt.x, y: y - sp / 2, w: HEAD_W_SP * sp, h: sp };
    }
  }
  if (!box) return;
  const svg = svgs.get(box.system);
  if (!svg) return;
  const g = layer(svg, 'rv-select');
  const pad = 3;
  g.appendChild(el(host.ownerDocument, 'rect', { class: 'rv-select-ring', x: box.x - pad, y: box.y - pad, width: box.w + 2 * pad, height: box.h + 2 * pad, rx: 3, fill: 'none' }));
}
