// P15: the notation overlay (01 section 5.8, 04 section 6). Draws note colours, ghost notes, verdict-lane glyphs,
// the bar tint and the playhead as plain SVG on the groups P7 hands over. No React, no VexFlow: every call is a
// handful of attribute writes, idempotent, and skipped when nothing changed.

import type { Beats, GhostNote, NoteVisualState, OverlayMode } from '../../core/types.ts';
import type { NotationOverlay, OverlayHost, OverlaySystem } from '../overlay-seam.ts';
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
  COLLISION_OFFSET,
  GHOST_FILL,
  GHOST_STROKE,
  GLYPH_COLOUR,
  GLYPH_SIZE,
  HEAD_PATH,
  HEAD_UNITS_W,
  HEAD_W_SP,
  LANE_PX,
  NEXT_BAR_MARKER_FROM,
  PAST_OPACITY,
  REPLAY_DASH,
  RING,
  SHARP_FLAT_OFFSET,
  SMUFL_ACCIDENTAL,
  SYSTEM_GAP_PX,
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
/** Reduced motion keeps this one fade (04 section 7, motion rules). */
const REDUCED_GHOST_FADE_MS = 100;

const STYLE_TEXT = `
.sr-overlay .sr-ghost-fade{animation-name:sr-ghost-in;animation-timing-function:linear;animation-fill-mode:backwards}
@keyframes sr-ghost-in{from{opacity:0}}
.n-error-hollow path,.n-error-hollow text{fill:none;stroke:currentColor;stroke-width:1.5px}
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
  /** Final notehead left x, centre y, steps below the top line: what later ghosts collide with. */
  x: number;
  y: number;
  steps: number;
}

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

  private playheadBeat: Beats | null = null;
  private playheadLine: SVGLineElement | null = null;
  private tint: SVGRectElement | null = null;
  private marker: SVGRectElement | null = null;
  private tintBar: number | null = null;
  private markerBar: number | null = null;

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
    this.playheadLine = null;
    this.tint = null;
    this.marker = null;
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

  private glyphSize(): number {
    return this.mode === 'review' ? GLYPH_SIZE.review : this.highContrast() ? GLYPH_SIZE.highContrast : GLYPH_SIZE.live;
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
    const size = this.glyphSize();
    const sig = `${visual.noteClass}|${visual.ring}|${visual.laneGlyphs.join(',')}|${fadeMs}|${size}`;
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
    this.drawMarks(idx, visual, size);
  }

  /** Remove classes and colour from a note's drawn groups. */
  private resetNote(idx: number): void {
    const host = this.host;
    if (!host) return;
    for (const g of host.noteGroups(idx)) {
      for (const c of NOTE_CLASSES) g.classList.remove(c);
      g.style.removeProperty('color');
      g.style.removeProperty('transition');
    }
  }

  private drawMarks(idx: number, v: NoteVisual, size: number): void {
    const host = this.host!;
    const doc = this.doc!;
    const existing = this.marks.get(idx);
    if (v.ring === 'none' && v.laneGlyphs.length === 0) {
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

    existing?.g.remove();
    const g = el(doc, 'g', { class: 'sr-note-marks', 'data-marks-for': idx });
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (v.ring !== 'none') {
      const rx = box.w * 0.85;
      const ring = el(doc, 'ellipse', {
        class: `sr-ring sr-ring-${v.ring}`,
        cx: num(cx),
        cy: num(cy),
        rx: num(rx),
        ry: num(Math.max(box.h * 0.8, rx * 0.8)),
        fill: 'none',
        stroke: v.ring === 'active' ? 'var(--active)' : 'var(--text-muted)',
        'stroke-width': v.ring === 'active' ? RING.active : RING.rejudgedDashed,
      });
      if (v.ring === 'rejudged') ring.setAttribute('stroke-dasharray', '4 3');
      g.appendChild(ring);
    }
    const laneTop = sys.heightPx - SYSTEM_GAP_PX - LANE_PX;
    v.laneGlyphs.forEach((id, k) => g.appendChild(this.glyph(id, cx - size / 2, laneTop + k * size, size)));
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

  private glyph(id: LaneGlyphId | 'plus-n', x: number, y: number, size: number): SVGUseElement {
    const u = el(this.doc!, 'use', {
      href: `#${id}`,
      class: 'sr-glyph',
      'data-glyph': id,
      x: num(x),
      y: num(y),
      width: size,
      height: size,
    });
    u.style.color = GLYPH_COLOUR[id];
    return u;
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
    const size = this.glyphSize();
    const sig = `${pt.x}|${count}|${size}`;
    if (old && old.getAttribute('data-sig') === sig) return;
    old?.remove();
    const g = el(this.doc, 'g', { class: 'sr-overflow', 'data-bar': bar, 'data-count': count, 'data-sig': sig });
    const x = pt.x;
    const y = sys.heightPx - SYSTEM_GAP_PX - LANE_PX;
    g.appendChild(this.glyph('plus-n', x, y, size));
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
    const headW = HEAD_W_SP * sp;
    const braked = this.braked.has(bar);
    const v: GhostVisual = ghostVisual(g, this.mode, braked);
    const review = this.mode === 'review';
    const hc = this.highContrast();

    // Position: x never moves with timing error (6.2), y is the played pitch, clamped past 4 ledger lines.
    const lp = ledgerPlan(g.writtenPitch, clef);
    let cy = layout.staffY(pt.system, g.writtenPitch, clef);
    if (lp.clamped) cy = lp.side === 'above' ? sys.staffTopY - 4 * sp : sys.staffTopY + 8 * sp;
    const steps = stepsBelowTopLine(g.writtenPitch, clef);
    let x = pt.x + (v.offsetRight ? SHARP_FLAT_OFFSET * headW : 0);
    x += this.collisionOffset(g.detectedId, pt.system, x, steps, headW, Number(osys.svg.getAttribute('width') ?? 0));

    const reduced = this.reducedMotion();
    const fadeMs = v.fadeMs > 0 && reduced ? REDUCED_GHOST_FADE_MS : v.fadeMs;
    const acc = ghostAccidental(host.excerpt, g.writtenPitch);
    const size = this.glyphSize();
    const sig = [
      v.style, v.arrow, v.stem, v.opacity, fadeMs, v.laneGlyph, num(x), num(cy), pt.system, bar,
      acc, hc, g.writtenPitch.step, g.writtenPitch.octave, g.writtenPitch.alter, size, g.targetExpectedIdx,
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
        d += `M${num(x - 0.4 * sp)} ${ly}H${num(x + headW + 0.4 * sp)}`;
      }
      grp.appendChild(
        el(doc, 'path', { class: 'sr-ghost-ledgers', d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-dasharray': '2 2' }),
      );
    }
    if (acc !== null) {
      const t = el(doc, 'text', {
        class: 'sr-ghost-accidental',
        x: num(x - 0.25 * sp),
        y: num(cy),
        'text-anchor': 'end',
        'font-family': 'Bravura, serif',
        'font-size': num(4 * sp),
        fill: 'currentColor',
        stroke: 'none',
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
          y2: num(up ? cy - 3.5 * sp : cy + 3.5 * sp),
          stroke: 'currentColor',
          'stroke-opacity': 0.7,
          'stroke-width': 1.2,
        }),
      );
    }
    if (v.arrow) {
      const a = el(doc, 'use', {
        href: `#arrow-${v.arrow}`,
        class: 'sr-ghost-arrow',
        x: num(x + headW + 1),
        y: num(cy - 3),
        width: 6,
        height: 6,
      });
      grp.appendChild(a);
    }
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
      grp.appendChild(this.glyph(v.laneGlyph, x + headW / 2 - size / 2, sys.heightPx - SYSTEM_GAP_PX - LANE_PX, size));
    }

    const bg = this.barGroups.get(bar);
    const parent = bg && bg.system === pt.system ? bg.g : osys.overlay;
    old?.g.remove();
    this.insertOrdered(parent, grp);
    this.ghostNodes.set(g.detectedId, { g: grp, sig, system: pt.system, x, y: cy, steps });
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

  // ---- playhead, bar tint, fading of the past ---------------------------------------------------------------

  setPlayhead(scoreBeat: Beats | null): void {
    this.playheadBeat = scoreBeat;
    const host = this.host;
    const table = this.table;
    const doc = this.doc;
    if (!host || !table || !doc) return;
    if (scoreBeat === null) {
      this.playheadLine?.setAttribute('visibility', 'hidden');
      this.tint?.setAttribute('visibility', 'hidden');
      this.marker?.setAttribute('visibility', 'hidden');
      this.tintBar = null;
      this.markerBar = null;
      for (const b of this.barGroups.values()) this.setBarOpacity(b, 1);
      return;
    }
    const pt = host.layout.beatToPoint(scoreBeat);
    const osys = this.sysByIndex.get(pt.system);
    const lsys = host.layout.systems.find((s) => s.index === pt.system);
    if (!osys || !lsys) return;

    if (!this.playheadLine) this.playheadLine = el(doc, 'line', { class: 'sr-playhead', stroke: 'var(--text-muted)', 'stroke-width': 2, 'pointer-events': 'none' });
    const line = this.playheadLine;
    if (line.parentNode !== osys.overlay) osys.overlay.appendChild(line);
    line.setAttribute('visibility', 'visible');
    line.setAttribute('x1', num(pt.x));
    line.setAttribute('x2', num(pt.x));
    line.setAttribute('y1', num(lsys.staffTopY - 0.5 * lsys.lineSpacing));
    line.setAttribute('y2', num(lsys.staffTopY + 4.5 * lsys.lineSpacing));

    // Bar tint and next-bar marker (6.4 rule 6). Only while the beat lies inside the excerpt.
    const bi = barIndexOfBeat(table, scoreBeat);
    const inside = bi >= 0 && scoreBeat >= table.startBeat[bi]! && scoreBeat < table.endBeat[bi]!;
    if (!inside) {
      this.tint?.setAttribute('visibility', 'hidden');
      this.marker?.setAttribute('visibility', 'hidden');
      this.tintBar = null;
      this.markerBar = null;
    } else {
      const bar = table.bars[bi]!;
      if (this.tintBar !== bar) this.placeTint(bi);
      const frac = (scoreBeat - table.startBeat[bi]!) / (table.endBeat[bi]! - table.startBeat[bi]!);
      const nextBar = bi + 1 < table.bars.length && frac >= NEXT_BAR_MARKER_FROM ? table.bars[bi + 1]! : null;
      if (nextBar !== this.markerBar) this.placeMarker(nextBar === null ? -1 : bi + 1);
    }
    this.fadePast(table, pt.system, scoreBeat);
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
    if (!this.tint) this.tint = el(doc, 'rect', { class: 'sr-bar-tint', fill: 'var(--playhead-bar)', 'pointer-events': 'none' });
    const r = this.tint;
    if (r.parentNode !== osys.underlay) osys.underlay.appendChild(r);
    r.setAttribute('visibility', 'visible');
    r.setAttribute('data-bar', String(table.bars[bi]));
    r.setAttribute('x', num(start.x));
    r.setAttribute('width', num(Math.max(0, x1 - start.x)));
    r.setAttribute('y', num(lsys.staffTopY - sp));
    r.setAttribute('height', num(lsys.heightPx - SYSTEM_GAP_PX - (lsys.staffTopY - sp)));
    this.tintBar = table.bars[bi]!;
  }

  private placeMarker(bi: number): void {
    const marker = this.marker;
    if (bi < 0) {
      marker?.setAttribute('visibility', 'hidden');
      this.markerBar = null;
      return;
    }
    const host = this.host!;
    const table = this.table!;
    const start = host.layout.beatToPoint(table.startBeat[bi]!);
    const osys = this.sysByIndex.get(start.system);
    const lsys = host.layout.systems.find((s) => s.index === start.system);
    if (!osys || !lsys) return;
    const sp = lsys.lineSpacing;
    const m = marker ?? (this.marker = el(this.doc!, 'rect', { class: 'sr-next-bar', fill: 'var(--playhead-next)', 'pointer-events': 'none' }));
    if (m.parentNode !== osys.underlay) osys.underlay.appendChild(m);
    m.setAttribute('visibility', 'visible');
    m.setAttribute('data-bar', String(table.bars[bi]));
    m.setAttribute('x', num(start.x - 3));
    m.setAttribute('width', '3');
    m.setAttribute('y', num(lsys.staffTopY - sp));
    m.setAttribute('height', num(6 * sp));
    this.markerBar = table.bars[bi]!;
  }

  /** 6.4 rule 5: marks drop to 60% one beat past their bar and to 40% once the playhead has left their system. */
  private fadePast(table: BarTable, playSystem: number, beat: number): void {
    if (this.mode !== 'live') {
      for (const b of this.barGroups.values()) this.setBarOpacity(b, 1);
      return;
    }
    for (let i = 0; i < table.bars.length; i++) {
      const bg = this.barGroups.get(table.bars[i]!);
      if (!bg) continue;
      let o = 1;
      if (bg.system < playSystem) o = PAST_OPACITY.systemLeft;
      else if (beat >= table.endBeat[i]! + 1) o = PAST_OPACITY.oneBeatPast;
      this.setBarOpacity(bg, o);
    }
  }

  private setBarOpacity(b: BarGroup, o: number): void {
    if (b.opacity === o) return;
    b.opacity = o;
    if (o === 1) b.g.removeAttribute('opacity');
    else b.g.setAttribute('opacity', String(o));
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
  }
}
