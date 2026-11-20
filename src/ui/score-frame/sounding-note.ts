// The sounding note (round 2, Listen playback review): while Listen, Listen first, Hear bars or Hear what we heard
// plays, the written note that is sounding glows: a soft brass disc behind its notehead and the head in brass ink (the
// design tokens' brass, never the green, red or purple of the marks). It moves note by note with what is heard, read
// from the audio clock as heard (`clock`, the backend's `audibleNow`, so the output latency is taken off, as the
// calibration marks are); a rest shows nothing. In the scrolling arrangement (phones) the line that sounds is scrolled
// into view at a system change. Under reduced motion it steps without animation.
//
// This is its own layer, separate from the playhead, the beat line and the bar wash: it draws only `.sf-sounding`
// elements in the systems' underlays and recolours only the noteheads it lights, and it reads the frame through public
// members (`info`, `arrangement`) and the rendered SVGs. One `requestAnimationFrame` loop per playback; the DOM is
// touched only when the sounding note changes, never by a React render.
import type { FrameLayoutInfo } from './controller.ts';
import './sounding-note.css';

/** One written note of a playback: its event ids (a tie chain) and the clock times it sounds from and to. */
export interface SoundingSpan {
  /** The expected note's index (tests and tools read it from the frame's `data-sounding-note`). */
  idx?: number;
  eventIds: readonly string[];
  startsAt: number;
  endsAt: number;
}

/** A playback's notes and the clock (backend seconds of what is heard now) to follow them by. */
export interface SoundingSource {
  /** In start order. */
  spans: readonly SoundingSpan[];
  clock: () => number;
}

/** Radius of the disc behind a notehead, staff spaces. */
export const SOUNDING_DISC_SP = 1.45;
/** Its outline, staff spaces. */
export const SOUNDING_STROKE_SP = 0.1;

/**
 * The span sounding at `t`, or -1 (before the first, in a gap or rest, after the last). `hint` is the last answer:
 * playback moves forward, so the search starts there and is O(1) per frame.
 */
export function spanAt(spans: readonly Pick<SoundingSpan, 'startsAt' | 'endsAt'>[], t: number, hint = -1): number {
  const n = spans.length;
  if (n === 0 || !Number.isFinite(t)) return -1;
  let i = hint >= 0 && hint < n && (spans[hint] as SoundingSpan).startsAt <= t ? hint : 0;
  // The latest span that has started by t.
  while (i + 1 < n && (spans[i + 1] as SoundingSpan).startsAt <= t) i++;
  const s = spans[i] as SoundingSpan;
  return s.startsAt <= t && t < s.endsAt ? i : -1;
}

/** What the driver needs from a window: an animation frame loop. */
export interface FrameLoop {
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(h: number): void;
}

/**
 * Follows a source's clock once per animation frame and reports each change of the sounding span (its index, or -1
 * for none). Stops by itself after the last span ends.
 */
export class SoundingNoteDriver {
  private handle: number | null = null;
  private current = -1;
  private hint = -1;
  private stopped = false;

  constructor(
    private readonly source: SoundingSource,
    private readonly loop: FrameLoop,
    private readonly onChange: (index: number) => void,
  ) {}

  /** The span lit now (-1 for none). */
  get index(): number {
    return this.current;
  }

  start(): void {
    this.stopped = false;
    this.tick();
  }

  /** One step: read the clock, report a change. Public for tests that drive the clock by hand. */
  tick(): void {
    if (this.stopped) return;
    const t = this.source.clock();
    const i = spanAt(this.source.spans, t, this.hint);
    if (i >= 0) this.hint = i;
    if (i !== this.current) {
      this.current = i;
      this.onChange(i);
    }
    const last = this.source.spans[this.source.spans.length - 1];
    if (!last || t >= last.endsAt) {
      this.handle = null;
      return;
    }
    this.handle = this.loop.requestAnimationFrame(() => this.tick());
  }

  /** Stops following; the caller clears the highlight. */
  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.loop.cancelAnimationFrame(this.handle);
    this.handle = null;
    if (this.current !== -1) {
      this.current = -1;
      this.onChange(-1);
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/** What the layer reads of the frame: its layout and arrangement (public members of `ScoreFrameController`). */
export interface SoundingFrame {
  readonly info: FrameLayoutInfo | null;
  readonly arrangement: 'slots' | 'all';
}

export interface SoundingShowOptions {
  /** Fade the disc in (off under reduced motion: it steps). */
  animate: boolean;
  /** Scroll the system into view when it is not fully on screen (the scrolling arrangement only). */
  follow: boolean;
}

/** Draws and clears the sounding-note highlight in a frame's system SVGs. */
export class SoundingNoteLayer {
  private drawn: Element[] = [];
  private recoloured: SVGElement[] = [];
  private system: number | null = null;

  constructor(
    private readonly frame: SoundingFrame,
    private readonly host: HTMLElement,
  ) {}

  /** Lights one written note (its tie chain's event ids); null clears. */
  show(note: Pick<SoundingSpan, 'idx' | 'eventIds'> | null, o: SoundingShowOptions): void {
    this.clear(false);
    const lay = this.frame.info?.layout;
    const eventIds = note?.eventIds ?? [];
    if (eventIds.length === 0 || !lay) return;
    let firstSystem: number | null = null;
    for (const id of eventIds) {
      const box = lay.noteBoxes.get(id);
      if (!box) continue;
      const svg = this.host.querySelector<SVGSVGElement>(`svg.sr-system[data-system="${box.system}"]`);
      const parent = svg?.querySelector<SVGGElement>(':scope > g.sr-underlay') ?? svg;
      if (!svg || !parent) continue;
      const sys = lay.systems.find((s) => s.index === box.system);
      const sp = sys?.lineSpacing ?? box.h;
      const disc = this.host.ownerDocument.createElementNS(SVG_NS, 'circle');
      disc.setAttribute('class', o.animate ? 'sf-sounding sf-sounding-in' : 'sf-sounding');
      disc.setAttribute('data-sounding-event', id);
      disc.setAttribute('cx', n2(box.x + box.w / 2));
      disc.setAttribute('cy', n2(box.y + box.h / 2));
      disc.setAttribute('r', n2(SOUNDING_DISC_SP * sp));
      disc.setAttribute('fill', 'var(--brass-wash)');
      disc.setAttribute('stroke', 'var(--brass)');
      disc.setAttribute('stroke-width', n2(SOUNDING_STROKE_SP * sp));
      disc.setAttribute('pointer-events', 'none');
      disc.setAttribute('aria-hidden', 'true');
      parent.appendChild(disc);
      this.drawn.push(disc);
      for (const g of Array.from(svg.querySelectorAll<SVGElement>(`[data-event-id="${id}"]`))) {
        g.style.color = 'var(--brass-ink)';
        g.setAttribute('data-sounding', 'true');
        this.recoloured.push(g);
      }
      firstSystem ??= box.system;
    }
    if (this.drawn.length > 0) this.host.setAttribute('data-sounding-note', note?.idx !== undefined ? String(note.idx) : eventIds.join(' '));
    if (firstSystem !== null && firstSystem !== this.system) {
      this.system = firstSystem;
      if (o.follow) this.follow(firstSystem, o.animate);
    }
  }

  /** Removes the highlight. `forget` also forgets the system last shown (a new playback). */
  clear(forget = true): void {
    for (const e of this.drawn) e.remove();
    for (const g of this.recoloured) {
      g.style.removeProperty('color');
      g.removeAttribute('data-sounding');
    }
    this.drawn = [];
    this.recoloured = [];
    this.host.removeAttribute('data-sounding-note');
    if (forget) this.system = null;
  }

  /** Brings a system fully into view in the scrolling arrangement (the page or line follows on phones). */
  private follow(system: number, smooth: boolean): void {
    if (this.frame.arrangement !== 'all') return;
    const svg = this.host.querySelector<SVGSVGElement>(`svg.sr-system[data-system="${system}"]`);
    const win = this.host.ownerDocument.defaultView;
    if (!svg || !win || typeof svg.scrollIntoView !== 'function') return;
    const r = svg.getBoundingClientRect();
    const h = win.innerHeight;
    if (r.height === 0 || (r.top >= 0 && r.bottom <= h)) return;
    svg.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }
}
