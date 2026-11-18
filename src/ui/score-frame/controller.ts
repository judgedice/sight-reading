// ScoreFrame controller (04 §4.2 to §4.4, §7.5; 05 §7 items 3, 4, 6): owns the system SVGs through notation's
// ScoreView, places systems in slots, runs half-page turns from the playhead, draws system numbers and the wrap bar
// in a gutter beside the slots, and freezes the layout for a take (a resize then scales, never re-renders).
// Framework-free so the React wrapper, the e2e page and tests all drive the same code.

import type { ScoreView } from '../../core/api.ts';
import type { Beats, GhostNote, NoteVisualState, OverlayMode, PreparedExcerpt, ScoreLayout } from '../../core/types.ts';
import { CROSSFADE_MS, planLayout, planSwaps, type Insets, type LayoutPlan, type PagePlan } from '../layout-table.ts';
import { documentAppearance, type FrameNotation, type FrameScoreView, type FrameViewOptions } from './notation-binding.ts';
import {
  frozenScale,
  orientationChanged,
  slotsAtBeat,
  systemAtBeat,
  systemDurationsMs,
  systemSpans,
  timeSwaps,
  wrapSlot,
  type SystemSpan,
  type TimedSwap,
} from './turns.ts';

/** Width of the system-number gutter while page turns are active (12 px caption, 04 §4.3 rule 5). */
export const GUTTER_PX = 24;

/** 'slots': the take's fixed slots with page turns. 'all': every system in reading order (scan and review on phones). */
export type Arrangement = 'slots' | 'all';

export interface Box {
  width: number;
  height: number;
}

export interface FrameLayoutArgs {
  /** The window's layout viewport (row selection and slot count, 04 §4.2, §4.3). */
  viewport: Box;
  /** Safe-area insets, px. */
  insets: Insets;
  /** Width the frame can draw in, px (the gutter is taken out of it when pages turn). */
  widthPx: number;
  /** Take tempo, metronome beats per minute (page-turn timing). */
  bpm: number;
}

export interface FrameLayoutInfo {
  plan: LayoutPlan;
  pages: PagePlan;
  spans: SystemSpan[];
  layout: ScoreLayout;
  systemCount: number;
  /** Width the systems were drawn at. */
  scoreWidthPx: number;
  /** Total height of the slots, px (v slots, or every system when nothing turns). */
  slotsHeightPx: number;
}

export interface FrozenResize {
  scale: number;
  /** Portrait and landscape swapped (a rotation; 04 §4.4 cancels a count-in on it). */
  orientationChanged: boolean;
}

export interface ScoreFrameOptions {
  appearance?: Partial<FrameViewOptions>;
  /** Called whenever the systems in the slots change (toolbar "Lines 2–6 of 6", 04 §4.3 rule 6). */
  onSlotsChange?: (slotSystems: number[], systemCount: number) => void;
}

interface Laid {
  excerpt: PreparedExcerpt;
  args: FrameLayoutArgs;
  tickables: readonly number[] | undefined;
  info: FrameLayoutInfo;
  swaps: TimedSwap[];
}

const px = (n: number): string => `${Math.round(n * 1000) / 1000}px`;

/** The host's content box (client box less padding). */
export function contentBox(el: HTMLElement): Box {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  const num = (v: string | undefined): number => (v ? parseFloat(v) || 0 : 0);
  return {
    width: Math.max(0, el.clientWidth - num(cs?.paddingLeft) - num(cs?.paddingRight)),
    height: Math.max(0, el.clientHeight - num(cs?.paddingTop) - num(cs?.paddingBottom)),
  };
}

/** Resolved `--sai-top` / `--sai-bottom` (04 §4.1: env() through variables so tests can inject them). */
export function readInsets(el: HTMLElement): Insets {
  const doc = el.ownerDocument;
  const probe = doc.createElement('div');
  probe.className = 'sf-inset-probe';
  probe.setAttribute('aria-hidden', 'true');
  el.appendChild(probe);
  const cs = doc.defaultView?.getComputedStyle(probe);
  const top = parseFloat(cs?.paddingTop ?? '') || 0;
  const bottom = parseFloat(cs?.paddingBottom ?? '') || 0;
  probe.remove();
  return { top, bottom };
}

export class ScoreFrameController implements Omit<ScoreView<HTMLElement>, 'render' | 'setSlotSystems'> {
  readonly view: FrameScoreView;
  private readonly host: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly score: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly appearance: FrameViewOptions;
  private readonly onSlotsChange: ((slotSystems: number[], systemCount: number) => void) | undefined;
  private laid: Laid | null = null;
  private mode: Arrangement = 'slots';
  private playhead: Beats | null = null;
  private frozenBox: Box | null = null;
  private currentScale = 1;
  private readonly fading = new Set<{ cancel(): void }>();

  constructor(host: HTMLElement, notation: FrameNotation, opts: ScoreFrameOptions = {}) {
    this.host = host;
    const doc = host.ownerDocument;
    const defaults = documentAppearance(doc);
    this.appearance = {
      reducedMotion: opts.appearance?.reducedMotion ?? defaults.reducedMotion,
      highContrast: opts.appearance?.highContrast ?? defaults.highContrast,
    };
    this.onSlotsChange = opts.onSlotsChange;
    this.view = notation.createView(this.appearance);

    host.classList.add('sf-frame');
    host.setAttribute('data-arrangement', this.mode);
    this.stage = doc.createElement('div');
    this.stage.className = 'sf-stage';
    this.gutter = doc.createElement('div');
    this.gutter.className = 'sf-gutter';
    this.gutter.setAttribute('aria-hidden', 'true');
    this.score = doc.createElement('div');
    this.score.className = 'sf-score';
    this.fade = doc.createElement('div');
    this.fade.className = 'sf-fade';
    this.fade.setAttribute('aria-hidden', 'true');
    this.stage.append(this.gutter, this.score, this.fade);
    host.replaceChildren(this.stage);
  }

  /**
   * Lay out and render an excerpt (at reveal, 04 §4.4). Never during a take: throws while frozen.
   * Starts in the initial slots of the current arrangement with no playhead.
   */
  layout(p: PreparedExcerpt, args: FrameLayoutArgs, tickablesPerBar?: readonly number[]): FrameLayoutInfo {
    if (this.frozenBox) throw new Error('ScoreFrame: layout() during a take (the layout is frozen)');
    const base = planLayout(args.viewport, args.insets, p.measures.length, tickablesPerBar, args.widthPx);
    const systemCount = base.barsPerSystem.length;
    const turns = systemCount > base.slots;
    const scoreWidthPx = Math.max(1, Math.floor(args.widthPx - (turns ? GUTTER_PX : 0)));
    const plan: LayoutPlan = { ...base, renderOptions: { ...base.renderOptions, widthPx: scoreWidthPx } };
    const spans = systemSpans(p, plan.barsPerSystem);
    const pages = planSwaps(systemCount, plan.slots, systemDurationsMs(spans, args.bpm));
    this.cancelFades();
    const layout = this.view.render(p, this.score, plan.renderOptions);
    const info: FrameLayoutInfo = {
      plan,
      pages,
      spans,
      layout,
      systemCount,
      scoreWidthPx,
      slotsHeightPx: Math.min(systemCount, plan.slots) * plan.systemHeightPx,
    };
    this.laid = { excerpt: p, args, tickables: tickablesPerBar, info, swaps: timeSwaps(pages, spans, args.bpm) };
    this.playhead = null;
    this.setScale(1);

    const sp = plan.spPx;
    const staffMid = (layout.systems[0]?.staffTopY ?? 4 * sp) + 2 * sp;
    this.stage.style.setProperty('--sf-system-h', px(plan.systemHeightPx));
    this.stage.style.setProperty('--sf-gutter', px(turns ? GUTTER_PX : 0));
    this.stage.style.setProperty('--sf-score-w', px(scoreWidthPx));
    this.stage.style.setProperty('--sf-slots-h', px(info.slotsHeightPx));
    this.stage.style.setProperty('--sf-caption-top', px(staffMid));
    this.host.setAttribute('data-turns', String(turns));
    this.host.setAttribute('data-row', plan.row.id);
    this.applySlots(false);
    return info;
  }

  /**
   * Re-lay out the same excerpt for a new size (scan and results re-lay out freely, 04 §4.4), keeping the overlay
   * state (mode, note states, ghosts, playhead). Throws while frozen.
   */
  relayout(args: Partial<FrameLayoutArgs>): FrameLayoutInfo | null {
    const l = this.laid;
    if (!l) return null;
    const keep = this.view.snapshot();
    const playhead = this.playhead;
    const info = this.layout(l.excerpt, { ...l.args, ...args }, l.tickables);
    this.view.setMode(keep.mode);
    for (const [idx, s] of keep.states) this.view.setNoteState(idx, s);
    for (const g of keep.ghosts) this.view.showGhost(g);
    this.setPlayhead(playhead);
    return info;
  }

  get info(): FrameLayoutInfo | null {
    return this.laid?.info ?? null;
  }

  get arrangement(): Arrangement {
    return this.mode;
  }

  /** Switch between slots and the natural-order scroll. Instant (it happens at count-in start or after the take). */
  setArrangement(a: Arrangement): void {
    if (a === this.mode) return;
    this.mode = a;
    this.host.setAttribute('data-arrangement', a);
    if (this.laid) this.applySlots(false);
  }

  /** The systems in the slots, top to bottom. */
  slotSystems(): number[] {
    return this.view.getSlotSystems();
  }

  /** The playhead drives the bar tint (overlay) and the page turns (4.3); null clears it and resets the slots. */
  setPlayhead(scoreBeat: Beats | null): void {
    this.playhead = scoreBeat;
    this.view.setPlayhead(scoreBeat);
    if (this.laid) this.applySlots(true);
  }

  setNoteState(expectedIdx: number, s: NoteVisualState): void {
    this.view.setNoteState(expectedIdx, s);
  }

  showGhost(g: GhostNote): void {
    this.view.showGhost(g);
  }

  removeGhost(detectedId: number): void {
    this.view.removeGhost(detectedId);
  }

  setMode(m: OverlayMode): void {
    this.view.setMode(m);
  }

  clearOverlay(): void {
    this.view.clearOverlay();
    this.playhead = null;
    if (this.laid) this.applySlots(false);
  }

  /**
   * Freeze the layout for the take (count-in start, 04 §4.4): records the frame's box, so later resizes scale it, and
   * turns on the take's touch rules (05 §7 item 4). Resets the slots to 1..v.
   */
  freeze(box: Box = contentBox(this.host)): void {
    this.frozenBox = { ...box };
    this.host.setAttribute('data-frozen', 'true');
    this.host.ownerDocument.documentElement.setAttribute('data-score-frozen', 'true');
    this.setArrangement('slots');
    this.setScale(1);
  }

  /** End of take: resizes re-lay out again; the scale stays until the next layout. */
  unfreeze(): void {
    this.frozenBox = null;
    this.host.removeAttribute('data-frozen');
    this.host.ownerDocument.documentElement.removeAttribute('data-score-frozen');
  }

  get frozen(): boolean {
    return this.frozenBox !== null;
  }

  get scale(): number {
    return this.currentScale;
  }

  /**
   * A resize while frozen: one CSS transform, `scale(min(newW / oldW, newH / oldH))`, origin top left (04 §4.4).
   * Overlay groups live inside each system SVG and scale with it. Returns null when not frozen (the caller re-lays
   * out instead).
   */
  resize(box: Box): FrozenResize | null {
    if (!this.frozenBox) return null;
    const scale = frozenScale(this.frozenBox, box);
    this.setScale(scale);
    return { scale, orientationChanged: orientationChanged(this.frozenBox, box) };
  }

  /** Scale outside a take, e.g. the scan's STARS panel on lg/xl (04 §5.3: performance geometry, scaled down). */
  scaleTo(scale: number): void {
    this.setScale(scale > 0 && Number.isFinite(scale) ? scale : 1);
  }

  destroy(): void {
    this.cancelFades();
    this.unfreeze();
    this.host.replaceChildren();
    this.host.classList.remove('sf-frame');
    for (const a of ['data-arrangement', 'data-turns', 'data-row']) this.host.removeAttribute(a);
    this.laid = null;
  }

  // ---- internals ----

  private setScale(s: number): void {
    this.currentScale = s;
    if (Math.abs(s - 1) < 1e-9) this.stage.style.removeProperty('transform');
    else this.stage.style.transform = `scale(${Math.round(s * 1e6) / 1e6})`;
  }

  private targetSlots(): number[] {
    const l = this.laid!;
    if (this.mode === 'all') return l.info.layout.systems.map((s) => s.index);
    return slotsAtBeat(l.info.pages, l.swaps, this.playhead);
  }

  private applySlots(animate: boolean): void {
    const l = this.laid!;
    const next = this.targetSlots();
    const prev = this.view.getSlotSystems();
    const same = prev.length === next.length && prev.every((s, i) => s === next[i]);
    if (!same) {
      const changed = animate && prev.length === next.length ? next.map((_, i) => i).filter((i) => prev[i] !== next[i]) : [];
      const clones = this.canFade() ? changed.map((i) => this.cloneSlot(i)) : [];
      this.view.setSlotSystems(next);
      clones.forEach((c, k) => c && this.crossfade(changed[k]!, c));
    }
    this.renderGutter(next);
    if (!same) this.onSlotsChange?.(next.slice(), l.info.systemCount);
  }

  private renderGutter(slotSystems: readonly number[]): void {
    const l = this.laid!;
    const doc = this.host.ownerDocument;
    const show = l.info.pages.turns;
    while (this.gutter.children.length < slotSystems.length) {
      const cell = doc.createElement('div');
      cell.className = 'sf-line';
      cell.setAttribute('data-slot', String(this.gutter.children.length));
      this.gutter.appendChild(cell);
    }
    while (this.gutter.children.length > slotSystems.length) this.gutter.lastElementChild!.remove();
    const current = this.playhead === null || this.mode === 'all' ? null : systemAtBeat(l.info.spans, this.playhead);
    const wrap = current === null ? null : wrapSlot(slotSystems, current);
    slotSystems.forEach((s, i) => {
      const cell = this.gutter.children[i] as HTMLElement;
      // The number is drawn by CSS from data-line, so the frame holds no text node during a take (04 §6.7 item 4).
      if (show) cell.setAttribute('data-line', String(s + 1));
      else cell.removeAttribute('data-line');
      cell.setAttribute('data-system', String(s));
      if (wrap === i) cell.setAttribute('data-wrap', 'true');
      else cell.removeAttribute('data-wrap');
    });
  }

  private canFade(): boolean {
    if (this.appearance.reducedMotion()) return false;
    const proto = this.host.ownerDocument.defaultView?.Element?.prototype as { animate?: unknown } | undefined;
    return typeof proto?.animate === 'function';
  }

  private slotEl(i: number): HTMLElement | null {
    return this.score.querySelector<HTMLElement>(`.sr-slot[data-slot="${i}"]`);
  }

  /** A static copy of slot i (outgoing system) for the crossfade; ids are dropped so nothing resolves to it. */
  private cloneSlot(i: number): HTMLElement | null {
    const slot = this.slotEl(i);
    if (!slot) return null;
    const c = slot.cloneNode(true) as HTMLElement;
    c.classList.add('sf-fade-out');
    c.removeAttribute('data-slot');
    for (const n of [c, ...Array.from(c.querySelectorAll('[id]'))]) n.removeAttribute('id');
    return c;
  }

  /** 160 ms crossfade of the one replaced slot (04 §4.3 rule 4); the rest of the page never moves. */
  private crossfade(slotIdx: number, outgoing: HTMLElement): void {
    const l = this.laid!;
    const slot = this.slotEl(slotIdx);
    outgoing.style.top = px(slotIdx * l.info.plan.systemHeightPx);
    this.fade.appendChild(outgoing);
    const timing = { duration: CROSSFADE_MS, easing: 'linear' };
    const out = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    const inn = slot?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const entry = {
      cancel: () => {
        out.cancel();
        inn?.cancel();
        outgoing.remove();
        this.fading.delete(entry);
      },
    };
    this.fading.add(entry);
    out.onfinish = () => entry.cancel();
  }

  private cancelFades(): void {
    for (const f of [...this.fading]) f.cancel();
    this.fade.replaceChildren();
  }
}
