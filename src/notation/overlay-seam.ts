// The seam between the static render (P7) and the overlay (P15).
//
// P7 owns the VexFlow ink and the ScoreLayout. P15 implements `NotationOverlay` and is handed an `OverlayHost`
// after every render(). The ScoreView forwards each overlay call to it, after writing the note's data-* state
// (01 §5.8: setNoteState is written as data-* on the note <g>, which P7 does itself so it holds with or without
// an overlay). Nothing here ever re-renders VexFlow.

import type { Beats, GhostNote, NoteVisualState, OverlayMode, PreparedExcerpt, ScoreLayout } from '../core/types.ts';

/** One rendered system as the overlay sees it. Coordinates inside every group are px within the system SVG. */
export interface OverlaySystem {
  index: number;
  svg: SVGSVGElement;
  /** Behind the ink (bar tint, heat strip). */
  underlay: SVGGElement;
  /** Above the ink (ghosts, lane glyphs, rings). */
  overlay: SVGGElement;
  /** Displayed bar numbers in this system (pickup = 0). */
  firstBar: number;
  lastBar: number;
}

export interface OverlayHost {
  excerpt: PreparedExcerpt;
  layout: ScoreLayout;
  systems: readonly OverlaySystem[];
  /** The drawn note <g> elements (tied pieces included) of an expected note. Empty for an unknown index. */
  noteGroups(expectedIdx: number): readonly SVGElement[];
  /** Event ids in each expected note's tie chain, by expected index. */
  expectedEventIds: readonly (readonly string[])[];
  /** Displayed bar of each expected note, by expected index. */
  expectedBar: readonly number[];
}

/** Implemented by P15 (`src/notation/overlay/`). */
export interface NotationOverlay {
  attach(host: OverlayHost): void;
  noteState(expectedIdx: number, s: NoteVisualState): void;
  showGhost(g: GhostNote): void;
  removeGhost(detectedId: number): void;
  setPlayhead(scoreBeat: Beats | null): void;
  setMode(m: OverlayMode): void;
  clear(): void;
  detach(): void;
}
