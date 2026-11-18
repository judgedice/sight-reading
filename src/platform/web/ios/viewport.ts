/**
 * iOS viewport, touch and frozen-layout controller (05 section 7, IOS6).
 *
 * Drives a score frame through a take: freezes it at count-in start, scales it on any later resize (Safari bars,
 * Stage Manager, rotation while performing; one CSS transform, no VexFlow render), and on a rotation during the
 * count-in re-lays it out once and asks the session to restart the count-in once (no penalty, 04 section 4.4).
 * Outside a take it re-lays out freely. The frame is a structural type so platform/ does not import ui/.
 */
import './viewport.css';

export interface Box {
  width: number;
  height: number;
}

export interface InsetsTB {
  top: number;
  bottom: number;
}

export interface Insets4 extends InsetsTB {
  right: number;
  left: number;
}

/** What the controller needs from ScoreFrameController. */
export interface FrozenFrameLike {
  readonly frozen: boolean;
  freeze(box: Box): void;
  unfreeze(): void;
  /** Scales while frozen; returns null when not frozen. */
  resize(box: Box): { scale: number; orientationChanged: boolean } | null;
  /** Re-lays out the same excerpt; throws while frozen. */
  relayout(args: { viewport: Box; insets: InsetsTB; widthPx: number }): unknown;
}

/** The window's current geometry, read by the host. */
export interface ViewportMeasure {
  /** Layout viewport (row selection). */
  viewport: Box;
  insets: InsetsTB;
  /** The frame's content box (what a frozen layout is scaled against). */
  box: Box;
}

export type TakePhase = 'idle' | 'countIn' | 'performing';

export type ResizeAction = 'relayout' | 'scale' | 'rotate-restart' | 'none';

export interface IosViewportDeps {
  frame: FrozenFrameLike;
  measure(): ViewportMeasure;
  /** Called once per rotation during the count-in, after the frame has been re-laid out and re-frozen. */
  onRestartCountIn?(): void;
  onResizeAction?(a: ResizeAction): void;
}

/** 05 section 7, acceptance viewports V1 to V7 (CSS px) with the injected safe-area insets. */
export interface IosViewport {
  id: string;
  name: string;
  width: number;
  height: number;
  insets: Insets4;
  device: 'iphone' | 'ipad';
  /** Home-screen (standalone) app rather than a Safari tab. */
  standalone: boolean;
}

const vp = (
  id: string,
  name: string,
  width: number,
  height: number,
  [top, right, bottom, left]: [number, number, number, number],
  device: IosViewport['device'],
  standalone: boolean,
): IosViewport => ({ id, name, width, height, insets: { top, right, bottom, left }, device, standalone });

export const IOS_VIEWPORTS: readonly IosViewport[] = [
  vp('V1', 'iPhone portrait, home-screen app', 390, 844, [47, 0, 34, 0], 'iphone', true),
  vp('V2', 'iPhone portrait, Safari tab', 390, 660, [0, 0, 0, 0], 'iphone', false),
  vp('V3', 'iPhone SE portrait, Safari tab', 375, 553, [0, 0, 0, 0], 'iphone', false),
  vp('V4', 'iPhone landscape, Safari tab', 844, 340, [0, 47, 21, 47], 'iphone', false),
  vp('V5', 'iPhone landscape, home-screen app', 844, 390, [0, 47, 21, 47], 'iphone', true),
  vp('V6', 'iPad landscape, Safari tab', 1180, 760, [0, 0, 0, 0], 'ipad', false),
  vp('V7', 'iPad portrait, home-screen app', 1024, 1366, [24, 0, 20, 0], 'ipad', true),
];

/** Minimum Stop target edge, CSS px (05 section 7 item 5). */
export const STOP_MIN_PX = 44;
/** Controls sit at least inset + this from any edge (item 2). */
export const EDGE_MARGIN_PX = 8;

/** Smallest distance from an edge a control may have given that edge's safe-area inset. */
export const minEdgeDistance = (inset: number): number => Math.max(0, inset) + EDGE_MARGIN_PX;

/** Inject safe-area insets the way Playwright does: the --test-sai-* variables that --sai-* falls back from. */
export function injectInsets(root: HTMLElement, i: Insets4): void {
  const s = root.style;
  s.setProperty('--test-sai-top', `${i.top}px`);
  s.setProperty('--test-sai-right', `${i.right}px`);
  s.setProperty('--test-sai-bottom', `${i.bottom}px`);
  s.setProperty('--test-sai-left', `${i.left}px`);
}

export function clearInjectedInsets(root: HTMLElement): void {
  for (const k of ['top', 'right', 'bottom', 'left']) root.style.removeProperty(`--test-sai-${k}`);
}

const sameBox = (a: Box, b: Box): boolean => a.width === b.width && a.height === b.height;

export class IosViewportController {
  private readonly deps: IosViewportDeps;
  private phase: TakePhase = 'idle';
  private lastIdle: { viewport: Box; insets: InsetsTB; box: Box } | null = null;
  private restarts = 0;

  constructor(deps: IosViewportDeps) {
    this.deps = deps;
  }

  get takePhase(): TakePhase {
    return this.phase;
  }

  /** Number of count-in restarts this controller has requested (a rotation during the count-in restarts it once). */
  get countInRestarts(): number {
    return this.restarts;
  }

  /**
   * Move through the take: idle -> countIn freezes the layout; countIn -> performing keeps it; any -> idle
   * unfreezes and re-lays out for whatever size the window now has.
   */
  setPhase(next: TakePhase): void {
    const prev = this.phase;
    if (next === prev) return;
    this.phase = next;
    const { frame } = this.deps;
    if (next === 'idle') {
      if (frame.frozen) frame.unfreeze();
      this.lastIdle = null;
      this.handleResize();
      return;
    }
    if (!frame.frozen) {
      const m = this.deps.measure();
      this.lastIdle = { viewport: m.viewport, insets: m.insets, box: m.box };
      frame.freeze(m.box);
    }
  }

  /** Call on window resize, visualViewport resize and frame ResizeObserver; safe to call repeatedly. */
  handleResize(): ResizeAction {
    const { frame } = this.deps;
    const m = this.deps.measure();
    let action: ResizeAction = 'none';
    if (this.phase === 'idle' || !frame.frozen) {
      const prev = this.lastIdle;
      if (prev && sameBox(prev.viewport, m.viewport) && sameBox(prev.box, m.box) && prev.insets.top === m.insets.top && prev.insets.bottom === m.insets.bottom) {
        action = 'none';
      } else {
        frame.relayout({ viewport: m.viewport, insets: m.insets, widthPx: m.box.width });
        this.lastIdle = { viewport: m.viewport, insets: m.insets, box: m.box };
        action = 'relayout';
      }
    } else {
      const r = frame.resize(m.box);
      if (this.phase === 'countIn' && r?.orientationChanged) {
        // A rotation during the count-in: no take exists yet, so lay out afresh, refreeze at the new size and
        // restart the count-in once. Later resize events of the same rotation see the new frozen box and only scale.
        frame.unfreeze();
        frame.relayout({ viewport: m.viewport, insets: m.insets, widthPx: m.box.width });
        frame.freeze(m.box);
        this.restarts++;
        action = 'rotate-restart';
        this.deps.onRestartCountIn?.();
      } else {
        action = 'scale';
      }
    }
    this.deps.onResizeAction?.(action);
    return action;
  }

  /** Listen to window and visualViewport resizes and orientation changes, coalesced to one call per frame. */
  attach(win: Window): () => void {
    let queued = false;
    const run = (): void => {
      queued = false;
      this.handleResize();
    };
    const onEvent = (): void => {
      if (queued) return;
      queued = true;
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
      else run();
    };
    win.addEventListener('resize', onEvent);
    win.addEventListener('orientationchange', onEvent);
    win.visualViewport?.addEventListener('resize', onEvent);
    return () => {
      win.removeEventListener('resize', onEvent);
      win.removeEventListener('orientationchange', onEvent);
      win.visualViewport?.removeEventListener('resize', onEvent);
    };
  }
}
