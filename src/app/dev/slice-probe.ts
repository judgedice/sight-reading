// The slice's paint loop and test probe. Follower events are queued as they arrive and applied to the score view in
// the next animation frame (no React render per event, 01 §5.8). Each frame stamps, on the audio clock, when a detected
// note first reached the screen, so the spec can measure sample onset to paint (01 §12). `state()` is what
// e2e/slice/slice.spec.ts reads through `window.__slice`.
import type { FollowerEvent, GhostNote, ScoreLayout } from '../../core/types.ts';
import type { VexScoreView } from '../../notation/index.ts';
import type { SlicePhase, SliceResult, SliceRunner } from '../compose/slice-runtime.ts';
import type { SliceTake } from '../compose/slice-take.ts';

export interface GhostProbe {
  detectedId: number;
  kind: GhostNote['kind'];
  targetExpectedIdx: number | null;
  scoreBeat: number;
  /** x of the ghost head in the DOM (its translate), px within the system. */
  domX: number | null;
  /** layout.beatToPoint(scoreBeat).x. */
  beatX: number;
}

export interface SliceState {
  phase: SlicePhase;
  error: string | null;
  timing: SliceRunner['timing'];
  eventCount: number;
  /** Follower events other than clock and level, in order (the live outcome for the Node re-alignment). */
  events: FollowerEvent[];
  /** Audio-clock paint time per detected note id (first frame that showed its note-start). */
  paintedAt: Record<number, number>;
  ghosts: GhostProbe[];
  /** Classes of each expected note's groups, by expected index. */
  noteClasses: Record<number, string>;
  result: null | {
    score: SliceResult['score'];
    alignment: SliceResult['alignment'];
    detected: SliceResult['done']['detected'];
    signal: SliceResult['done']['signal'];
    stats: SliceResult['done']['stats'];
    recordId: string;
    recordRoundTrip: boolean;
  };
}

export class SliceProbe {
  phase: SlicePhase = 'idle';
  error: string | null = null;
  private readonly take: SliceTake;
  private readonly view: VexScoreView;
  private layout: ScoreLayout | null = null;
  private runner: SliceRunner | null = null;
  private apply: ((events: FollowerEvent[]) => void) | null = null;
  private queue: FollowerEvent[] = [];
  private frame = 0;
  private eventCount = 0;
  private readonly kept: FollowerEvent[] = [];
  private readonly paintedAt = new Map<number, number>();
  private readonly ghosts = new Map<number, GhostNote>();
  private result: SliceResult | null = null;

  constructor(take: SliceTake, view: VexScoreView) {
    this.take = take;
    this.view = view;
  }

  setLayout(l: ScoreLayout): void {
    this.layout = l;
  }

  attach(runner: SliceRunner, apply: (events: FollowerEvent[]) => void): void {
    this.runner = runner;
    this.apply = apply;
  }

  enqueue(events: FollowerEvent[]): void {
    for (const e of events) {
      this.queue.push(e);
      if (e.type !== 'clock' && e.type !== 'level' && e.type !== 'final') this.kept.push(e);
    }
    this.eventCount += events.length;
    if (this.frame === 0) this.frame = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = 0;
    const batch = this.queue;
    this.queue = [];
    this.apply?.(batch);
    const now = this.runner?.now() ?? 0;
    for (const e of batch) {
      if (e.type === 'note-start' && !this.paintedAt.has(e.detectedId)) this.paintedAt.set(e.detectedId, now);
      if (e.type === 'ghost') this.ghosts.set(e.ghost.detectedId, e.ghost);
    }
  }

  finish(r: SliceResult): void {
    this.result = r;
  }

  state(): SliceState {
    const root = document.querySelector('[data-testid="slice-score"]');
    const ghosts: GhostProbe[] = [...this.ghosts.values()].map((g) => {
      const head = root?.querySelector(`.sr-ghost[data-detected-id="${g.detectedId}"] .sr-ghost-head`);
      const m = head ? /translate\(([-\d.]+)/.exec(head.getAttribute('transform') ?? '') : null;
      return {
        detectedId: g.detectedId,
        kind: g.kind,
        targetExpectedIdx: g.targetExpectedIdx,
        scoreBeat: g.scoreBeat as number,
        domX: m ? Number(m[1]) : null,
        beatX: this.beatX(g.scoreBeat),
      };
    });
    const noteClasses: Record<number, string> = {};
    for (let i = 0; i < this.take.expected.length; i++) {
      const gs = root ? Array.from(root.querySelectorAll(`g[data-expected-idx="${i}"]`)) : [];
      noteClasses[i] = [...new Set(gs.flatMap((g) => Array.from(g.classList)))].filter((c) => c.startsWith('n-')).join(' ');
    }
    const r = this.result;
    return {
      phase: this.phase,
      error: this.error,
      timing: this.runner?.timing ?? null,
      eventCount: this.eventCount,
      events: this.kept,
      paintedAt: Object.fromEntries(this.paintedAt),
      ghosts,
      noteClasses,
      result: r
        ? {
            score: r.score,
            alignment: r.alignment,
            detected: r.done.detected,
            signal: r.done.signal,
            stats: r.done.stats,
            recordId: r.record.id,
            recordRoundTrip: JSON.stringify(r.reloaded) === JSON.stringify(r.record),
          }
        : null,
    };
  }

  /** layout.beatToPoint(beat).x, px within its system (NaN before the render). */
  beatX(beat: number): number {
    return this.layout ? this.layout.beatToPoint(beat).x : NaN;
  }

  /** The view (debugging from the console). */
  get scoreView(): VexScoreView {
    return this.view;
  }
}
