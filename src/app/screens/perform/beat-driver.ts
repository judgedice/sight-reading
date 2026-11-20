// The try's frame loop (round 2, "Beat line"): once per animation frame it reads the audible clock and moves the beat
// line and the playhead (page turns, fading of systems already played) straight in the score frame, with no React
// render. It reports the count-in click, the beat in the bar and the bar number only when one of them changes, so the
// screen re-renders once per beat at most. Framework-free, so tests drive it frame by frame.
import { visualAt, type MusicFacts, type TakeTiming, type VisualBeat } from './beat-clock.ts';

/** What the screen re-renders for: changes at most once per beat. */
export interface BeatView {
  click: number;
  music: boolean;
  beatInBar: number | null;
  bar: number | null;
}

/** The part of the score frame the loop moves. */
export interface BeatFrame {
  setBeatLine(scoreBeat: number | null): void;
  setPlayhead(scoreBeat: number | null): void;
}

export interface BeatDriverDeps {
  /** `AudioBackend.audibleNow`, seconds. */
  audibleNow(): number;
  /** The running try's timing, or null before the clicks are scheduled and after the try. */
  timing(): TakeTiming | null;
  facts: MusicFacts;
  frame: BeatFrame;
  /** The beat line setting (read every frame, so the try screen's switch acts at once). */
  lineOn(): boolean;
  reducedMotion(): boolean;
  onView(v: BeatView): void;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
}

const sameView = (a: BeatView | null, b: BeatView): boolean =>
  a !== null && a.click === b.click && a.music === b.music && a.beatInBar === b.beatInBar && a.bar === b.bar;

export class BeatDriver {
  private handle: number | null = null;
  private last: BeatView | null = null;
  private lastPlayhead: number | null | undefined = undefined;
  private lastT0: number | null = null;

  constructor(private readonly d: BeatDriverDeps) {}

  start(): void {
    if (this.handle !== null) return;
    const loop = (): void => {
      this.handle = this.d.requestFrame(loop);
      this.tick();
    };
    this.handle = this.d.requestFrame(loop);
    this.tick();
  }

  stop(): void {
    if (this.handle !== null) this.d.cancelFrame(this.handle);
    this.handle = null;
    this.d.frame.setBeatLine(null);
  }

  /** One frame: returns what was drawn, or null when no try is running. */
  tick(): VisualBeat | null {
    const t = this.d.timing();
    if (!t) {
      this.d.frame.setBeatLine(null);
      this.playhead(null);
      this.emit({ click: 0, music: false, beatInBar: null, bar: null }, true);
      this.lastT0 = null;
      return null;
    }
    // A restarted count-in schedules a new t0: start the page and the track again.
    if (this.lastT0 !== null && this.lastT0 !== t.t0) this.playhead(null);
    this.lastT0 = t.t0;
    const v = visualAt(t, this.d.facts, this.d.audibleNow(), this.d.reducedMotion());
    this.d.frame.setBeatLine(this.d.lineOn() ? v.line : null);
    this.playhead(v.music ? v.beat : null);
    this.emit({ click: v.click, music: v.music, beatInBar: v.beatInBar, bar: v.bar }, false);
    return v;
  }

  private playhead(beat: number | null): void {
    if (beat === null && this.lastPlayhead === null) return;
    this.lastPlayhead = beat;
    this.d.frame.setPlayhead(beat);
  }

  private emit(v: BeatView, idle: boolean): void {
    if (sameView(this.last, v)) return;
    // Before the first schedule there is nothing to report; the screen keeps its event-driven state.
    if (idle && this.last === null) return;
    this.last = v;
    this.d.onView(v);
  }
}
