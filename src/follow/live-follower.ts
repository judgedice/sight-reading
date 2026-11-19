/**
 * Live score follower (01 §9.3 to §9.5, §9.9; 02 §4.7, §4.8; PLAN R11, R19, R34, R35, R36). Runs in the DSP worker.
 *
 * Per expected note: pending → active → judged, or pending → missed. On each `note-on`:
 *  1. Greedy match (01 §9.3 step 1): among pending notes before the played onset plus the next 4 after it, the
 *     admissible one with the lowest 01 §9.2 cost plus K per pending note skipped. None: an extra.
 *  2. `note-start` and a `judgment` with the timing verdict at once (timing is final at onset); a ghost at the played
 *     position when early or late.
 *  3. Wrong pitch at confirmation when the confirming median sits ≥ `wrongAtConfirmMinCents` from the target;
 *     otherwise the pitch waits for `liveProvisionalMs` of steady pitch.
 *  4. Live sharp/flat by `rules/liveIntonationStep` (red + hysteresis to enter, red to leave; R19). A reverting
 *     mark is sent as the note's new state (R36): there is no ghost-removal event.
 *  5. Score-informed octave correction (`cost.ts`); voice octave displacement is correct (R7), other octaves are
 *     `octave` with no pitch credit (R20).
 *  6. Voice: targets carry `VoiceDriftReference.offsetCents()`, updated per finished note.
 *  7. On `note-off`: the note's judgment from the full steady median, with the duration verdict (02 §4.3).
 * On each clock: pending notes go `missed` once onset + W + confirmDelay has passed; after 1 bar of silence not
 * covered by rests, `come-in-at` the next downbeat at least `comeInMinLeadBeats` ahead.
 *
 * Displacement (01 §9.5, R34): before each note is matched, the last 4 detected notes are tested for a constant
 * offset (`displacement.ts`). On a hit the follower enters `displaced(δ)`: notes are not matched to current
 * expected notes (no red from pitch), they are drawn as extra ghosts with `displaced: true`, expected notes still go
 * missed, and `lost-place` is sent. It leaves the state (`rejoined`) when a note matches a pending expected note at
 * δ = 0 with the right pitch and does not also land on the right pitch at δ.
 *
 * Every threshold comes from `ResolvedTolerance` and `cfg.grading` through `rules/`.
 */
import type { LiveFollowerInstance } from '../core/api.ts';
import type {
  ClockSeconds,
  DetectedNote,
  DspEvent,
  EndReason,
  ExpectedNote,
  FollowConfig,
  FollowerEvent,
  GhostNote,
  KeySig,
  LiveJudgment,
  NoteJudgment,
  ResolvedTolerance,
} from '../core/types.ts';
import {
  intonationVerdict,
  liveIntonationAsVerdict,
  liveIntonationEligible,
  liveIntonationStep,
  noteVerdict,
  VoiceDriftReference,
  wrongPitchAtConfirm,
  type LiveIntonation,
  type PitchClassification,
} from '../rules/index.ts';
import { classifyAgainst, LIVE_SKIP_COST, matchCost, pitchCost, scoreSecondsOf } from './cost.ts';
import { DISPLACEMENT_WINDOW_NOTES, DisplacementDetector, type WindowNote } from './displacement.ts';
import { ghostPitch } from './ghost-spelling.ts';
import { extraMinMs, ignoredNote } from './own-playback.ts';

/** Analysis hop, samples (01 §5.6). */
const HOP_SAMPLES = 128;
/** confirmDelay = W/2 + 3 hops (01 §9.3). */
const CONFIRM_HOPS = 3;
/** Greedy candidates after the played onset (01 §9.3 step 1). */
const CANDIDATES_AFTER = 4;
/** `clock` events at most 60 Hz, `level` events at most 30 Hz (01 §9.9). */
const CLOCK_MAX_HZ = 60;
const LEVEL_MAX_HZ = 30; // tolerance-literal-ok: event rate cap, 01 §9.9
const MS = 1000;
const EPS = 1e-9;
/** Offsets closer than this are the same displacement, beats. */
const SAME_DELTA_BEATS = 0.5;

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

type ExpStatus = 'pending' | 'active' | 'judged' | 'missed';

interface DetState {
  note: DetectedNote;
  /** Played onset, score seconds. */
  s: number;
  idx: number | null;
  displaced: boolean;
  /** Played − expected onset, ms (matched notes). */
  deltaMs: number;
  /** Last ghost kind sent, or null when none is shown. */
  ghost: GhostNote['kind'] | null;
  /** Unmatched notes: the extra ghost has been sent. */
  extraGhosted: boolean;
  /** Sounding time before an unmatched note is drawn as an extra, ms (longer at a click: `own-playback.ts`). */
  extraMinMs: number;
  live: LiveIntonation;
  last: LiveJudgment | null;
  sounding: boolean;
}

export class LiveFollower implements LiveFollowerInstance {
  private readonly c: FollowConfig;
  private readonly n: number;
  private readonly status: ExpStatus[];
  private firstPending = 0;
  private readonly det = new Map<number, DetState>();
  /** Detected notes that are not the player's (`own-playback.ts`): no events at all. */
  private readonly ignored = new Set<number>();
  /** Unmatched notes still sounding (for the extra ghost on the clock). */
  private readonly soundingUnmatched = new Set<number>();
  private soundingCount = 0;
  private readonly window: WindowNote[] = [];
  private readonly windowIds: number[] = [];
  private readonly detector: DisplacementDetector;
  private readonly drift: VoiceDriftReference;
  private readonly key: KeySig;
  private readonly beatSec: number;
  private readonly barSec: number;
  private readonly confirmDelaySec: number;
  private readonly attackMs: number;
  private readonly rests: [number, number][] = [];
  private readonly maxWindowSec: number;
  private delta: number | null = null;
  /** Score seconds the current silence started (last note end, or the first written onset before any note). */
  private silenceFrom: number;
  private comeInShown = false;
  private anyVoiced = false;
  private noSignalShown = false;
  private lastClockT: number | null = null;
  private lastClockEventT = -Infinity;
  private lastLevelT = -Infinity;
  private ended = false;

  constructor(c: FollowConfig) {
    if (c.tolerances.length !== c.expected.length) throw new RangeError('one resolved tolerance per expected note');
    c.expected.forEach((e, i) => {
      if (e.idx !== i) throw new RangeError('expected notes must be indexed 0..N-1 in order');
      if (i > 0 && e.onsetSec < (c.expected[i - 1] as ExpectedNote).onsetSec) throw new RangeError('expected notes must be in onset order');
    });
    this.c = c;
    this.n = c.expected.length;
    this.status = c.expected.map(() => 'pending');
    this.detector = new DisplacementDetector(c.expected, c.tolerances, c.bpm, c.beatsPerBar, c.instrument, c.cfg);
    this.drift = new VoiceDriftReference(c.cfg);
    this.key = c.writtenKey;
    this.beatSec = 60 / c.bpm;
    this.barSec = c.beatsPerBar * this.beatSec;
    this.confirmDelaySec = (c.instrument.detection.windowSamples / 2 + CONFIRM_HOPS * HOP_SAMPLES) / c.analysisRate;
    this.attackMs = c.cfg.grading.intonation.attackExcludeMsByFamily[c.instrument.family];
    for (let i = 1; i < this.n; i++) {
      const a = c.expected[i - 1] as ExpectedNote;
      const b = c.expected[i] as ExpectedNote;
      if (b.precededByRest) this.rests.push([a.onsetSec + a.durSec, b.onsetSec]);
    }
    this.maxWindowSec = c.tolerances.reduce((m, t) => Math.max(m, t.matchWindowSec), 0);
    this.silenceFrom = c.expected[0]?.onsetSec ?? 0;
  }

  // ---- helpers -------------------------------------------------------------------------

  private s(t: number): number {
    return scoreSecondsOf(t, this.c.t0, this.c.latencyCompensationSec);
  }
  private beats(sec: number): number {
    return r6(sec / this.beatSec);
  }
  private offsetCents(): number {
    return this.c.instrument.relativePitch ? this.drift.offsetCents() : this.c.voiceReferenceCents;
  }
  private tol(i: number): ResolvedTolerance {
    return this.c.tolerances[i] as ResolvedTolerance;
  }
  private exp(i: number): ExpectedNote {
    return this.c.expected[i] as ExpectedNote;
  }
  private setStatus(i: number, s: ExpStatus): void {
    this.status[i] = s;
    while (this.firstPending < this.n && this.status[this.firstPending] !== 'pending') this.firstPending++;
  }

  private ghostEvent(st: DetState, kind: GhostNote['kind'], playedMidi: number, cents: number | null): FollowerEvent {
    const target = st.idx === null ? null : this.exp(st.idx);
    // A sharp or flat ghost sits at the written note's staff position (02 §4.8).
    const sameSpot = target !== null && (kind === 'sharp' || kind === 'flat');
    return {
      type: 'ghost',
      ghost: {
        detectedId: st.note.id,
        scoreBeat: this.beats(st.s),
        writtenPitch: sameSpot ? { ...target.writtenPitch } : ghostPitch(playedMidi, target, this.key, this.c.instrument),
        kind,
        centsError: cents === null ? null : r6(cents),
        targetExpectedIdx: st.idx,
        displaced: st.displaced,
      },
    };
  }

  private emitJudgment(out: FollowerEvent[], st: DetState, j: LiveJudgment): void {
    st.last = j;
    out.push({ type: 'judgment', judgment: j });
  }

  /** Extra (or replay) ghost once the unmatched note has sounded `extraMinDurMs` (02 §4.1). */
  private maybeExtraGhost(out: FollowerEvent[], st: DetState, soundedMs: number): void {
    if (st.idx !== null || st.extraGhosted || soundedMs < st.extraMinMs) return;
    st.extraGhosted = true;
    st.ghost = 'extra';
    out.push(this.ghostEvent(st, 'extra', st.note.midi, null));
  }

  /** Greedy candidate (01 §9.3 step 1) at δ = 0 for a played onset and pitch. */
  private greedy(s: number, d: DetectedNote, offset: number): { idx: number; cost: number; c: PitchClassification; midi: number } | null {
    let best: { idx: number; cost: number; c: PitchClassification; midi: number } | null = null;
    let skipped = 0;
    let after = 0;
    const sample = { midi: d.provisionalMidi, clarity: d.clarity, altOctaveClarity: d.altOctaveClarity };
    for (let i = this.firstPending; i < this.n; i++) {
      if (this.status[i] !== 'pending') continue;
      const e = this.exp(i);
      if (e.onsetSec > s) {
        if (++after > CANDIDATES_AFTER || e.onsetSec - s > this.maxWindowSec) break;
      }
      const t = this.tol(i);
      const dt = s - e.onsetSec;
      if (Math.abs(dt) <= t.matchWindowSec) {
        const { midi, c } = classifyAgainst(e, sample, offset, this.c.instrument, this.c.cfg);
        const plain = matchCost(dt, t, pitchCost(c));
        if (plain !== null) {
          const cost = plain + LIVE_SKIP_COST * skipped;
          if (!best || cost < best.cost) best = { idx: i, cost, c, midi };
        }
      }
      skipped++;
    }
    return best;
  }

  // ---- DSP events ----------------------------------------------------------------------

  onDsp(ev: DspEvent): FollowerEvent[] {
    const out: FollowerEvent[] = [];
    if (this.ended) return out;
    switch (ev.type) {
      case 'signal':
        if (ev.voiced) this.anyVoiced = true;
        if (this.lastClockT === null || this.lastClockT - this.lastLevelT >= 1 / LEVEL_MAX_HZ - EPS) {
          this.lastLevelT = this.lastClockT ?? this.lastLevelT;
          out.push({ type: 'level', levelDb: ev.levelDb, clipping: ev.clipping });
        }
        return out;
      case 'gap':
        return out;
      case 'note-on':
        this.onNoteOn(out, ev.note);
        return out;
      case 'note-update':
        this.onNoteUpdate(out, ev.note);
        return out;
      case 'note-off':
        this.onNoteOff(out, ev.note);
        return out;
    }
  }

  private onNoteOn(out: FollowerEvent[], d: DetectedNote): void {
    if (this.det.has(d.id) || this.ignored.has(d.id)) return;
    // Before the music, or one of the app's own tones heard through the speakers: not the player's (own-playback.ts).
    if (ignoredNote(this.c, d)) {
      this.ignored.add(d.id);
      return;
    }
    const s = this.s(d.onset);
    this.soundingCount++;
    const wn: WindowNote = { s, midi: d.provisionalMidi, clarity: d.clarity, altOctaveClarity: d.altOctaveClarity };
    this.window.push(wn);
    this.windowIds.push(d.id);
    if (this.window.length > DISPLACEMENT_WINDOW_NOTES) {
      this.window.shift();
      this.windowIds.shift();
    }
    const offset = this.offsetCents();
    const best = this.greedy(s, d, offset);
    const st: DetState = { note: d, s, idx: null, displaced: false, deltaMs: 0, ghost: null, extraGhosted: false, extraMinMs: extraMinMs(this.c, d), live: 'none', last: null, sounding: true };
    this.det.set(d.id, st);

    if (this.delta !== null) {
      if (best && best.c.kind === 'correct' && this.rejoins(wn, this.delta, offset)) {
        this.delta = null;
        out.push({ type: 'status', kind: 'rejoined' });
      } else {
        const hit = this.detector.detect(this.window, offset);
        if (hit && Math.abs(hit.offsetBeats - this.delta) > SAME_DELTA_BEATS) this.delta = hit.offsetBeats;
        this.startUnmatched(out, st, true);
        return;
      }
    } else {
      // Tested on every note, also one that matches cleanly at δ = 0: a replayed note can equal the current one.
      const hit = this.detector.detect(this.window, offset);
      if (hit) {
        this.delta = hit.offsetBeats;
        out.push({ type: 'status', kind: 'lost-place' });
        this.relabelWindow(out);
        this.startUnmatched(out, st, true);
        return;
      }
    }
    if (!best) {
      this.startUnmatched(out, st, false);
      return;
    }
    this.startMatched(out, st, best.idx, best.c, best.midi);
  }

  /**
   * In `displaced(δ)`, a note that matches a pending note at δ = 0 with the right pitch rejoins unless it also lands
   * on the right pitch at δ: a replayed note that happens to equal the current one stays displaced, and the next
   * note decides. A full window that the score explains at δ = 0 always rejoins, so the state cannot stick.
   */
  private rejoins(wn: WindowNote, delta: number, offset: number): boolean {
    if (this.detector.fit([wn], delta, offset).matches === 0) return true;
    return this.window.length === DISPLACEMENT_WINDOW_NOTES && this.detector.fit(this.window, 0, offset).matches === DISPLACEMENT_WINDOW_NOTES;
  }

  /** Earlier window notes that went unmatched belong to the displaced run: redraw them as replay ghosts. */
  private relabelWindow(out: FollowerEvent[]): void {
    for (const id of this.windowIds) {
      const st = this.det.get(id);
      if (!st || st.idx !== null || st.displaced) continue;
      st.displaced = true;
      if (st.extraGhosted) out.push(this.ghostEvent(st, 'extra', st.note.midi, null));
    }
  }

  private startUnmatched(out: FollowerEvent[], st: DetState, displaced: boolean): void {
    st.displaced = displaced;
    this.soundingUnmatched.add(st.note.id);
    out.push({ type: 'note-start', detectedId: st.note.id, scoreBeat: this.beats(st.s), provisionalConcertMidi: st.note.provisionalMidi, matchedExpected: null, displaced });
  }

  private startMatched(out: FollowerEvent[], st: DetState, idx: number, c: PitchClassification, midi: number): void {
    const e = this.exp(idx);
    const tol = this.tol(idx);
    st.idx = idx;
    st.deltaMs = (st.s - e.onsetSec) * MS;
    this.setStatus(idx, 'active');
    out.push({ type: 'note-start', detectedId: st.note.id, scoreBeat: this.beats(st.s), provisionalConcertMidi: st.note.provisionalMidi, matchedExpected: idx, displaced: false });
    const wrong = wrongPitchAtConfirm(c, st.note.framesAgree, this.c.cfg);
    // Until the pitch is known, judge timing alone: a correct-pitch placeholder with no intonation grade.
    const facts = wrong ? c : { ...c, kind: 'correct' as const, p: 1 as const, octaveDisplaced: false, devCents: 0 };
    const v = noteVerdict({ deltaMs: st.deltaMs, pitch: facts, intonation: 'not-graded' }, tol);
    this.emitJudgment(out, st, {
      expectedIdx: idx,
      status: 'matched',
      detectedId: st.note.id,
      timing: v.timing,
      timingErrorMs: r6(st.deltaMs),
      pitch: wrong ? v.pitch : null,
      playedConcertMidi: r6(midi),
      centsError: wrong ? r6(c.devCents) : null,
      octaveDisplaced: false,
      duration: 'not-graded',
      heldRatio: null,
      marginal: v.marginal,
      provisional: true,
    });
    if (v.ghost !== null) {
      st.ghost = v.ghost;
      out.push(this.ghostEvent(st, v.ghost, midi, null));
    }
  }

  private onNoteUpdate(out: FollowerEvent[], d: DetectedNote): void {
    const st = this.det.get(d.id);
    if (!st || !st.sounding) return;
    st.note = d;
    if (st.idx === null) {
      this.maybeExtraGhost(out, st, d.steadyMs + this.attackMs);
      return;
    }
    const tol = this.tol(st.idx);
    if (d.steadyMs < tol.liveProvisionalMs) return;
    const e = this.exp(st.idx);
    const { midi, c } = classifyAgainst(e, d, this.offsetCents(), this.c.instrument, this.c.cfg);
    const eligible = liveIntonationEligible(e, tol);
    st.live = c.kind === 'correct' ? liveIntonationStep(st.live, c.devCents, d.steadyMs, eligible, tol) : 'none';
    const intonation = c.kind === 'correct' ? liveIntonationAsVerdict(st.live, eligible) : 'not-graded';
    const v = noteVerdict({ deltaMs: st.deltaMs, pitch: c, intonation }, tol);
    const prev = st.last as LiveJudgment;
    if (prev.pitch !== v.pitch || prev.marginal !== v.marginal || prev.octaveDisplaced !== c.octaveDisplaced) {
      this.emitJudgment(out, st, { ...prev, pitch: v.pitch, playedConcertMidi: r6(midi), centsError: r6(c.devCents), octaveDisplaced: c.octaveDisplaced, marginal: v.marginal, provisional: true });
    }
    this.updateGhost(out, st, v.ghost, midi, c.devCents);
  }

  /** Send the ghost when its kind changes; a cleared ghost is conveyed by the judgment alone (R36). */
  private updateGhost(out: FollowerEvent[], st: DetState, kind: GhostNote['kind'] | null, midi: number, devCents: number): void {
    if (kind === null) {
      st.ghost = null;
      return;
    }
    if (kind === st.ghost) return;
    st.ghost = kind;
    out.push(this.ghostEvent(st, kind, midi, kind === 'sharp' || kind === 'flat' ? devCents : null));
  }

  private onNoteOff(out: FollowerEvent[], d: DetectedNote): void {
    const st = this.det.get(d.id);
    if (!st || !st.sounding) return;
    st.note = d;
    st.sounding = false;
    this.soundingCount--;
    this.soundingUnmatched.delete(d.id);
    const durSec = (d.offset ?? d.onset) - d.onset;
    this.silenceFrom = Math.max(this.silenceFrom, st.s + durSec);
    this.comeInShown = false;
    if (st.idx !== null) this.finishMatched(out, st, durSec);
    else this.maybeExtraGhost(out, st, durSec * MS);
    out.push({ type: 'note-end', detectedId: d.id, durationBeats: this.beats(durSec) });
  }

  private finishMatched(out: FollowerEvent[], st: DetState, durSec: number): void {
    const idx = st.idx as number;
    const e = this.exp(idx);
    const tol = this.tol(idx);
    const d = st.note;
    const { midi, c } = classifyAgainst(e, d, this.offsetCents(), this.c.instrument, this.c.cfg);
    const intonation = c.kind === 'correct' ? intonationVerdict(c.devCents, d.steadyMs, tol) : 'not-graded';
    const v = noteVerdict({ deltaMs: st.deltaMs, pitch: c, intonation }, tol);
    const heldRatio = e.durSec > 0 ? durSec / e.durSec : null;
    const j: LiveJudgment = {
      ...(st.last as LiveJudgment),
      pitch: v.pitch,
      playedConcertMidi: r6(midi),
      centsError: r6(c.devCents),
      octaveDisplaced: c.octaveDisplaced,
      duration: this.durationVerdict(e, heldRatio),
      heldRatio: heldRatio === null ? null : r6(heldRatio),
      marginal: v.marginal,
      provisional: false,
    };
    this.emitJudgment(out, st, j);
    this.updateGhost(out, st, v.ghost, midi, c.devCents);
    if (this.c.instrument.relativePitch) this.drift.observe(c.rawDevCents, c.p === 1);
    this.setStatus(idx, 'judged');
  }

  /** 02 §4.3 duration rule: graded notes are `ok` when fully credited, else `short`. */
  private durationVerdict(e: ExpectedNote, heldRatio: number | null): NoteJudgment['duration'] {
    if (!e.durationGraded || this.c.instrument.pitchKind === 'fixed' || heldRatio === null) return 'not-graded';
    const k = this.c.cfg.grading.credit.duration;
    const full = e.followedByRest ? k.beforeRestFullRatio : k.fullHeldRatio;
    return heldRatio >= full ? 'ok' : 'short';
  }

  // ---- clock and end -------------------------------------------------------------------

  onClock(inputT: ClockSeconds): FollowerEvent[] {
    const out: FollowerEvent[] = [];
    if (this.ended) return out;
    this.lastClockT = inputT;
    const now = this.s(inputT);
    if (inputT - this.lastClockEventT >= 1 / CLOCK_MAX_HZ - EPS) {
      this.lastClockEventT = inputT;
      out.push({ type: 'clock', scoreBeat: this.beats(now) });
    }
    this.fireMissed(out, now);
    for (const id of this.soundingUnmatched) {
      const st = this.det.get(id) as DetState;
      this.maybeExtraGhost(out, st, (now - st.s) * MS);
    }
    this.comeIn(out, now);
    if (!this.anyVoiced && !this.noSignalShown && now - this.silenceFrom >= this.c.cfg.grading.gates.voidNoSignalSec) {
      this.noSignalShown = true;
      out.push({ type: 'status', kind: 'no-signal' });
    }
    return out;
  }

  /** Pending notes past onset + W + confirmDelay go missed (01 §9.3). */
  private fireMissed(out: FollowerEvent[], now: number): void {
    for (let i = this.firstPending; i < this.n; i++) {
      const e = this.exp(i);
      if (e.onsetSec > now) break;
      if (this.status[i] !== 'pending') continue;
      if (now > e.onsetSec + this.tol(i).matchWindowSec + this.confirmDelaySec) {
        this.setStatus(i, 'missed');
        out.push({ type: 'missed', expectedIdx: i });
      }
    }
  }

  /** After 1 bar of silence not covered by rests: come in at the next downbeat ≥ lead beats ahead (02 §4.6). */
  private comeIn(out: FollowerEvent[], now: number): void {
    if (this.soundingCount > 0 || this.comeInShown) return;
    const st = this.c.cfg.grading.stops;
    const from = this.silenceFrom;
    if (now - from < st.comeInAfterBars * this.barSec) return;
    let covered = 0;
    for (const [a, b] of this.rests) covered += Math.max(0, Math.min(now, b) - Math.max(from, a));
    if (now - from - covered < st.comeInAfterBars * this.barSec) return;
    if (!this.c.expected.some((e) => e.onsetSec > from && e.onsetSec <= now)) return;
    this.comeInShown = true;
    const nowBeat = now / this.beatSec;
    const bar = Math.ceil((nowBeat + st.comeInMinLeadBeats) / this.c.beatsPerBar - EPS) + 1;
    out.push({ type: 'status', kind: 'come-in-at', bar });
  }

  end(inputT: ClockSeconds, reason: EndReason): FollowerEvent[] {
    if (this.ended) return [];
    const out: FollowerEvent[] = [];
    this.fireMissed(out, this.s(inputT));
    this.ended = true;
    out.push(reason.reason === 'void' ? { type: 'end', reason: 'void', voidReason: reason.voidReason } : { type: 'end', reason: reason.reason });
    return out;
  }
}
