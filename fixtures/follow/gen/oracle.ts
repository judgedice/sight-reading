/**
 * Reference follower for deriving and self-checking fixture expectations (01 §9.2 to §9.9). NOT the product code
 * (P10a/P10b build `follow/` independently). It implements the spec's rules literally, with one deliberate
 * shortcut: displacement is taken from the scenario's ground truth instead of being detected. A displaced note
 * from the 4th of its run on is treated as detected (01 §9.5: "detected notes are not matched ... within 4
 * notes"), the first three go through the greedy matcher like any other note (01 §9.5: "The first 2 or 3 displaced
 * notes ... may show live wrong-pitch marks"). Predicates never assert on those first three notes' live state.
 *
 * Live: greedy cost 9.2 plus K = 2 per skipped pending note (9.3 step 1); timing final at onset; wrong pitch at
 * confirmation when the provisional pitch is ≥ 80 c (grading-config live.wrongAtConfirmMinCents) from the target;
 * sharp/flat after attackExcludeMs + liveProvisionalMs of steady pitch beyond red + hysteresis, only for notes whose
 * expected steady duration reaches minSteadyMs; missed at onset + W + confirmDelay; come-in-at after 1 bar of
 * uncovered silence; extras after the 100 ms rule.
 * Final: monotonic DP with match cost 9.2, skip expected 6, skip detected 5 (9.6), score-informed octave
 * correction (9.3 step 5), credits by `reference.ts`.
 */
import type {
  Configs,
  DetectedNote,
  DisplacedSegment,
  DspEvent,
  EndReason,
  ExpectedNote,
  ExtraNote,
  FinalAlignment,
  FollowerEvent,
  GhostNote,
  Instrument,
  KeySig,
  LiveJudgment,
  NoteJudgment,
  ResolvedTolerance,
  SpelledPitch,
  Step,
} from '../../../src/core/types.ts';
import { midiOf } from './expected.ts';
import { confirmDelaySec, r6, type Truth } from './perform.ts';
import { judgeMatched, judgeMissed, pitchFacts, RefVoiceDrift, timingVerdict, type JudgeContext } from './reference.ts';

export interface OracleCtx {
  expected: ExpectedNote[];
  tol: ResolvedTolerance[];
  inst: Instrument;
  cfg: Configs;
  bpm: number;
  beatsPerBar: number;
  t0: number;
  rtl: number;
  writtenKey: KeySig;
  truthById: Map<number, Truth>;
  /** Winds/brass/strings tuning offset, cents (FollowConfig.voiceReferenceCents). */
  tuningCents: number;
}

// ------------------------------------------------------------------------------------------------
// Ghost spelling (02 §4.8)
// ------------------------------------------------------------------------------------------------

const SHARP_NAMES: [Step, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_NAMES: [Step, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

export function spellGhostRef(playedWrittenMidi: number, target: SpelledPitch | null, key: KeySig): SpelledPitch {
  if (target && Math.abs(playedWrittenMidi - midiOf(target)) <= 2) {
    const alter = playedWrittenMidi - midiOf({ step: target.step, alter: 0, octave: target.octave });
    if (Math.abs(alter) <= 2) return { step: target.step, alter: alter as SpelledPitch['alter'], octave: target.octave };
  }
  const pc = ((playedWrittenMidi % 12) + 12) % 12;
  const [step, alter] = (key.fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc]!;
  const octave = Math.floor(playedWrittenMidi / 12) - 1;
  return { step, alter: alter as SpelledPitch['alter'], octave };
}

// ------------------------------------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------------------------------------

/** 9.2 pitch term with octave folding for voice and score-informed octave correction (9.3 step 5). */
function pitchTerm(e: ExpectedNote, midi: number, d: { clarity: number; altOctaveClarity: number | null }, inst: Instrument): number {
  const diff = Math.round(midi) - e.concertMidi;
  if (diff === 0) return 0;
  if (diff % 12 === 0) {
    if (inst.relativePitch) return 0;
    if (Math.abs(diff) === 12 && d.altOctaveClarity !== null && d.altOctaveClarity >= 0.8 * d.clarity) return 0;
    return 2;
  }
  return 5;
}

/** Score-informed octave correction applied to the measured pitch (non-voice, 9.3 step 5). */
function correctedMidi(e: ExpectedNote, d: { midi: number; clarity: number; altOctaveClarity: number | null }, inst: Instrument): number {
  const diff = Math.round(d.midi) - e.concertMidi;
  if (!inst.relativePitch && Math.abs(diff) === 12 && d.altOctaveClarity !== null && d.altOctaveClarity >= 0.8 * d.clarity) return d.midi - diff;
  return d.midi;
}

function restIntervals(expected: ExpectedNote[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < expected.length; i++) {
    const b = expected[i]!;
    const a = expected[i - 1]!;
    if (b.precededByRest) out.push([a.onsetSec + a.durSec, b.onsetSec]);
  }
  return out;
}

export function duringRest(expected: ExpectedNote[], onset: number, dur: number, cfg: Configs): boolean {
  const need = cfg.grading.credit.restIntrusionMs / 1000;
  return restIntervals(expected).some(([a, b]) => Math.min(b, onset + dur) - Math.max(a, onset) > need);
}

const facts = (d: DetectedNote, ctx: OracleCtx, e: ExpectedNote) => {
  const midi = correctedMidi(e, d, ctx.inst);
  return {
    detectedId: d.id,
    onsetSec: d.onset - ctx.t0 - ctx.rtl,
    durSec: (d.offset ?? d.onset) - d.onset,
    midi,
    steadyMs: d.steadyMs,
  };
};

const toLive = (j: NoteJudgment, provisional: boolean): LiveJudgment => {
  const { credit: _c, rejudged: _r, ...rest } = j;
  return { ...rest, provisional };
};

// ------------------------------------------------------------------------------------------------
// Live
// ------------------------------------------------------------------------------------------------

type DetState = { idx: number | null; displaced: boolean; ghost: GhostNote['kind'] | null; steadyDone: boolean; extraGhosted: boolean; onsetSec: number };

export class OracleLiveFollower {
  private readonly status: ('pending' | 'active' | 'judged' | 'missed')[];
  private readonly det = new Map<number, DetState>();
  private readonly sounding = new Set<number>();
  private lostPlace = false;
  private lastSoundEnd: number | null = null;
  private comeInShown = false;
  private readonly drift: RefVoiceDrift;
  readonly lastLive = new Map<number, LiveJudgment>();

  constructor(private readonly c: OracleCtx) {
    this.status = c.expected.map(() => 'pending');
    this.drift = new RefVoiceDrift(c.cfg);
  }

  private s(t: number): number {
    return t - this.c.t0 - this.c.rtl;
  }
  private beat(s: number): number {
    return r6((s * this.c.bpm) / 60);
  }
  private judgeCtx(): JudgeContext {
    return { inst: this.c.inst, cfg: this.c.cfg, offsetCents: this.c.inst.relativePitch ? this.drift.offsetCents() : this.c.tuningCents };
  }
  private ghost(d: DetectedNote, kind: GhostNote['kind'], idx: number | null, midi: number, cents: number | null, displaced: boolean): GhostNote {
    const e = idx === null ? null : this.c.expected[idx]!;
    const wm = Math.round(midi) + this.c.inst.writtenMinusSounding.chromatic;
    return {
      detectedId: d.id,
      scoreBeat: this.beat(d.onset - this.c.t0 - this.c.rtl),
      writtenPitch: spellGhostRef(wm, e ? e.writtenPitch : null, this.c.writtenKey),
      kind,
      centsError: cents === null ? null : r6(cents),
      targetExpectedIdx: idx,
      displaced,
    };
  }
  private emitJ(out: FollowerEvent[], j: LiveJudgment): void {
    this.lastLive.set(j.expectedIdx, j);
    out.push({ type: 'judgment', judgment: j });
  }

  onDsp(ev: DspEvent): FollowerEvent[] {
    const out: FollowerEvent[] = [];
    if (ev.type === 'signal') {
      out.push({ type: 'level', levelDb: ev.levelDb, clipping: ev.clipping });
      return out;
    }
    if (ev.type === 'gap') return out;
    const d = ev.note;
    const sOn = d.onset - this.c.t0 - this.c.rtl;
    if (ev.type === 'note-on') {
      this.sounding.add(d.id);
      const truth = this.c.truthById.get(d.id);
      if (truth?.kind === 'displaced') {
        const pos = [...this.c.truthById.entries()].filter(([, t]) => t.kind === 'displaced' && t.seg === truth.seg).map(([id]) => id).sort((a, b) => a - b).indexOf(d.id);
        if (pos >= 3) {
          if (!this.lostPlace) out.push({ type: 'status', kind: 'lost-place' });
          this.lostPlace = true;
          this.det.set(d.id, { idx: null, displaced: true, ghost: null, steadyDone: true, extraGhosted: false, onsetSec: sOn });
          out.push({ type: 'note-start', detectedId: d.id, scoreBeat: this.beat(sOn), provisionalConcertMidi: d.provisionalMidi, matchedExpected: null, displaced: true });
          return out;
        }
      }
      // greedy candidate search (9.3 step 1)
      const pend = this.c.expected.filter((e) => this.status[e.idx] === 'pending');
      const before = pend.filter((e) => e.onsetSec <= sOn);
      const after = pend.filter((e) => e.onsetSec > sOn).slice(0, 4);
      let best: { idx: number; cost: number } | null = null;
      for (const e of [...before, ...after]) {
        const tol = this.c.tol[e.idx]!;
        const dt = sOn - e.onsetSec;
        if (Math.abs(dt) > tol.matchWindowSec) continue;
        const skipped = pend.filter((x) => x.idx < e.idx).length;
        const cost = 4 * (dt / tol.matchWindowSec) ** 2 + pitchTerm(e, d.provisionalMidi, d, this.c.inst) + 2 * skipped;
        if (!best || cost < best.cost) best = { idx: e.idx, cost };
      }
      if (!best) {
        this.det.set(d.id, { idx: null, displaced: false, ghost: null, steadyDone: true, extraGhosted: false, onsetSec: sOn });
        out.push({ type: 'note-start', detectedId: d.id, scoreBeat: this.beat(sOn), provisionalConcertMidi: d.provisionalMidi, matchedExpected: null, displaced: false });
        return out;
      }
      if (this.lostPlace) {
        this.lostPlace = false;
        out.push({ type: 'status', kind: 'rejoined' });
      }
      const e = this.c.expected[best.idx]!;
      const tol = this.c.tol[best.idx]!;
      this.status[best.idx] = 'active';
      const st: DetState = { idx: best.idx, displaced: false, ghost: null, steadyDone: false, extraGhosted: true, onsetSec: sOn };
      this.det.set(d.id, st);
      out.push({ type: 'note-start', detectedId: d.id, scoreBeat: this.beat(sOn), provisionalConcertMidi: d.provisionalMidi, matchedExpected: best.idx, displaced: false });
      const dtMs = r6((sOn - e.onsetSec) * 1000);
      const timing = timingVerdict(dtMs, tol);
      const pf = pitchFacts(e, correctedMidi(e, { midi: d.provisionalMidi, clarity: d.clarity, altOctaveClarity: d.altOctaveClarity }, this.c.inst), this.judgeCtx());
      const wrongAtConfirm = pf.verdictBase !== 'ok' && Math.abs(pf.devCents) >= this.c.cfg.grading.live.wrongAtConfirmMinCents;
      const pitch = wrongAtConfirm ? (pf.verdictBase === 'octave' ? 'octave' : 'wrong-pitch') : null;
      if (wrongAtConfirm) st.steadyDone = true;
      this.emitJ(out, {
        expectedIdx: e.idx,
        status: 'matched',
        detectedId: d.id,
        timing,
        timingErrorMs: dtMs,
        pitch,
        playedConcertMidi: d.provisionalMidi,
        centsError: null,
        octaveDisplaced: false,
        duration: 'not-graded',
        heldRatio: null,
        marginal: Math.abs(dtMs) > tol.tGoodSec * 1000 && Math.abs(dtMs) <= tol.tRedSec * 1000,
        provisional: true,
      });
      const kind: GhostNote['kind'] | null = pitch ?? (timing === 'on-time' ? null : timing);
      if (kind) {
        st.ghost = kind;
        out.push({ type: 'ghost', ghost: this.ghost(d, kind, e.idx, d.provisionalMidi, null, false) });
      }
      return out;
    }
    const st = this.det.get(d.id);
    if (!st) return out;
    if (ev.type === 'note-update') {
      if (st.idx === null) {
        if (!st.extraGhosted && d.steadyMs + this.c.cfg.grading.intonation.attackExcludeMsByFamily[this.c.inst.family] >= this.c.cfg.grading.credit.extraMinDurMs) {
          st.extraGhosted = true;
          out.push({ type: 'ghost', ghost: this.ghost(d, 'extra', null, d.midi, null, st.displaced) });
        }
        return out;
      }
      if (st.steadyDone || d.steadyMs < this.c.tol[st.idx]!.liveProvisionalMs) return out;
      st.steadyDone = true;
      const e = this.c.expected[st.idx]!;
      const tol = this.c.tol[st.idx]!;
      const prev = this.lastLive.get(st.idx)!;
      const pf = pitchFacts(e, correctedMidi(e, d, this.c.inst), this.judgeCtx());
      let pitch: LiveJudgment['pitch'];
      let ghostKind: GhostNote['kind'] | null = null;
      if (pf.verdictBase !== 'ok') {
        pitch = pf.verdictBase === 'octave' ? 'octave' : 'wrong-pitch';
        ghostKind = pitch;
      } else {
        const expSteady = e.durSec * 1000 - tol.attackExcludeMs;
        const graded = tol.redCents !== null && expSteady >= tol.minSteadyMs;
        if (graded && Math.abs(pf.devCents) > tol.redCents! + tol.liveHysteresisCents) {
          pitch = pf.devCents > 0 ? 'sharp' : 'flat';
          ghostKind = pitch;
        } else pitch = graded ? 'in-tune' : 'not-graded';
      }
      this.emitJ(out, { ...prev, pitch, playedConcertMidi: d.midi, centsError: r6(pf.devCents), octaveDisplaced: pf.octaveDisplaced, provisional: true });
      if (ghostKind && st.ghost === null) {
        st.ghost = ghostKind;
        out.push({ type: 'ghost', ghost: this.ghost(d, ghostKind, e.idx, d.midi, ghostKind === 'sharp' || ghostKind === 'flat' ? pf.devCents : null, false) });
      }
      return out;
    }
    // note-off
    this.sounding.delete(d.id);
    const end = (d.offset ?? d.onset) - this.c.t0 - this.c.rtl;
    this.lastSoundEnd = Math.max(this.lastSoundEnd ?? -Infinity, end);
    this.comeInShown = false;
    if (st.idx === null) {
      if (!st.extraGhosted && (d.offset ?? d.onset) - d.onset >= this.c.cfg.grading.credit.extraMinDurMs / 1000) {
        st.extraGhosted = true;
        out.push({ type: 'ghost', ghost: this.ghost(d, 'extra', null, d.midi, null, st.displaced) });
      }
      out.push({ type: 'note-end', detectedId: d.id, durationBeats: this.beat((d.offset ?? d.onset) - d.onset) });
      return out;
    }
    const e = this.c.expected[st.idx]!;
    const ctx = this.judgeCtx();
    const j = judgeMatched(e, this.c.tol[st.idx]!, facts(d, this.c, e), ctx);
    if (this.c.inst.relativePitch && j.credit.p === 1) this.drift.observe(j.centsError! + ctx.offsetCents, true);
    this.status[st.idx] = 'judged';
    const fin = toLive(j, false);
    // a wrong pitch shown at confirmation stays wrong (the ghost cannot be withdrawn)
    this.emitJ(out, fin);
    const finKind: GhostNote['kind'] | null =
      fin.pitch === 'wrong-pitch' || fin.pitch === 'octave' ? fin.pitch : fin.pitch === 'sharp' || fin.pitch === 'flat' ? fin.pitch : fin.timing === 'on-time' ? null : fin.timing;
    if (finKind && st.ghost === null) {
      st.ghost = finKind;
      out.push({ type: 'ghost', ghost: this.ghost(d, finKind, e.idx, j.playedConcertMidi ?? d.midi, finKind === 'sharp' || finKind === 'flat' ? j.centsError : null, false) });
    }
    out.push({ type: 'note-end', detectedId: d.id, durationBeats: this.beat((d.offset ?? d.onset) - d.onset) });
    return out;
  }

  onClock(t: number): FollowerEvent[] {
    const out: FollowerEvent[] = [{ type: 'clock', scoreBeat: this.beat(this.s(t)) }];
    const now = this.s(t);
    const delay = confirmDelaySec(this.c.inst);
    for (const e of this.c.expected) {
      if (this.status[e.idx] !== 'pending') continue;
      if (now > e.onsetSec + this.c.tol[e.idx]!.matchWindowSec + delay) {
        this.status[e.idx] = 'missed';
        out.push({ type: 'missed', expectedIdx: e.idx });
      }
    }
    const barSec = (this.c.beatsPerBar * 60) / this.c.bpm;
    const st = this.c.cfg.grading.stops;
    if (this.sounding.size === 0 && this.lastSoundEnd !== null && !this.comeInShown) {
      const from = this.lastSoundEnd;
      const covered = restIntervals(this.c.expected).reduce((acc, [a, b]) => acc + Math.max(0, Math.min(now, b) - Math.max(from, a)), 0);
      const uncovered = now - from - covered >= st.comeInAfterBars * barSec && this.c.expected.some((e) => e.onsetSec > from && e.onsetSec <= now);
      if (uncovered) {
        this.comeInShown = true;
        const nowBeat = (now * this.c.bpm) / 60;
        const bar = Math.ceil((nowBeat + st.comeInMinLeadBeats) / this.c.beatsPerBar - 1e-9) + 1;
        out.push({ type: 'status', kind: 'come-in-at', bar });
      }
    }
    return out;
  }

  end(_t: number, reason: EndReason): FollowerEvent[] {
    return [reason.reason === 'void' ? { type: 'end', reason: 'void', voidReason: reason.voidReason } : { type: 'end', reason: reason.reason }];
  }
}

// ------------------------------------------------------------------------------------------------
// Final alignment (9.6)
// ------------------------------------------------------------------------------------------------

export function oracleFinal(c: OracleCtx, detected: DetectedNote[], live: Map<number, LiveJudgment>): FinalAlignment {
  const g = c.cfg.grading;
  const disp = detected.filter((d) => c.truthById.get(d.id)?.kind === 'displaced');
  const rest = detected.filter((d) => c.truthById.get(d.id)?.kind !== 'displaced');
  const E = c.expected;
  const nE = E.length;
  const nD = rest.length;
  const durOf = (d: DetectedNote): number => (d.offset ?? d.onset) - d.onset;
  const skipD = (d: DetectedNote): number => (durOf(d) >= g.credit.extraMinDurMs / 1000 ? 5 : 0);
  const match = (i: number, j: number): number | null => {
    const e = E[i]!;
    const d = rest[j]!;
    const tol = c.tol[i]!;
    const dt = d.onset - c.t0 - c.rtl - e.onsetSec;
    if (Math.abs(dt) > tol.matchWindowSec) return null;
    return 4 * (dt / tol.matchWindowSec) ** 2 + pitchTerm(e, d.midi, d, c.inst);
  };
  const D: number[][] = Array.from({ length: nE + 1 }, () => new Array<number>(nD + 1).fill(Infinity));
  const B: (0 | 1 | 2)[][] = Array.from({ length: nE + 1 }, () => new Array<0 | 1 | 2>(nD + 1).fill(0));
  D[0]![0] = 0;
  for (let i = 0; i <= nE; i++)
    for (let j = 0; j <= nD; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let how: 0 | 1 | 2 = 0;
      if (i > 0 && j > 0) {
        const m = match(i - 1, j - 1);
        if (m !== null && D[i - 1]![j - 1]! + m < best) {
          best = D[i - 1]![j - 1]! + m;
          how = 0;
        }
      }
      if (i > 0 && D[i - 1]![j]! + 6 < best) {
        best = D[i - 1]![j]! + 6;
        how = 1;
      }
      if (j > 0 && D[i]![j - 1]! + skipD(rest[j - 1]!) < best) {
        best = D[i]![j - 1]! + skipD(rest[j - 1]!);
        how = 2;
      }
      D[i]![j] = best;
      B[i]![j] = how;
    }
  const pairs = new Map<number, DetectedNote>();
  const unmatched: DetectedNote[] = [];
  for (let i = nE, j = nD; i > 0 || j > 0; ) {
    const how = B[i]![j]!;
    if (how === 0 && i > 0 && j > 0) {
      pairs.set(i - 1, rest[j - 1]!);
      i--;
      j--;
    } else if (how === 1 && i > 0) i--;
    else {
      unmatched.push(rest[j - 1]!);
      j--;
    }
  }
  const drift = new RefVoiceDrift(c.cfg);
  const judgments: NoteJudgment[] = E.map((e) => {
    const d = pairs.get(e.idx);
    if (!d) return judgeMissed(e, c.inst);
    const offsetCents = c.inst.relativePitch ? drift.offsetCents() : c.tuningCents;
    const j = judgeMatched(e, c.tol[e.idx]!, facts(d, c, e), { inst: c.inst, cfg: c.cfg, offsetCents });
    if (c.inst.relativePitch && j.credit.p === 1) drift.observe(j.centsError! + offsetCents, true);
    return j;
  });
  for (const j of judgments) {
    const l = live.get(j.expectedIdx);
    j.rejudged = !l ? j.status === 'matched' : l.status !== j.status || l.detectedId !== j.detectedId || l.timing !== j.timing || l.pitch !== j.pitch;
  }
  const extras: ExtraNote[] = unmatched
    .filter((d) => durOf(d) >= g.credit.extraMinDurMs / 1000)
    .sort((a, b) => a.id - b.id)
    .map((d) => {
      const on = d.onset - c.t0 - c.rtl;
      return { detectedId: d.id, onsetSec: r6(on), concertMidi: d.midi, cents: r6((d.midi - Math.round(d.midi)) * 100), durSec: r6(durOf(d)), duringRest: duringRest(E, on, durOf(d), c.cfg) };
    });
  const segs = new Map<number, DisplacedSegment>();
  for (const d of disp) {
    const t = c.truthById.get(d.id)!;
    if (t.kind !== 'displaced') continue;
    const s = segs.get(t.seg) ?? { fromIdx: t.idx, toIdx: t.idx, offsetBeats: t.offsetBeats, detectedIds: [] };
    s.fromIdx = Math.min(s.fromIdx, t.idx);
    s.toIdx = Math.max(s.toIdx, t.idx);
    s.detectedIds.push(d.id);
    segs.set(t.seg, s);
  }
  return { judgments, extras, displaced: [...segs.values()].map((s) => ({ ...s, detectedIds: s.detectedIds.sort((a, b) => a - b) })) };
}
