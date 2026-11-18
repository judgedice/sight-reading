// ScoreView<HTMLElement> (01 §5.8): VexFlow static render, slots and page turns, and the overlay seam for P15.

import type { ScoreView } from '../core/api.ts';
import type {
  Beats,
  Clef,
  GhostNote,
  NoteVisualState,
  OverlayMode,
  PreparedExcerpt,
  RenderOptions,
  ScoreLayout,
  SpelledPitch,
} from '../core/types.ts';
import { TickMap, beatToTick } from './layout.ts';
import type { NotationOverlay, OverlayHost, OverlaySystem } from './overlay-seam.ts';
import { pitchY } from './pitch-geometry.ts';
import { STAFF_TOP_SP, renderExcerpt, type RenderedExcerpt } from './render-excerpt.ts';

/** Tie chains in event order, as `buildExpectedNotes` forms them (01 §6.4): one expected note per chain. */
export function expectedChains(p: PreparedExcerpt): { eventIds: string[]; bar: number }[] {
  const out: { eventIds: string[]; bar: number }[] = [];
  let cur: { eventIds: string[]; bar: number } | null = null;
  for (const m of p.measures) {
    for (const e of m.events) {
      if (e.kind === 'rest') {
        cur = null;
        continue;
      }
      if (cur && e.tieStop) {
        cur.eventIds.push(e.id);
      } else {
        cur = { eventIds: [e.id], bar: m.displayBar };
        out.push(cur);
      }
      if (!e.tieStart) cur = null;
    }
  }
  return out;
}

/** Process-wide count of VexFlow system renders (the render counter of 04 §5.4 and 05 Q6). */
let globalRenderCount = 0;
export function vexflowRenderCount(): number {
  return globalRenderCount;
}

const STATE_ATTRS = ['data-phase', 'data-timing', 'data-pitch', 'data-provisional', 'data-marginal', 'data-rejudged'] as const;

/** Write a NoteVisualState as data-* on a note group (04 §6: idempotent; absent fields remove the attribute). */
export function writeNoteState(g: Element, s: NoteVisualState): void {
  const values: Record<(typeof STATE_ATTRS)[number], string | undefined> = {
    'data-phase': s.phase,
    'data-timing': s.timing,
    'data-pitch': s.pitch,
    'data-provisional': s.provisional ? 'true' : undefined,
    'data-marginal': s.marginal ? 'true' : undefined,
    'data-rejudged': s.rejudged ? 'true' : undefined,
  };
  for (const a of STATE_ATTRS) {
    const v = values[a];
    if (v === undefined) g.removeAttribute(a);
    else if (g.getAttribute(a) !== v) g.setAttribute(a, v);
  }
}

export interface VexScoreViewOptions {
  /** P15's overlay. Without one, overlay calls are kept as state (ghosts, playhead, mode) and nothing is drawn. */
  overlay?: NotationOverlay;
}

interface Rendered {
  excerpt: PreparedExcerpt;
  out: RenderedExcerpt;
  layout: ScoreLayout;
  root: HTMLElement;
  offstage: HTMLElement;
  slots: HTMLElement[];
  slotToSystem: number[];
  groupsByExpected: SVGElement[][];
}

export class VexScoreView implements ScoreView<HTMLElement> {
  private readonly overlay: NotationOverlay | null;
  private r: Rendered | null = null;
  private mode: OverlayMode = 'live';
  private playhead: Beats | null = null;
  private readonly ghosts = new Map<number, GhostNote>();
  private readonly states = new Map<number, NoteVisualState>();
  /** VexFlow system renders by this view. Page turns, note states and overlay calls never add to it. */
  renderCount = 0;

  constructor(opts: VexScoreViewOptions = {}) {
    this.overlay = opts.overlay ?? null;
  }

  render(p: PreparedExcerpt, container: HTMLElement, o: RenderOptions): ScoreLayout {
    if (this.r) this.overlay?.detach();
    const out = renderExcerpt(p, o);
    this.renderCount += out.systems.length;
    globalRenderCount += out.systems.length;

    const doc = container.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'sr-score';
    const offstage = doc.createElement('div');
    offstage.className = 'sr-offstage';
    offstage.hidden = true;
    root.appendChild(offstage);
    container.replaceChildren(root);

    const layout = buildLayout(p, out);
    const chains = expectedChains(p);
    const groupsByExpected = chains.map((c, idx) => {
      const gs = c.eventIds.flatMap((id) => out.notes.get(id)?.groups ?? []);
      for (const g of gs) g.setAttribute('data-expected-idx', String(idx));
      return gs;
    });

    this.r = { excerpt: p, out, layout, root, offstage, slots: [], slotToSystem: [], groupsByExpected };
    this.states.clear();
    this.ghosts.clear();
    this.playhead = null;
    this.setSlotSystems(out.systems.map((s) => s.index));

    if (this.overlay) {
      const systems: OverlaySystem[] = out.systems.map((s) => ({
        index: s.index,
        svg: s.svg,
        underlay: s.underlay,
        overlay: s.overlay,
        firstBar: p.measures[s.firstMeasure]!.displayBar,
        lastBar: p.measures[s.lastMeasure]!.displayBar,
      }));
      const host: OverlayHost = {
        excerpt: p,
        layout,
        systems,
        noteGroups: (idx) => groupsByExpected[idx] ?? [],
        expectedEventIds: chains.map((c) => c.eventIds),
        expectedBar: chains.map((c) => c.bar),
      };
      this.overlay.attach(host);
      this.overlay.setMode(this.mode);
    }
    return layout;
  }

  /**
   * Place systems in slots: slot i shows system `slotToSystem[i]`. Systems in no slot stay in the DOM in a hidden
   * holder, so note states and overlay marks keep landing on them (04 §4.3: verdicts for a system already swapped
   * out are applied silently). Moves existing <svg> nodes only; VexFlow is never called.
   */
  setSlotSystems(slotToSystem: number[]): void {
    const r = this.requireRendered('setSlotSystems');
    const n = r.out.systems.length;
    const seen = new Set<number>();
    for (const s of slotToSystem) {
      if (!Number.isInteger(s) || s < 0 || s >= n) throw new RangeError(`no system ${s} (excerpt has ${n})`);
      if (seen.has(s)) throw new RangeError(`system ${s} is in two slots`);
      seen.add(s);
    }
    const doc = r.root.ownerDocument;
    while (r.slots.length < slotToSystem.length) {
      const slot = doc.createElement('div');
      slot.className = 'sr-slot';
      slot.setAttribute('data-slot', String(r.slots.length));
      r.root.insertBefore(slot, r.offstage);
      r.slots.push(slot);
    }
    while (r.slots.length > slotToSystem.length) r.slots.pop()!.remove();
    // Park systems that leave the slots first, then fill each slot.
    for (const sys of r.out.systems) if (!seen.has(sys.index) && sys.svg.parentNode !== r.offstage) r.offstage.appendChild(sys.svg);
    slotToSystem.forEach((s, i) => {
      const slot = r.slots[i]!;
      const svg = r.out.systems[s]!.svg;
      slot.setAttribute('data-system', String(s));
      if (svg.parentNode !== slot || slot.childNodes.length !== 1) slot.replaceChildren(svg);
    });
    r.slotToSystem = slotToSystem.slice();
  }

  /** The systems currently in the slots. */
  getSlotSystems(): number[] {
    return this.r ? this.r.slotToSystem.slice() : [];
  }

  setNoteState(expectedIdx: number, s: NoteVisualState): void {
    const r = this.r;
    if (!r) return;
    const groups = r.groupsByExpected[expectedIdx];
    if (!groups) return;
    this.states.set(expectedIdx, { ...s });
    for (const g of groups) writeNoteState(g, s);
    this.overlay?.noteState(expectedIdx, s);
  }

  showGhost(g: GhostNote): void {
    this.ghosts.set(g.detectedId, { ...g });
    this.overlay?.showGhost(g);
  }

  removeGhost(detectedId: number): void {
    this.ghosts.delete(detectedId);
    this.overlay?.removeGhost(detectedId);
  }

  setPlayhead(scoreBeat: Beats | null): void {
    this.playhead = scoreBeat;
    this.overlay?.setPlayhead(scoreBeat);
  }

  setMode(m: OverlayMode): void {
    this.mode = m;
    this.overlay?.setMode(m);
  }

  clearOverlay(): void {
    const r = this.r;
    if (r) for (const gs of r.groupsByExpected) for (const g of gs) for (const a of STATE_ATTRS) g.removeAttribute(a);
    this.states.clear();
    this.ghosts.clear();
    this.playhead = null;
    this.overlay?.clear();
  }

  /** Read-only view of what the overlay was told (for tests and for an overlay attached later). */
  snapshot(): { mode: OverlayMode; playhead: Beats | null; ghosts: GhostNote[]; states: Map<number, NoteVisualState> } {
    return { mode: this.mode, playhead: this.playhead, ghosts: [...this.ghosts.values()], states: new Map(this.states) };
  }

  /** False when the last render had to squeeze bars below the 14 sp minimum width (04 §4.2). */
  get fits(): boolean {
    return this.r?.out.fits ?? true;
  }

  /** The last layout, or null before the first render. */
  get layout(): ScoreLayout | null {
    return this.r?.layout ?? null;
  }

  private requireRendered(what: string): Rendered {
    if (!this.r) throw new Error(`${what} called before render()`);
    return this.r;
  }
}

/** Build the frozen ScoreLayout from a render (01 §5.8). */
export function buildLayout(p: PreparedExcerpt, out: RenderedExcerpt): ScoreLayout {
  const sp = out.spPx;
  const staffTopY = STAFF_TOP_SP * sp;
  const map = new TickMap(out.anchors, out.widthPx);
  const systems = out.systems.map((s) => ({
    index: s.index,
    firstBar: p.measures[s.firstMeasure]!.displayBar,
    lastBar: p.measures[s.lastMeasure]!.displayBar,
    heightPx: out.heightPx,
    staffTopY,
    lineSpacing: sp,
  }));
  const noteBoxes = new Map<string, { system: number; x: number; y: number; w: number; h: number }>();
  for (const [id, n] of out.notes) noteBoxes.set(id, { system: n.system, ...n.box });
  const n = systems.length;
  return {
    systems,
    noteBoxes,
    beatToPoint(scoreBeat: Beats): { system: number; x: number } {
      if (!Number.isFinite(scoreBeat)) throw new RangeError(`beatToPoint needs a finite beat, got ${scoreBeat}`);
      return map.at(beatToTick(scoreBeat, p.meter, p.pickupTicks));
    },
    staffY(system: number, pitch: SpelledPitch, clef: Clef): number {
      if (!Number.isInteger(system) || system < 0 || system >= n) throw new RangeError(`no system ${system} (excerpt has ${n})`);
      return pitchY(pitch, clef, staffTopY, sp);
    },
  };
}
