// ScoreFrame controller (04 §4.2 to §4.4, §7.5; 05 §7 items 3, 4, 6): owns the system SVGs through notation's
// ScoreView, places systems in slots, runs half-page turns from the playhead, draws system numbers and the wrap bar
// in a gutter beside the slots, and freezes the layout for a take (a resize then scales, never re-renders).
// Framework-free so the React wrapper, the e2e page and tests all drive the same code.

import type { ScoreView } from '../../core/api.ts';
import type { Beats, GhostNote, NoteVisualState, OverlayMode, PreparedExcerpt, ScoreLayout } from '../../core/types.ts';
import { CROSSFADE_MS, MAX_SLOTS, planLayout, planSwaps, systemHeightPx, type Insets, type LayoutPlan, type PagePlan } from '../layout-table.ts';
import { breakpoints, score, tokens } from '../tokens.ts';
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

/**
 * What the score is drawn for (06 section 7): staff space and page margins come from the `score` token group. Without
 * a purpose the frame keeps the 04 section 4.2 layout table (the e2e notation harness and older screens).
 */
export type FramePurpose = 'take' | 'read' | 'review';

/**
 * Fitting a purpose's staff space to the width: bars of at least this many staff spaces, plus the clef, key and time
 * signature. Looser than 04's 14 sp so the 06 phone take (11 sp, two bars a system at 390 px) holds; the renderer
 * shares the width equally when a system is tighter than its own minimum.
 */
const PURPOSE_MIN_BAR_SP = 10;
const SYSTEM_EXTRA_SP = 7;

/** Staff space and page margins for a purpose at a viewport width (06 section 7, design/tokens.json `score`). */
export function purposeGeometry(purpose: FramePurpose, viewportWidth: number): { spPx: number; marginBlock: number; marginInline: number } {
  const phone = viewportWidth <= breakpoints.phoneMax;
  const ss = score['staff-space'];
  const sp = { take: phone ? ss.takePhone : ss.takeDesktop, read: phone ? ss.readPhone : ss.readDesktop, review: phone ? ss.reviewPhone : ss.reviewDesktop }[purpose];
  const [block, inline] = score['page-margin'][phone || purpose === 'review' ? 'phone' : 'desktop'];
  return { spPx: sp, marginBlock: block!, marginInline: inline! };
}

/** The layout table's plan with the purpose's staff space, stepped down only as far as the bars need to fit the width. */
export function purposePlan(base: LayoutPlan, purpose: FramePurpose, viewportWidth: number, widthPx: number, heightPx: number): LayoutPlan {
  const g = purposeGeometry(purpose, viewportWidth);
  const maxBars = Math.max(1, ...base.barsPerSystem);
  const fit = widthPx / (maxBars * PURPOSE_MIN_BAR_SP + SYSTEM_EXTRA_SP);
  const spPx = Math.max(base.row.spMinPx, Math.floor(Math.min(g.spPx, fit) * 100) / 100);
  const sysH = systemHeightPx(spPx);
  const slots = heightPx > 0 ? Math.min(MAX_SLOTS, Math.max(1, Math.floor(heightPx / sysH))) : base.slots;
  return { ...base, spPx, systemHeightPx: sysH, slots, renderOptions: { ...base.renderOptions, spPx } };
}

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
  /** Staff space and margins from tokens for this purpose (06 section 7); omitted: the 04 layout table. */
  purpose?: FramePurpose;
  /** Height the frame can draw in, px (slot count with a purpose). */
  heightPx?: number;
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
    const table = planLayout(args.viewport, args.insets, p.measures.length, tickablesPerBar, args.widthPx);
    const base = args.purpose ? purposePlan(table, args.purpose, args.viewport.width, args.widthPx, args.heightPx ?? 0) : table;
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
    this.redrawDecor();
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
    if (this.clean) scoreBeat = null;
    this.playhead = scoreBeat;
    this.view.setPlayhead(scoreBeat);
    if (this.laid) this.applySlots(true);
  }

  setNoteState(expectedIdx: number, s: NoteVisualState): void {
    if (this.clean) return;
    this.view.setNoteState(expectedIdx, s);
  }

  showGhost(g: GhostNote): void {
    if (this.clean) return;
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
    for (const a of ['data-arrangement', 'data-turns', 'data-row', 'data-purpose', 'data-band', 'data-clean']) this.host.removeAttribute(a);
    this.bandEl = null;
    this.laid = null;
  }

  // ---- highlights, count-in band, clean score (06 sections 6.12, 7; 05 sections 8.8, 8.11) ----

  /**
   * Wash one bar (0-based measure index) for Listen and for a tapped bar; null clears it. Drawn behind the ink with the
   * playhead wash's geometry and colour. Independent of the playhead.
   */
  highlightBar(index: number | null): void {
    this.decor.bar = index;
    this.redrawDecor();
  }

  /** Brass wash behind the first system's key signature while the key chord plays; false clears it. */
  highlightKeySignature(on: boolean): void {
    this.decor.key = on;
    this.redrawDecor();
  }

  /** The first notehead in brass-ink on a brass disc with its name above (a copy or theory string); null clears it. */
  highlightFirstNote(name: string | null): void {
    this.decor.firstNote = name;
    this.redrawDecor();
  }

  /**
   * The count-in band (06 section 6.12): `slot` is the element to render the band into, placed in the paper's top
   * margin above the first system, never over its ink. While it is shown, systems after the first render at 50%.
   * Returns the slot, or null when nothing is laid out.
   */
  showBand(on: boolean): HTMLElement | null {
    this.decor.band = on;
    this.host.toggleAttribute('data-band', on);
    if (on) this.placeBand();
    return on ? this.band : null;
  }

  /** Re-measure the band after its content changed (its height decides whether the number drops to a smaller size). */
  refreshBand(): void {
    if (this.decor.band) this.placeBand();
  }

  /** The band's slot element (empty until `showBand(true)`). */
  get bandSlot(): HTMLElement {
    return this.band;
  }

  /**
   * Clean score: no marks at all (void results, "Clean score" in review). Overlay calls are ignored while it is on;
   * turning it off leaves the score clean until the caller sends marks again.
   */
  setClean(on: boolean): void {
    this.clean = on;
    this.host.toggleAttribute('data-clean', on);
    if (on) {
      this.view.clearOverlay();
      this.playhead = null;
      if (this.laid) this.applySlots(false);
    }
  }

  get isClean(): boolean {
    return this.clean;
  }

  /** The bar (0-based measure index) under a point in a system SVG, px in the SVG's own units; null off the score. */
  barAt(system: number, x: number): number | null {
    const l = this.laid;
    if (!l) return null;
    const bars = this.barsOf(l).filter((b) => b.system === system);
    if (bars.length === 0) return null;
    let hit = bars[0]!.index;
    for (const b of bars) if (b.x0 <= x) hit = b.index;
    return hit;
  }

  /** The bar under a client point, from a pointer event on the frame; null when the point is not on a system. */
  barAtClient(target: Element | null, clientX: number): number | null {
    // VexFlow gives its <svg> `pointer-events="none"`, so a tap on blank staff lands on the slot around it.
    const svg = target?.closest('svg.sr-system') ?? target?.closest('.sr-slot')?.querySelector('svg.sr-system') ?? null;
    if (!svg || !this.host.contains(svg)) return null;
    const r = svg.getBoundingClientRect();
    const w = Number(svg.getAttribute('width') ?? 0);
    if (!(r.width > 0) || !(w > 0)) return null;
    return this.barAt(Number(svg.getAttribute('data-system')), ((clientX - r.left) * w) / r.width);
  }

  private readonly decor: { bar: number | null; key: boolean; firstNote: string | null; band: boolean } = {
    bar: null,
    key: false,
    firstNote: null,
    band: false,
  };
  private clean = false;
  private recoloured: SVGElement[] = [];
  private bandEl: HTMLElement | null = null;

  private get band(): HTMLElement {
    if (!this.bandEl) {
      const b = this.host.ownerDocument.createElement('div');
      b.className = 'sf-band';
      this.bandEl = b;
    }
    if (this.bandEl.parentNode !== this.host) this.host.appendChild(this.bandEl);
    return this.bandEl;
  }

  /** Bars with their system and x range, from the measures and the layout. */
  private barsOf(l: Laid): { index: number; system: number; x0: number; x1: number }[] {
    const p = l.excerpt;
    const unit = p.meter.countUnitTicks;
    const lay = l.info.layout;
    const starts = p.measures.map((m) => (m.startTick - p.pickupTicks) / unit);
    return p.measures.map((m, i) => {
      const a = lay.beatToPoint(starts[i]!);
      const endBeat = i + 1 < starts.length ? starts[i + 1]! : starts[i]! + (m.isPickup ? p.pickupTicks / unit : p.meter.countsPerBar);
      const b = lay.beatToPoint(endBeat);
      const svg = this.systemSvg(a.system);
      const w = Number(svg?.getAttribute('width') ?? a.x);
      return { index: i, system: a.system, x0: a.x, x1: b.system === a.system && i + 1 < starts.length ? b.x : w };
    });
  }

  private systemSvg(system: number): SVGSVGElement | null {
    return this.score.querySelector<SVGSVGElement>(`svg.sr-system[data-system="${system}"]`);
  }

  private svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const e = this.host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', name);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
  }

  private underlay(system: number): SVGGElement | null {
    return this.systemSvg(system)?.querySelector<SVGGElement>('.sr-underlay') ?? null;
  }

  /** Remove and redraw every highlight (they live in the systems' underlays, so they move and scale with them). */
  private redrawDecor(): void {
    for (const e of Array.from(this.score.querySelectorAll('.sf-hl'))) e.remove();
    for (const g of this.recoloured) g.style.removeProperty('color');
    this.recoloured = [];
    const l = this.laid;
    if (!l) return;
    const lay = l.info.layout;
    const n = (v: number): string => String(Math.round(v * 100) / 100);
    const [above, inset] = score['playhead-pad-staff-spaces'];
    const laneBelow = 4 + score['lane-offset-staff-spaces'] + score['lane-glyph-size-staff-spaces'].live;

    if (this.decor.bar !== null) {
      const b = this.barsOf(l)[this.decor.bar];
      const sys = b ? lay.systems.find((s) => s.index === b.system) : undefined;
      const u = b ? this.underlay(b.system) : null;
      if (b && sys && u) {
        const sp = sys.lineSpacing;
        const top = sys.staffTopY - above! * sp;
        u.appendChild(
          this.svgEl('rect', {
            class: 'sf-hl sf-hl-bar',
            'data-bar-index': b.index,
            x: n(b.x0 + inset! * sp),
            y: n(top),
            width: n(Math.max(0, b.x1 - b.x0 - 2 * inset! * sp)),
            height: n(sys.staffTopY + laneBelow * sp - top),
            rx: n(0.5 * sp),
            fill: 'var(--playhead-bar)',
            stroke: 'none',
            'pointer-events': 'none',
          }),
        );
      }
    }

    const sys0 = lay.systems[0];
    if (this.decor.key && sys0) {
      const svg = this.systemSvg(sys0.index);
      const key = svg?.querySelector('.vf-keysignature');
      const r = key?.getBoundingClientRect();
      const sr = svg?.getBoundingClientRect();
      const w = Number(svg?.getAttribute('width') ?? 0);
      const u = this.underlay(sys0.index);
      if (r && sr && u && r.width > 0 && sr.width > 0) {
        const k = w / sr.width;
        const sp = sys0.lineSpacing;
        const x = (r.left - sr.left) * k - 0.4 * sp;
        u.appendChild(
          this.svgEl('rect', {
            class: 'sf-hl sf-hl-key',
            x: n(x),
            y: n(sys0.staffTopY - 1.2 * sp),
            width: n(r.width * k + 0.8 * sp),
            height: n(6.4 * sp),
            rx: n(0.5 * sp),
            fill: 'var(--brass-wash)',
            stroke: 'none',
            'pointer-events': 'none',
          }),
        );
      }
    }

    if (this.decor.firstNote !== null && sys0) {
      const first = l.excerpt.measures.flatMap((m) => m.events).find((e) => e.kind === 'note');
      const box = first ? lay.noteBoxes.get(first.id) : undefined;
      const u = box ? this.underlay(box.system) : null;
      const sys = box ? lay.systems.find((s) => s.index === box.system) : undefined;
      if (first && box && u && sys) {
        const sp = sys.lineSpacing;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const r = 1.6 * sp;
        u.appendChild(this.svgEl('circle', { class: 'sf-hl sf-hl-disc', cx: n(cx), cy: n(cy), r: n(r), fill: 'var(--brass-wash)', stroke: 'none', 'pointer-events': 'none' }));
        const stemUp = cy > sys.staffTopY + 2 * sp;
        const bottom = Math.min(cy - r - 0.3 * sp, stemUp ? cy - 3.8 * sp : Infinity);
        const t = this.svgEl('text', {
          class: 'sf-hl sf-hl-name',
          x: n(cx),
          y: n(bottom),
          'text-anchor': 'middle',
          fill: 'var(--brass-ink)',
          stroke: 'none',
        });
        t.textContent = this.decor.firstNote;
        // Above the ink, so it reads over a stem; the underlay would sit behind it.
        this.systemSvg(box.system)?.appendChild(t);
        for (const g of Array.from(this.score.querySelectorAll<SVGElement>(`[data-event-id="${first.id}"]`))) {
          g.style.color = 'var(--brass-ink)';
          this.recoloured.push(g);
        }
      }
    }
    if (this.decor.band) this.placeBand();
  }

  /**
   * Put the band's bottom 36 px (count-band-gap) above the first system's highest ink, ledger lines and stems
   * included. If the band is taller than the room there, its number drops to the phone size first.
   */
  private placeBand(): void {
    const l = this.laid;
    const band = this.band;
    if (!l) return;
    const lay = l.info.layout;
    const sys0 = lay.systems[0];
    if (!sys0) return;
    const sp = sys0.lineSpacing;
    let inkTop = sys0.staffTopY;
    for (const b of lay.noteBoxes.values()) {
      if (b.system !== sys0.index) continue;
      const cy = b.y + b.h / 2;
      const top = cy > sys0.staffTopY + 2 * sp ? cy - 3.5 * sp : b.y;
      inkTop = Math.min(inkTop, top);
    }
    const slot0 = this.score.querySelector<HTMLElement>('.sr-slot[data-system="0"]');
    const stageTop = this.stage.offsetTop + (slot0?.offsetTop ?? 0) * this.currentScale;
    const y = stageTop + inkTop * this.currentScale - tokens.component['count-band-gap'];
    band.style.setProperty('--sf-band-bottom', `${Math.round(y * 100) / 100}px`);
    band.style.setProperty('--sf-count-compact', `${tokens.type.count.phoneSize}px`);
    band.removeAttribute('data-compact');
    if (band.offsetHeight > 0 && band.offsetHeight > y) {
      band.setAttribute('data-compact', 'true');
      // Still taller than the room (a phone with every system on the page): the number shrinks to fit; the score
      // never moves for it.
      if (band.offsetHeight > y) {
        const size = Math.max(tokens.type.h1.size, Math.floor(y / tokens.component['count-line-height']));
        band.style.setProperty('--sf-count-compact', `${Math.min(tokens.type.count.phoneSize, size)}px`);
      }
    }
  }

  // ---- internals ----

  private setScale(s: number): void {
    this.currentScale = s;
    if (Math.abs(s - 1) < 1e-9) this.stage.style.removeProperty('transform');
    else this.stage.style.transform = `scale(${Math.round(s * 1e6) / 1e6})`;
    if (this.decor.band) this.placeBand();
  }

  /** Page margins for a purpose (06 section 7), as the frame's padding; null restores the default. */
  setMargins(purpose: FramePurpose | null, viewportWidth: number): void {
    if (!purpose) {
      this.host.removeAttribute('data-purpose');
      this.host.style.removeProperty('--sf-margin-block');
      this.host.style.removeProperty('--sf-margin-inline');
      return;
    }
    const g = purposeGeometry(purpose, viewportWidth);
    this.host.setAttribute('data-purpose', purpose);
    this.host.style.setProperty('--sf-margin-block', px(g.marginBlock));
    this.host.style.setProperty('--sf-margin-inline', px(g.marginInline));
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
