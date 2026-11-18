// What the score frame needs from notation/, as structural types. ui/ may import only core/ (01 §4.2), so the app
// hands the frame a loader: `loadNotation={() => import('../notation/index.ts').then(bindNotation)}`. Keeping the
// import in the app also keeps notation in its own lazy chunk (PLAN ruling 39).

import type { ScoreView } from '../../core/api.ts';
import type { Beats, GhostNote, NoteVisualState, OverlayMode, PreparedExcerpt, ScoreLayout } from '../../core/types.ts';

/** The overlay's look depends on these; they are read at draw time, so a settings change needs no re-render. */
export interface FrameViewOptions {
  reducedMotion: () => boolean;
  highContrast: () => boolean;
}

/** notation's VexScoreView as the frame uses it. */
export interface FrameScoreView extends ScoreView<HTMLElement> {
  getSlotSystems(): number[];
  /** VexFlow system renders by this view (04 §5.4: zero during a take). */
  readonly renderCount: number;
  readonly layout: ScoreLayout | null;
  snapshot(): { mode: OverlayMode; playhead: Beats | null; ghosts: GhostNote[]; states: Map<number, NoteVisualState> };
}

/** What the frame calls. */
export interface FrameNotation {
  createView(o: FrameViewOptions): FrameScoreView;
  tickablesPerBar(p: PreparedExcerpt): number[];
  ensureNotationFonts(): Promise<void>;
}

/** The shape of `src/notation/index.ts` the binding reads (VexScoreView with P15's SvgOverlay). */
export interface NotationModuleLike<O> {
  VexScoreView: new (opts: { overlay: O }) => FrameScoreView;
  SvgOverlay: new (opts: FrameViewOptions) => O;
  tickablesPerBar(p: PreparedExcerpt): number[];
  ensureNotationFonts(): Promise<void>;
}

/** Adapt the notation module to the frame: every view gets an SvgOverlay with the frame's getters. */
export function bindNotation<O>(m: NotationModuleLike<O>): FrameNotation {
  return {
    createView: (o) => new m.VexScoreView({ overlay: new m.SvgOverlay(o) }),
    tickablesPerBar: (p) => m.tickablesPerBar(p),
    ensureNotationFonts: () => m.ensureNotationFonts(),
  };
}

/** Default getters: the appearance attributes the app writes on <html> (src/app/appearance.tsx). */
export function documentAppearance(doc: Document): FrameViewOptions {
  const root = doc.documentElement;
  return {
    reducedMotion: () => {
      const m = root.getAttribute('data-motion');
      if (m === 'reduced') return true;
      if (m === 'full') return false;
      const view = doc.defaultView;
      return typeof view?.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    highContrast: () => root.getAttribute('data-contrast') === 'high',
  };
}
