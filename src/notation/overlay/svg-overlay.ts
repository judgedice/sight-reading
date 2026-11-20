// P15: the notation overlay (01 section 5.8, 04 section 6). Draws note colours, ghost notes, verdict-lane glyphs,
// the bar tint and the playhead as plain SVG on the groups P7 hands over. No React, no VexFlow: every call is a
// handful of attribute writes, idempotent, and skipped when nothing changed.

import { TPQ, type Beats, type Clef, type GhostNote, type NoteBox, type NoteVisualState, type OverlayMode, type PreparedNoteEvt, type ScoreLayout } from '../../core/types.ts';
import type { NotationOverlay, OverlayHost, OverlaySystem, PitchTrace } from '../overlay-seam.ts';
import {
  capUnmatchedGhosts,
  ghostVisual,
  isBrakedBar,
  isErrorState,
  noteVisual,
  type GhostVisual,
  type LaneGlyphId,
  type NoteVisual,
} from '../visual-states.ts';
import { stepsBelowTopLine } from '../pitch-geometry.ts';
import {
  ACCIDENTAL_HEAD_GAP_SP,
  COLLISION_OFFSET,
  CORRECT_DOT_SP,
  CUE_ACCIDENTAL_GAP_SP,
  CUE_HEAD_GAP_SP,
  CUE_SCALE,
  GHOST_FILL,
  GHOST_STROKE,
  GLYPH_COLOUR,
  HEAD_PATH,
  HEAD_UNITS_W,
  HEAD_W_SP,
  LANE_GLYPH_SP,
  LANE_OFFSET_SP,
  MISSED_RING,
  PAST_OPACITY,
  PITCH_ARROW,
  PLAYHEAD_PAD_SP,
  PLAYHEAD_RADIUS_SP,
  REPLAY_DASH,
  REVIEW_STEM_OPACITY,
  RING,
  SHARP_FLAT_OFFSET,
  SMUFL_ACCIDENTAL,
  WRONG_NEAR_OFFSET,
  accidentalSp,
  barIndexOfBeat,
  barTable,
  ghostAccidental,
  ledgerPlan,
  ledgerY,
  stemUp,
  type BarTable,
} from './geometry.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Free area of the `plus-n` glyph (24-unit viewBox) where the overflow count goes (ui/glyph-ids.ts PLUS_N_SLOT). */
const PLUS_N_SLOT = { x: 14.5, y: 6, w: 9, h: 12 } as const;
const NOTE_CLASSES = ['n-ink', 'n-correct', 'n-error', 'n-error-hollow'] as const;
const NOTE_COLOUR: Record<NoteVisual['noteClass'], string> = {
  'n-ink': '',
  'n-correct': 'var(--correct)',
  'n-error': 'var(--error)',
  'n-error-hollow': 'var(--error)',
};
/** Stroke of the drawn lane marks (06 section 7: the ✕ is 1.75 px). */
const LANE_STROKE_PX = 1.75;
/** Reduced motion keeps this one fade (04 section 7, motion rules). */
const REDUCED_GHOST_FADE_MS = 100;

const STYLE_TEXT = `
.sr-overlay .sr-ghost-fade{animation-name:sr-ghost-in;animation-timing-function:linear;animation-fill-mode:backwards}
@keyframes sr-ghost-in{from{opacity:0}}
`;

export interface OverlayOptions {
  /** True when motion should be suppressed. Default: the root `data-motion="reduced"` or the OS preference. */
  reducedMotion?: () => boolean;
  /** True for the high-contrast theme (larger glyphs, thicker ghost strokes). Default: false. */
  highContrast?: () => boolean;
}

function el<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = doc.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

interface BarGroup {
  system: number;
  g: SVGGElement;
  /** Last opacity written, to skip no-op writes. */
  opacity: number;
}

interface NoteMarks {
  g: SVGGElement;
  sig: string;
}

interface GhostNode {
  g: SVGGElement;
  sig: string;
  system: number;
  /** Final notehead left x, centre y, width, steps below the top line: what later ghosts collide with. */
  x: number;
  y: number;
  w: number;
  steps: number;
  /** The accidental's box (x, y, w, h), when the ghost has one. */
  acc: Box | null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export class SvgOverlay implements NotationOverlay {
  private host: OverlayHost | null = null;
  private doc: Document | null = null;
  private table: BarTable | null = null;
  private mode: OverlayMode = 'live';

  private readonly states = new Map<number, NoteVisualState>();
  private readonly ghosts = new Map<number, GhostNote>();
  private readonly noteSig = new Map<number, string>();
  private readonly marks = new Map<number, NoteMarks>();
  private readonly ghostNodes = new Map<number, GhostNode>();
  private readonly overflowNodes = new Map<number, SVGGElement>();
  private readonly barGroups = new Map<number, BarGroup>();
  private readonly notesInBar = new Map<number, number[]>();
  private readonly ghostBar = new Map<number, number>();
  private readonly braked = new Set<number>();
  private readonly sysByIndex = new Map<number, OverlaySystem>();
  private readonly events = new Map<string, PreparedNoteEvt>();
  /** Written noteheads per system, for ghost accidental placement. */
  private readonly headsBySystem = new Map<number, NoteBox[]>();
  /** Slip notes whose group carries the past opacity. */
  private readonly fadedNotes = new Set<number>();

  private playheadBeat: Beats | null = null;
  private playheadLine: SVGLineElement | null = null;
  private tint: SVGRectElement | null = null;
  private tintBar: number | null = null;

  constructor(private readonly opts: OverlayOptions = {}) {}

  // ---- lifecycle ------------------------------------------------------------------------------------------

  attach(host: OverlayHost): void {
    this.detach();
    this.host = host;
    this.table = barTable(host.excerpt);
    const first = host.systems[0];
    this.doc = first ? first.svg.ownerDocument : null;
    if (!this.doc) return;
    const doc = this.doc;
    for (const s of host.systems) {
      this.sysByIndex.set(s.index, s);
      const style = el(doc, 'style');
      style.textContent = STYLE_TEXT;
      s.underlay.appendChild(style);
      for (let b = s.firstBar; b <= s.lastBar; b++) {
        const g = el(doc, 'g', { class: 'sr-bar', 'data-bar': b, 'data-system': s.index });
        s.overlay.appendChild(g);
        this.barGroups.set(b, { system: s.index, g, opacity: 1 });
      }
    }
    host.expectedBar.forEach((bar, idx) => {
      const l = this.notesInBar.get(bar);
      if (l) l.push(idx);
      else this.notesInBar.set(bar, [idx]);
    });
    for (const m of host.excerpt.measures) for (const e of m.events) if (e.kind === 'note') this.events.set(e.id, e);
    for (const box of host.layout.noteBoxes.values()) {
      const l = this.headsBySystem.get(box.system);
      if (l) l.push(box);
      else this.headsBySystem.set(box.system, [box]);
    }
  }

  detach(): void {
    this.clear();
    const host = this.host;
    if (host) {
      for (const s of host.systems) {
        for (const g of Array.from(s.overlay.children)) g.remove();
        for (const g of Array.from(s.underlay.children)) g.remove();
      }
    }
    this.barGroups.clear();
    this.notesInBar.clear();
    this.sysByIndex.clear();
    this.events.clear();
    this.headsBySystem.clear();
    this.playheadLine = null;
    this.tint = null;
    this.host = null;
    this.doc = null;
    this.table = null;
  }

  /** Drop every mark and every remembered state; the structure stays attached. */
  clear(): void {
    const host = this.host;
    if (host) {
      for (const idx of this.states.keys()) this.resetNote(idx);
    }
    for (const m of this.marks.values()) m.g.remove();
    for (const n of this.ghostNodes.values()) n.g.remove();
    for (const o of this.overflowNodes.values()) o.remove();
    this.marks.clear();
    this.ghostNodes.clear();
    this.overflowNodes.clear();
    this.states.clear();
    this.ghosts.clear();
    this.ghostBar.clear();
    this.noteSig.clear();
    this.braked.clear();
    this.fadedNotes.clear();
    this.setPlayhead(null);
    for (const b of this.barGroups.values()) this.setBarOpacity(b, 1);
  }

  // ---- notes ----------------------------------------------------------------------------------------------

  noteState(expectedIdx: number, s: NoteVisualState): void {
    const host = this.host;
    if (!host || host.noteGroups(expectedIdx).length === 0) return;
    this.states.set(expectedIdx, { ...s });
    // Ruling 36: the new state replaces every earlier mark of this note, a ghost included.
    this.dropStaleGhosts(expectedIdx, s);
    const bar = host.expectedBar[expectedIdx]!;
    if (this.updateBrake(bar)) this.redrawBar(bar, expectedIdx);
    this.drawNote(expectedIdx);
  }

  private dropStaleGhosts(idx: number, s: NoteVisualState): void {
    const touched = new Set<number>();
    for (const g of this.ghosts.values()) {
      if (g.targetExpectedIdx !== idx) continue;
      if (g.displaced || g.kind === 'extra') continue;
      if (g.kind === s.timing || g.kind === s.pitch) continue;
      this.ghosts.delete(g.detectedId);
      const bar = this.ghostBar.get(g.detectedId);
      if (bar !== undefined) touched.add(bar);
      this.ghostBar.delete(g.detectedId);
      this.eraseGhostNode(g.detectedId);
    }
    for (const bar of touched) this.syncBarGhosts(bar);
  }

  /** Recompute whether a bar is braked; true when that changed. */
  private updateBrake(bar: number): boolean {
    let errors = 0;
    if (this.mode === 'live') {
      for (const i of this.notesInBar.get(bar) ?? []) {
        const st = this.states.get(i);
        if (st && isErrorState(st)) errors++;
      }
    }
    const now = isBrakedBar(errors);
    const was = this.braked.has(bar);
    if (now === was) return false;
    if (now) this.braked.add(bar);
    else this.braked.delete(bar);
    return true;
  }

  private redrawBar(bar: number, except?: number): void {
    for (const i of this.notesInBar.get(bar) ?? []) if (i !== except && this.states.has(i)) this.drawNote(i);
    this.syncBarGhosts(bar);
  }

  private reducedMotion(): boolean {
    if (this.opts.reducedMotion) return this.opts.reducedMotion();
    const doc = this.doc;
    if (!doc) return false;
    if (doc.documentElement.getAttribute('data-motion') === 'reduced') return true;
    const w = doc.defaultView;
    return typeof w?.matchMedia === 'function' && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private highContrast(): boolean {
    return this.opts.highContrast?.() ?? false;
  }

  /** Lane glyph size in px for a staff space (06 section 7: 1.25 sp, 1.5 sp in high contrast). */
  private glyphSize(sp: number): number {
    const k = this.highContrast() ? LANE_GLYPH_SP.highContrast : this.mode === 'review' ? LANE_GLYPH_SP.review : LANE_GLYPH_SP.live;
    return Math.round(k * sp * 100) / 100;
  }

  /** Top of the first lane glyph: centred on the lane line 2.2 sp under the bottom staff line. */
  private laneTop(sys: { staffTopY: number; lineSpacing: number }, size: number): number {
    return sys.staffTopY + (4 + LANE_OFFSET_SP) * sys.lineSpacing - size / 2;
  }

  private drawNote(idx: number): void {
    const host = this.host;
    const doc = this.doc;
    const st = this.states.get(idx);
    if (!host || !doc || !st) return;
    const bar = host.expectedBar[idx]!;
    const visual = noteVisual(st, this.mode, this.braked.has(bar));
    const reduced = this.reducedMotion();
    const fadeMs = reduced ? 0 : visual.fadeMs;
    const sig = `${visual.noteClass}|${visual.ring}|${visual.laneGlyphs.join(',')}|${fadeMs}|${this.highContrast()}`;
    if (this.noteSig.get(idx) === sig) return;
    this.noteSig.set(idx, sig);

    for (const g of host.noteGroups(idx)) {
      for (const c of NOTE_CLASSES) if (c !== visual.noteClass) g.classList.remove(c);
      g.classList.add(visual.noteClass);
      const colour = NOTE_COLOUR[visual.noteClass];
      g.style.transition = fadeMs > 0 ? `color ${fadeMs}ms linear` : '';
      if (colour) g.style.color = colour;
      else g.style.removeProperty('color');
    }
    this.syncNoteOpacity(idx);
    this.drawMarks(idx, visual);
  }

  /** Remove classes, colour and opacity from a note's drawn groups. */
  private resetNote(idx: number): void {
    const host = this.host;
    if (!host) return;
    for (const g of host.noteGroups(idx)) {
      for (const c of NOTE_CLASSES) g.classList.remove(c);
      g.style.removeProperty('color');
      g.style.removeProperty('transition');
      g.removeAttribute('opacity');
    }
  }

  /** 06 section 7 "Past": a slip note in a system the playhead has left drops with its marks; ink never fades. */
  private syncNoteOpacity(idx: number): void {
    const host = this.host;
    if (!host) return;
    const st = this.states.get(idx);
    const bg = this.barGroups.get(host.expectedBar[idx]!);
    const fade = st !== undefined && this.mode === 'live' && isErrorState(st) && bg !== undefined && bg.opacity !== 1;
    if (fade === this.fadedNotes.has(idx) && !fade) return;
    for (const g of host.noteGroups(idx)) {
      if (fade) g.setAttribute('opacity', String(bg!.opacity));
      else g.removeAttribute('opacity');
    }
    if (fade) this.fadedNotes.add(idx);
    else this.fadedNotes.delete(idx);
  }

  private drawMarks(idx: number, v: NoteVisual): void {
    const host = this.host!;
    const doc = this.doc!;
    const existing = this.marks.get(idx);
    const missed = v.noteClass === 'n-error-hollow';
    if (v.ring === 'none' && v.laneGlyphs.length === 0 && !missed) {
      if (existing) {
        existing.g.remove();
        this.marks.delete(idx);
      }
      return;
    }
    const firstId = host.expectedEventIds[idx]?.[0];
    const box = firstId ? host.layout.noteBoxes.get(firstId) : undefined;
    const bar = host.expectedBar[idx]!;
    const bg = this.barGroups.get(bar);
    if (!box || !bg) return;
    const sys = host.layout.systems.find((s) => s.index === box.system);
    if (!sys) return;
    const parent = box.system === bg.system ? bg.g : this.sysByIndex.get(box.system)?.overlay;
    if (!parent) return;
    const sp = sys.lineSpacing;
    const size = this.glyphSize(sp);

    existing?.g.remove();
    const g = el(doc, 'g', { class: 'sr-note-marks', 'data-marks-for': idx });
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (missed) {
      // A missed note keeps its written head; the ring marks it (06 section 7).
      g.appendChild(
        el(doc, 'ellipse', {
          class: 'sr-ring sr-ring-missed',
          cx: num(cx),
          cy: num(cy),
          rx: num(MISSED_RING.rxHeads * HEAD_W_SP * sp),
          ry: num(MISSED_RING.rySp * sp),
          fill: 'none',
          stroke: 'var(--error)',
          'stroke-width': this.highContrast() ? GHOST_STROKE.highContrast : MISSED_RING.stroke,
        }),
      );
    }
    if (v.ring !== 'none') {
      const rx = box.w * 0.85;
      const ring = el(doc, 'ellipse', {
        class: `sr-ring sr-ring-${v.ring}`,
        cx: num(cx),
        cy: num(cy),
        rx: num(v.ring === 'rejudged' && missed ? MISSED_RING.rxHeads * HEAD_W_SP * sp + 3 : rx),
        ry: num(v.ring === 'rejudged' && missed ? MISSED_RING.rySp * sp + 3 : Math.max(box.h * 0.8, rx * 0.8)),
        fill: 'none',
        stroke: v.ring === 'active' ? 'var(--active)' : 'var(--text-muted)',
        'stroke-width': v.ring === 'active' ? RING.active : RING.rejudgedDashed,
      });
      if (v.ring === 'rejudged') ring.setAttribute('stroke-dasharray', '4 3');
      g.appendChild(ring);
    }
    const laneTop = this.laneTop(sys, size);
    v.laneGlyphs.forEach((id, k) => g.appendChild(this.glyph(id, cx - size / 2, laneTop + k * size, size, sp)));
    this.insertOrdered(parent, g);
    this.marks.set(idx, { g, sig: '' });
  }

  /** Keep a bar group's children in a canonical order (marks by note, then ghosts by id, then the overflow), so the DOM does not depend on arrival order. */
  private insertOrdered(parent: Element, node: SVGGElement): void {
    const rank = (e: Element): [number, number] => {
      if (e.classList.contains('sr-note-marks')) return [0, Number(e.getAttribute('data-marks-for'))];
      if (e.classList.contains('sr-ghost')) return [1, Number(e.getAttribute('data-detected-id'))];
      return [2, 0];
    };
    const [r, k] = rank(node);
    for (const c of Array.from(parent.children)) {
      const [cr, ck] = rank(c);
      if (cr > r || (cr === r && ck > k)) {
        parent.insertBefore(node, c);
        return;
      }
    }
    parent.appendChild(node);
  }

  /**
   * A lane glyph in a size x size box at (x, y). The verdict marks are drawn here at the 06 section 7 sizes (filled
   * triangles, a 1.75 px ✕, ○ and +; a 0.2 sp correct dot); the rest come from the glyph sprite.
   */
  private glyph(id: LaneGlyphId | 'plus-n', x: number, y: number, size: number, sp: number): SVGElement {
    const doc = this.doc!;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const h = size / 2;
    const stroke = this.highContrast() ? GHOST_STROKE.highContrast : LANE_STROKE_PX;
    const base = { class: 'sr-glyph', 'data-glyph': id, 'data-size': num(size) };
    const tri = (pts: [number, number][]): string => `M${pts.map(([px, py]) => `${num(px)} ${num(py)}`).join('L')}Z`;
    let e: SVGElement;
    switch (id) {
      case 'dot':
        e = el(doc, 'circle', { ...base, cx: num(cx), cy: num(cy), r: num(CORRECT_DOT_SP * sp), fill: 'currentColor', stroke: 'none' });
        break;
      case 'early':
        e = el(doc, 'path', { ...base, d: tri([[cx + h * 0.8, cy - h], [cx - h * 0.8, cy], [cx + h * 0.8, cy + h]]), fill: 'currentColor', stroke: 'none' });
        break;
      case 'late':
        e = el(doc, 'path', { ...base, d: tri([[cx - h * 0.8, cy - h], [cx + h * 0.8, cy], [cx - h * 0.8, cy + h]]), fill: 'currentColor', stroke: 'none' });
        break;
      case 'sharp':
        e = el(doc, 'path', { ...base, d: tri([[cx, cy - h], [cx + h, cy + h * 0.75], [cx - h, cy + h * 0.75]]), fill: 'currentColor', stroke: 'none' });
        break;
      case 'flat':
        e = el(doc, 'path', { ...base, d: tri([[cx - h, cy - h * 0.75], [cx + h, cy - h * 0.75], [cx, cy + h]]), fill: 'currentColor', stroke: 'none' });
        break;
      case 'wrong': {
        const k = h - stroke / 2;
        e = el(doc, 'path', { ...base, d: `M${num(cx - k)} ${num(cy - k)}L${num(cx + k)} ${num(cy + k)}M${num(cx + k)} ${num(cy - k)}L${num(cx - k)} ${num(cy + k)}`, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round' });
        break;
      }
      case 'missed':
        e = el(doc, 'circle', { ...base, cx: num(cx), cy: num(cy), r: num(h - stroke / 2), fill: 'none', stroke: 'currentColor', 'stroke-width': stroke });
        break;
      case 'extra': {
        const k = h - stroke / 2;
        e = el(doc, 'path', { ...base, d: `M${num(cx)} ${num(cy - k)}V${num(cy + k)}M${num(cx - k)} ${num(cy)}H${num(cx + k)}`, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round' });
        break;
      }
      default:
        e = el(doc, 'use', { ...base, href: `#${id}`, x: num(x), y: num(y), width: num(size), height: num(size) });
    }
    e.style.color = GLYPH_COLOUR[id];
    return e;
  }

  // ---- ghosts ---------------------------------------------------------------------------------------------

  showGhost(g: GhostNote): void {
    const host = this.host;
    if (!host || !this.table) return;
    this.ghosts.set(g.detectedId, { ...g });
    const bar = this.table.bars[barIndexOfBeat(this.table, g.scoreBeat)];
    if (bar === undefined) return;
    const old = this.ghostBar.get(g.detectedId);
    this.ghostBar.set(g.detectedId, bar);
    if (old !== undefined && old !== bar) this.syncBarGhosts(old);
    this.syncBarGhosts(bar);
  }

  removeGhost(detectedId: number): void {
    if (!this.ghosts.delete(detectedId)) return;
    const bar = this.ghostBar.get(detectedId);
    this.ghostBar.delete(detectedId);
    this.eraseGhostNode(detectedId);
    if (bar !== undefined) this.syncBarGhosts(bar);
  }

  private eraseGhostNode(id: number): void {
    const n = this.ghostNodes.get(id);
    if (n) {
      n.g.remove();
      this.ghostNodes.delete(id);
    }
  }

  /** Draw, update or remove every ghost of one bar, applying the unmatched cap (6.4 rule 10) and the brake. */
  private syncBarGhosts(bar: number): void {
    const inBar: GhostNote[] = [];
    for (const [id, b] of this.ghostBar) if (b === bar) inBar.push(this.ghosts.get(id)!);
    inBar.sort((a, b) => a.detectedId - b.detectedId);

    const unmatched = inBar.filter((g) => g.kind === 'extra' || g.displaced);
    const cap = capUnmatchedGhosts(unmatched.length, this.mode);
    const hidden = new Set(unmatched.slice(cap.shown).map((g) => g.detectedId));

    for (const g of inBar) {
      if (hidden.has(g.detectedId) || this.mode === 'blind') this.eraseGhostNode(g.detectedId);
      else this.drawGhost(g, bar);
    }
    this.drawOverflow(bar, cap.overflow, unmatched[cap.shown]);
  }

  private drawOverflow(bar: number, count: number, first: GhostNote | undefined): void {
    const old = this.overflowNodes.get(bar);
    if (count === 0 || !first || !this.host || !this.doc) {
      if (old) {
        old.remove();
        this.overflowNodes.delete(bar);
      }
      return;
    }
    const pt = this.host.layout.beatToPoint(first.scoreBeat);
    const sys = this.host.layout.systems.find((s) => s.index === pt.system);
    const bg = this.barGroups.get(bar);
    if (!sys || !bg) return;
    const size = this.glyphSize(sys.lineSpacing);
    const sig = `${pt.x}|${count}|${size}`;
    if (old && old.getAttribute('data-sig') === sig) return;
    old?.remove();
    const g = el(this.doc, 'g', { class: 'sr-overflow', 'data-bar': bar, 'data-count': count, 'data-sig': sig });
    const x = pt.x;
    const y = this.laneTop(sys, size);
    g.appendChild(this.glyph('plus-n', x, y, size, sys.lineSpacing));
    const k = size / 24;
    const t = el(this.doc, 'text', {
      x: num(x + (PLUS_N_SLOT.x + PLUS_N_SLOT.w / 2) * k),
      y: num(y + (PLUS_N_SLOT.y + PLUS_N_SLOT.h * 0.8) * k),
      'text-anchor': 'middle',
      'font-size': num(PLUS_N_SLOT.h * k * 0.9),
      fill: 'var(--ghost)',
      stroke: 'none',
    });
    t.textContent = String(count);
    g.appendChild(t);
    this.insertOrdered(pt.system === bg.system ? bg.g : this.sysByIndex.get(pt.system)!.overlay, g);
    this.overflowNodes.set(bar, g);
  }

  /** The written note a ghost belongs to: its event and head box, when drawn. */
  private target(g: GhostNote): { evt: PreparedNoteEvt | undefined; box: NoteBox | undefined } {
    const host = this.host!;
    const id = g.targetExpectedIdx === null ? undefined : host.expectedEventIds[g.targetExpectedIdx]?.[0];
    return { evt: id ? this.events.get(id) : undefined, box: id ? host.layout.noteBoxes.get(id) : undefined };
  }

  private drawGhost(g: GhostNote, bar: number): void {
    const host = this.host!;
    const doc = this.doc!;
    const layout = host.layout;
    const clef = host.excerpt.clef;
    const pt = layout.beatToPoint(g.scoreBeat);
    const sys = layout.systems.find((s) => s.index === pt.system);
    const osys = this.sysByIndex.get(pt.system);
    if (!sys || !osys) return;
    const sp = sys.lineSpacing;
    const fullHeadW = HEAD_W_SP * sp;
    const braked = this.braked.has(bar);
    const v: GhostVisual = ghostVisual(g, this.mode, braked);
    const review = this.mode === 'review';
    const hc = this.highContrast();
    const acc = ghostAccidental(host.excerpt, g.writtenPitch);
    // 06 section 7: a ghost that needs an accidental is drawn at cue size.
    const cue = acc !== null;
    const scale = cue ? CUE_SCALE : 1;
    const headW = fullHeadW * scale;
    const { evt, box: tbox } = this.target(g);

    // Position: x is the played onset (6.2); y is the played pitch, clamped past 4 ledger lines.
    const lp = ledgerPlan(g.writtenPitch, clef);
    let cy = layout.staffY(pt.system, g.writtenPitch, clef);
    if (lp.clamped) cy = lp.side === 'above' ? sys.staffTopY - 4 * sp : sys.staffTopY + 8 * sp;
    const steps = stepsBelowTopLine(g.writtenPitch, clef);
    let x = pt.x;
    if (v.offsetRight) x += SHARP_FLAT_OFFSET * fullHeadW;
    else if (g.kind === 'wrong-pitch' && evt && Math.abs(stepsBelowTopLine(evt.writtenPitch, clef) - steps) <= 1) x += WRONG_NEAR_OFFSET * fullHeadW;

    // The accidental sits between the written note and the ghost; neither reaches into another glyph. Ghosts are
    // placed in id order (each one avoids the lower ids), so the result does not depend on arrival order.
    const svgW = Number(osys.svg.getAttribute('width') ?? 0);
    let accBox: Box | null = null;
    let aw = 0;
    let headGap = 0;
    let ah = { up: 0, down: 0 };
    if (acc !== null) {
      const m = accidentalSp(acc);
      aw = m.w * sp * scale;
      ah = { up: m.up * sp * scale, down: m.down * sp * scale };
      headGap = Math.max(CUE_HEAD_GAP_SP * sp - aw, ACCIDENTAL_HEAD_GAP_SP * sp);
      // The written note's own head first: the accidental starts 0.2 sp right of it.
      const minAcc = tbox && tbox.system === pt.system && x >= tbox.x ? tbox.x + tbox.w + CUE_ACCIDENTAL_GAP_SP * sp : -Infinity;
      if (x - headGap - aw < minAcc) x = minAcc + aw + headGap;
    }
    x += this.collisionOffset(g.detectedId, pt.system, x, steps, headW, svgW);
    const accAt = (hx: number): Box | null => (acc === null ? null : { x: hx - headGap - aw, y: cy - ah.up, w: aw, h: ah.up + ah.down });
    const lower: Box[] = [];
    const lowerAcc: Box[] = [];
    for (const [oid, n] of this.ghostNodes) {
      if (oid >= g.detectedId || n.system !== pt.system) continue;
      lower.push({ x: n.x, y: n.y - 0.5 * sp, w: n.w, h: sp });
      if (n.acc) lowerAcc.push(n.acc);
    }
    const heads: Box[] = acc === null ? [] : (this.headsBySystem.get(pt.system) ?? []).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    for (let pass = 0; pass < 8; pass++) {
      const headBox: Box = { x, y: cy - 0.5 * sp, w: headW, h: sp };
      const a = accAt(x);
      const accHit = a ? [...heads, ...lower, ...lowerAcc].find((o) => overlaps(a, o)) : undefined;
      if (accHit) {
        x = accHit.x + accHit.w + CUE_ACCIDENTAL_GAP_SP * sp + aw + headGap;
        continue;
      }
      const headHit = lowerAcc.find((o) => overlaps(headBox, o));
      if (headHit) {
        x = headHit.x + headHit.w + ACCIDENTAL_HEAD_GAP_SP * sp;
        continue;
      }
      break;
    }
    accBox = accAt(x);

    const reduced = this.reducedMotion();
    const fadeMs = v.fadeMs > 0 && reduced ? REDUCED_GHOST_FADE_MS : v.fadeMs;
    const size = this.glyphSize(sp);
    const hollow = review && evt !== undefined && evt.dur >= 2 * TPQ;
    const sig = [
      v.style, v.arrow, v.stem, v.opacity, fadeMs, v.laneGlyph, num(x), num(cy), pt.system, bar,
      acc, hc, g.writtenPitch.step, g.writtenPitch.octave, g.writtenPitch.alter, size, g.targetExpectedIdx, hollow,
    ].join('|');
    const old = this.ghostNodes.get(g.detectedId);
    if (old && old.sig === sig) return;

    const grp = el(doc, 'g', {
      class: `sr-ghost sr-${v.style}`,
      'data-detected-id': g.detectedId,
      'data-kind': g.kind,
      'data-style': v.style,
      'data-bar': bar,
    });
    if (cue) grp.setAttribute('data-cue', 'true');
    const colour = v.style === 'ghost-replay' ? 'var(--ghost-replay)' : 'var(--ghost)';
    grp.style.color = colour;
    if (v.opacity !== 1) grp.setAttribute('opacity', String(v.opacity));
    // A ghost already on screen keeps its look when it is re-sent (no second fade).
    if (!old && fadeMs > 0) {
      grp.classList.add('sr-ghost-fade');
      grp.style.animationDuration = `${fadeMs}ms`;
    }
    const strokeW = hc ? GHOST_STROKE.highContrast : GHOST_STROKE.live;
    const fillA = review ? GHOST_FILL.review : hc ? GHOST_FILL.highContrast : GHOST_FILL.live;

    if (lp.count > 0 && lp.side !== 'none') {
      let d = '';
      for (let k = 1; k <= lp.count; k++) {
        const ly = num(ledgerY(lp.side, k, sys.staffTopY, sp));
        d += `M${num(x - 0.4 * sp * scale)} ${ly}H${num(x + headW + 0.4 * sp * scale)}`;
      }
      grp.appendChild(
        el(doc, 'path', { class: 'sr-ghost-ledgers', d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-dasharray': '2 2' }),
      );
    }
    if (acc !== null && accBox) {
      const b: Box = accBox;
      const t = el(doc, 'text', {
        class: 'sr-ghost-accidental',
        x: num(b.x),
        y: num(cy),
        'font-family': 'Bravura, serif',
        'font-size': num(4 * sp * scale),
        fill: 'currentColor',
        stroke: 'none',
        'data-box': `${num(b.x)} ${num(b.y)} ${num(b.w)} ${num(b.h)}`,
      });
      t.textContent = SMUFL_ACCIDENTAL[acc];
      grp.appendChild(t);
    }
    const k = headW / HEAD_UNITS_W;
    const head = el(doc, 'path', {
      class: 'sr-ghost-head',
      d: HEAD_PATH,
      transform: `translate(${num(x)} ${num(cy)}) scale(${k} ${-k})`,
      'vector-effect': 'non-scaling-stroke',
      stroke: 'currentColor',
      'stroke-width': strokeW,
    });
    if (v.style === 'ghost-replay') {
      head.setAttribute('fill', 'none');
      head.setAttribute('stroke-dasharray', REPLAY_DASH);
    } else if (hollow) {
      head.setAttribute('fill', 'none');
    } else {
      head.setAttribute('fill', 'currentColor');
      head.setAttribute('fill-opacity', String(fillA));
    }
    grp.appendChild(head);

    if (v.stem) {
      const up = stemUp(g.writtenPitch, clef);
      const sx = up ? x + headW : x;
      grp.appendChild(
        el(doc, 'line', {
          class: 'sr-ghost-stem',
          x1: num(sx),
          x2: num(sx),
          y1: num(cy),
          y2: num(up ? cy - 3.5 * sp * scale : cy + 3.5 * sp * scale),
          stroke: 'currentColor',
          'stroke-opacity': REVIEW_STEM_OPACITY,
          'stroke-width': 1.2,
        }),
      );
    }
    if (v.arrow) grp.appendChild(this.pitchArrow(v.arrow, x + headW / 2, cy, sp, hc ? GHOST_STROKE.highContrast : LANE_STROKE_PX));
    if (lp.clamped) {
      const t = el(doc, 'text', {
        class: 'sr-ghost-8va',
        x: num(x + headW / 2),
        y: num(lp.side === 'above' ? cy - 0.8 * sp : cy + 1.8 * sp),
        'text-anchor': 'middle',
        'font-size': 10,
        fill: 'currentColor',
        stroke: 'none',
      });
      t.textContent = lp.side === 'above' ? '8va' : '8vb';
      grp.appendChild(t);
    }
    if (review && g.targetExpectedIdx !== null) this.addLeader(grp, g, x, cy, headW, pt.system);
    if (v.laneGlyph) {
      grp.appendChild(this.glyph(v.laneGlyph, x + headW / 2 - size / 2, this.laneTop(sys, size), size, sp));
    }

    const bg = this.barGroups.get(bar);
    const parent = bg && bg.system === pt.system ? bg.g : osys.overlay;
    old?.g.remove();
    this.insertOrdered(parent, grp);
    this.ghostNodes.set(g.detectedId, { g: grp, sig, system: pt.system, x, y: cy, w: headW, steps, acc: accBox });
  }

  /** Vertical pitch arrow (06 section 7): 1.6 sp long, starting 1 sp above (sharp) or below (flat) the ghost centre. */
  private pitchArrow(dir: 'up' | 'down', cx: number, cy: number, sp: number, strokeW: number): SVGGElement {
    const doc = this.doc!;
    const s = dir === 'up' ? -1 : 1;
    const y0 = cy + s * PITCH_ARROW.gapSp * sp;
    const y1 = y0 + s * PITCH_ARROW.lengthSp * sp;
    const hw = 0.35 * sp;
    const g = el(doc, 'g', { class: 'sr-ghost-arrow', 'data-arrow': dir });
    g.appendChild(
      el(doc, 'path', {
        d: `M${num(cx)} ${num(y0)}V${num(y1)}M${num(cx - hw)} ${num(y1 - s * hw)}L${num(cx)} ${num(y1)}L${num(cx + hw)} ${num(y1 - s * hw)}`,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': strokeW,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
    return g;
  }

  /** 6.2 collisions: offset right by 0.8 notehead widths (0.5 when out of room) from lower-id ghosts it overlaps. */
  private collisionOffset(id: number, system: number, x: number, steps: number, headW: number, svgW: number): number {
    let off = 0;
    for (let pass = 0; pass < 4; pass++) {
      let hit = false;
      for (const [oid, n] of this.ghostNodes) {
        if (oid >= id || n.system !== system) continue;
        if (Math.abs(n.steps - steps) <= 1 && Math.abs(n.x - (x + off)) < 0.8 * headW) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      const room = svgW <= 0 || x + off + (COLLISION_OFFSET.preferred + 1) * headW <= svgW;
      off += (room ? COLLISION_OFFSET.preferred : COLLISION_OFFSET.minimum) * headW;
    }
    return off;
  }

  private addLeader(grp: SVGGElement, g: GhostNote, x: number, cy: number, headW: number, system: number): void {
    const host = this.host!;
    const id = host.expectedEventIds[g.targetExpectedIdx!]?.[0];
    const box = id ? host.layout.noteBoxes.get(id) : undefined;
    if (!box || box.system !== system) return;
    const gap = Math.abs(box.x - x);
    if (gap < 1.5 * headW) return;
    const tx = box.x + box.w / 2;
    const ty = box.y + box.h / 2;
    const dir = tx > x + headW / 2 ? 1 : -1;
    const sx = x + headW / 2 + dir * (headW / 2);
    const ex = tx - dir * (box.w / 2 + 1);
    grp.appendChild(
      el(this.doc!, 'line', {
        class: 'sr-ghost-leader',
        x1: num(sx),
        y1: num(cy),
        x2: num(ex),
        y2: num(ty),
        stroke: 'currentColor',
        'stroke-width': 1,
        'stroke-dasharray': '1 2',
      }),
    );
    grp.appendChild(
      el(this.doc!, 'path', { class: 'sr-ghost-leader-head', d: `M${num(ex)} ${num(ty)}l${-dir * 4} -2v4z`, fill: 'currentColor', stroke: 'none' }),
    );
  }

  // ---- playhead wash, fading of the past ------------------------------------------------------------------

  setPlayhead(scoreBeat: Beats | null): void {
    this.playheadBeat = scoreBeat;
    const host = this.host;
    const table = this.table;
    const doc = this.doc;
    if (!host || !table || !doc) return;
    if (scoreBeat === null) {
      this.playheadLine?.setAttribute('visibility', 'hidden');
      this.tint?.setAttribute('visibility', 'hidden');
      this.tintBar = null;
      for (const b of this.barGroups.values()) this.setBarOpacity(b, 1);
      this.syncAllNoteOpacity();
      return;
    }
    const pt = host.layout.beatToPoint(scoreBeat);
    const osys = this.sysByIndex.get(pt.system);
    const lsys = host.layout.systems.find((s) => s.index === pt.system);
    if (!osys || !lsys) return;

    // The playhead position is kept as an invisible marker for tests and tools: 06 section 7 draws no line.
    if (!this.playheadLine) {
      this.playheadLine = el(doc, 'line', { class: 'sr-playhead', stroke: 'none', 'pointer-events': 'none', visibility: 'hidden' });
    }
    const line = this.playheadLine;
    if (line.parentNode !== osys.overlay) osys.overlay.appendChild(line);
    line.setAttribute('x1', num(pt.x));
    line.setAttribute('x2', num(pt.x));
    line.setAttribute('y1', num(lsys.staffTopY));
    line.setAttribute('y2', num(lsys.staffTopY + 4 * lsys.lineSpacing));

    // One wash behind the current bar, only while the beat lies inside the excerpt. No next-bar marker.
    const bi = barIndexOfBeat(table, scoreBeat);
    const inside = bi >= 0 && scoreBeat >= table.startBeat[bi]! && scoreBeat < table.endBeat[bi]!;
    if (!inside) {
      this.tint?.setAttribute('visibility', 'hidden');
      this.tintBar = null;
    } else if (this.tintBar !== table.bars[bi]) this.placeTint(bi);
    this.fadePast(table, pt.system);
  }

  private placeTint(bi: number): void {
    const host = this.host!;
    const table = this.table!;
    const doc = this.doc!;
    const start = host.layout.beatToPoint(table.startBeat[bi]!);
    const osys = this.sysByIndex.get(start.system);
    const lsys = host.layout.systems.find((s) => s.index === start.system);
    if (!osys || !lsys) return;
    const end = host.layout.beatToPoint(table.endBeat[bi]!);
    const svgW = Number(osys.svg.getAttribute('width') ?? start.x);
    const x1 = end.system === start.system && bi + 1 < table.bars.length ? end.x : svgW;
    const sp = lsys.lineSpacing;
    const [above, inset] = PLAYHEAD_PAD_SP;
    if (!this.tint) {
      this.tint = el(doc, 'rect', { class: 'sr-bar-tint', fill: 'var(--playhead-bar)', stroke: 'none', 'pointer-events': 'none' });
    }
    const r = this.tint;
    if (r.parentNode !== osys.underlay) osys.underlay.appendChild(r);
    const top = lsys.staffTopY - above * sp;
    // Down to below the lane: the lane line sits 2.2 sp under the staff; the wash ends a glyph's height past it.
    const bottom = lsys.staffTopY + (4 + LANE_OFFSET_SP + LANE_GLYPH_SP.live) * sp;
    r.setAttribute('visibility', 'visible');
    r.setAttribute('data-bar', String(table.bars[bi]));
    r.setAttribute('x', num(start.x + inset * sp));
    r.setAttribute('width', num(Math.max(0, x1 - start.x - 2 * inset * sp)));
    r.setAttribute('y', num(top));
    r.setAttribute('height', num(bottom - top));
    r.setAttribute('rx', num(PLAYHEAD_RADIUS_SP * sp));
    this.tintBar = table.bars[bi]!;
  }

  /** 06 section 7: once the playhead has left a system, every slip mark in it drops to 70% together. */
  private fadePast(table: BarTable, playSystem: number): void {
    for (let i = 0; i < table.bars.length; i++) {
      const bg = this.barGroups.get(table.bars[i]!);
      if (!bg) continue;
      this.setBarOpacity(bg, this.mode === 'live' && bg.system < playSystem ? PAST_OPACITY.systemLeft : 1);
    }
    this.syncAllNoteOpacity();
  }

  private syncAllNoteOpacity(): void {
    for (const idx of this.states.keys()) this.syncNoteOpacity(idx);
  }

  private setBarOpacity(b: BarGroup, o: number): void {
    if (b.opacity === o) return;
    b.opacity = o;
    if (o === 1) b.g.removeAttribute('opacity');
    else b.g.setAttribute('opacity', String(o));
  }

  // ---- pitch trace ("Show what we heard") ------------------------------------------------------------------

  /** Draw the try's pitch track behind the ink, or remove it with null. Survives `clear()` only when redrawn. */
  showTrace(trace: PitchTrace | null): void {
    const host = this.host;
    if (!host) return;
    const svgs = new Map<number, SVGSVGElement>();
    for (const s of host.systems) svgs.set(s.index, s.svg);
    drawPitchTrace(svgs, host.layout, host.excerpt.clef, trace);
  }

  // ---- mode -----------------------------------------------------------------------------------------------

  setMode(m: OverlayMode): void {
    if (m === this.mode) return;
    this.mode = m;
    const host = this.host;
    if (!host) return;
    this.noteSig.clear();
    this.braked.clear();
    for (const bar of this.notesInBar.keys()) this.updateBrake(bar);
    for (const idx of this.states.keys()) this.drawNote(idx);
    const bars = new Set(this.ghostBar.values());
    for (const n of this.ghostNodes.values()) n.g.remove();
    this.ghostNodes.clear();
    for (const bar of bars) this.syncBarGhosts(bar);
    if (this.playheadBeat !== null) this.setPlayhead(this.playheadBeat);
    else {
      for (const b of this.barGroups.values()) this.setBarOpacity(b, 1);
      this.syncAllNoteOpacity();
    }
  }
}

// ---- pitch trace ----------------------------------------------------------------------------------------------

/** Stroke of the pitch trace, px: thinner than a staff line's neighbours so it never reads as ink. */
export const TRACE_STROKE_PX = 1.25;
/** A pause longer than this between frames, in beats, breaks the line. */
export const TRACE_GAP_BEATS = 0.25;
/** A jump larger than this between frames, in semitones, breaks the line (a new note, not a slide). */
export const TRACE_JUMP_SEMITONES = 1;
/** The line is clamped this many staff spaces past the outer staff lines (ghosts clamp at four ledger lines). */
const TRACE_CLAMP_SP = 4;

/** One unbroken run of the trace on one system, px within that system's SVG. */
export interface TraceSegment {
  system: number;
  points: { x: number; y: number }[];
}

/**
 * The trace as polylines per system. y follows the written staff position: a whole MIDI number sits where its notehead
 * would, and a fraction is interpolated to the next one, so an in-tune held note lies on its notehead and a scoop or a
 * fall slopes. The line breaks at unvoiced frames, pauses, jumps and system ends.
 */
export function pitchTraceSegments(layout: ScoreLayout, clef: Clef, trace: PitchTrace): TraceSegment[] {
  const out: TraceSegment[] = [];
  const yCache = new Map<string, number>();
  const yOfWhole = (system: number, m: number): number => {
    const k = `${system}|${m}`;
    let y = yCache.get(k);
    if (y === undefined) {
      y = layout.staffY(system, trace.spell(m), clef);
      yCache.set(k, y);
    }
    return y;
  };
  let cur: TraceSegment | null = null;
  let lastBeat = -Infinity;
  let lastMidi: number | null = null;
  const n = Math.min(trace.beats.length, trace.midi.length);
  for (let i = 0; i < n; i++) {
    const beat = trace.beats[i]!;
    const m = trace.midi[i] ?? null;
    if (m === null || !Number.isFinite(m) || !Number.isFinite(beat)) {
      cur = null;
      lastMidi = null;
      continue;
    }
    const pt = layout.beatToPoint(beat);
    const sys = layout.systems.find((s) => s.index === pt.system);
    if (!sys) {
      cur = null;
      continue;
    }
    const broken = cur === null || cur.system !== pt.system || beat - lastBeat > TRACE_GAP_BEATS || lastMidi === null || Math.abs(m - lastMidi) > TRACE_JUMP_SEMITONES;
    if (broken) {
      cur = { system: pt.system, points: [] };
      out.push(cur);
    }
    const lo = Math.floor(m);
    const f = m - lo;
    const y0 = yOfWhole(pt.system, lo);
    const y = f < 1e-6 ? y0 : y0 + (yOfWhole(pt.system, lo + 1) - y0) * f;
    const sp = sys.lineSpacing;
    const top = sys.staffTopY - TRACE_CLAMP_SP * sp;
    const bottom = sys.staffTopY + (4 + TRACE_CLAMP_SP) * sp;
    cur!.points.push({ x: pt.x, y: Math.min(bottom, Math.max(top, y)) });
    lastBeat = beat;
    lastMidi = m;
  }
  // A single frame is not a line.
  return out.filter((s) => s.points.length >= 2);
}

/** SVG path data of one segment. */
export function tracePath(seg: TraceSegment): string {
  return seg.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join('');
}

/**
 * Draw the trace into each system's underlay (behind the ink), replacing any earlier one; null removes it. `svgs` are
 * the system SVGs by system index (each has the `g.sr-underlay` the static render creates).
 */
export function drawPitchTrace(svgs: ReadonlyMap<number, SVGSVGElement>, layout: ScoreLayout, clef: Clef, trace: PitchTrace | null): void {
  for (const svg of svgs.values()) svg.querySelectorAll('g.sr-trace').forEach((g) => g.remove());
  if (!trace) return;
  const bySystem = new Map<number, TraceSegment[]>();
  for (const seg of pitchTraceSegments(layout, clef, trace)) {
    const l = bySystem.get(seg.system);
    if (l) l.push(seg);
    else bySystem.set(seg.system, [seg]);
  }
  for (const [system, segs] of bySystem) {
    const svg = svgs.get(system);
    if (!svg) continue;
    const doc = svg.ownerDocument;
    const parent = svg.querySelector<SVGGElement>(':scope > g.sr-underlay') ?? svg;
    const g = el(doc, 'g', { class: 'sr-trace', 'data-system': system, 'aria-hidden': 'true', 'pointer-events': 'none' });
    for (const seg of segs) {
      g.appendChild(
        el(doc, 'path', {
          class: 'sr-trace-line',
          d: tracePath(seg),
          fill: 'none',
          stroke: 'var(--text-muted)',
          'stroke-width': TRACE_STROKE_PX,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }
    parent.appendChild(g);
  }
}
