/**
 * Expected notes for the follow and grade fixtures (01 §6.4), built with the same rules as P0e's
 * `tools/fixtures/expected.py` (transposition plan, tempo choice, tie chains, onsetKind, durationGraded, key
 * signature flags, ledger lines). `fixtures/follow/gen/gen.test.ts` proves this port reproduces every golden in
 * `fixtures/expected/` exactly, so a fixture that uses another instrument, clef or tempo is "built by the same
 * function" (01 §14 item 9).
 *
 * Differences from the golden builder, both explicit parameters: `bpm` may be chosen by the fixture (the goldens
 * use the level minimum), and the clef is the instrument's clef for the level (the goldens are all treble).
 *
 * `syntheticExpected` builds expected notes for a written-out rhythm when no fixture-corpus excerpt has the
 * figure a case needs (02 §4.9 cases 5, 7, 9, 12). It applies the same per-note rules.
 */
import type {
  Clef,
  ExcerptDoc,
  ExpectedNote,
  GradingConfig,
  Instrument,
  Interval,
  KeySig,
  LevelsConfig,
  NoteEvt,
  SpelledPitch,
  Step,
} from '../../../src/core/types.ts';

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMIS: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const mod = (a: number, n: number): number => ((a % n) + n) % n;
export const midiOf = (p: SpelledPitch): number => (p.octave + 1) * 12 + STEP_SEMIS[p.step] + p.alter;

/** Alteration a key signature gives a letter. */
export function keyAlter(fifths: number, step: Step): number {
  const sharps: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  if (fifths > 0) return sharps.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return [...sharps].reverse().slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

function tonic(k: KeySig): { step: Step; alter: number } {
  let idx = k.mode === 'major' ? 0 : 5;
  for (let i = 0; i < Math.abs(k.fifths); i++) idx = (idx + (k.fifths > 0 ? 4 : 3)) % 7;
  const step = STEPS[idx] as Step;
  return { step, alter: keyAlter(k.fifths, step) };
}
const tonicPc = (k: KeySig): number => {
  const t = tonic(k);
  return mod(STEP_SEMIS[t.step] + t.alter, 12);
};

function intervalFifths(iv: Interval): number {
  for (let a = 0; a <= 12; a++)
    for (const f of a === 0 ? [0] : [-a, a]) if (mod(7 * f - iv.chromatic, 12) === 0 && mod(4 * f - iv.diatonic, 7) === 0) return f;
  throw new Error(`no fifths for ${JSON.stringify(iv)}`);
}

export function transpose(p: SpelledPitch, iv: Interval): SpelledPitch {
  const total = p.octave * 7 + STEPS.indexOf(p.step) + iv.diatonic;
  const step = STEPS[mod(total, 7)] as Step;
  const octave = Math.floor(total / 7);
  const alter = midiOf(p) + iv.chromatic - midiOf({ step, alter: 0, octave });
  if (Math.abs(alter) > 2) throw new Error('triple accidental');
  return { step, alter: alter as SpelledPitch['alter'], octave };
}

export interface Plan {
  writtenKey: KeySig;
  transposition: Interval;
  clef: Clef;
}

/** 03 §7.3 / §7.4 planning, as documented in tools/fixtures/expected.py. */
export function plan(d: ExcerptDoc, inst: Instrument, levels: LevelsConfig): Plan | null {
  const lv = levels.levels[d.level - 1]!;
  const band = inst.tiers[lv.tier];
  const I = inst.writtenMinusSounding;
  const mode = d.keyConcert.mode;
  if (!lv.writtenKeys.modes.includes(mode)) return null;
  const fI = intervalFifths(I);
  const { min: lo, max: hi } = d.rangeConcert;
  let best: { key: number[]; fw: number; iv: Interval } | null = null;
  const less = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
    return false;
  };
  for (let fw = -lv.writtenKeys.maxAccidentals; fw <= lv.writtenKeys.maxAccidentals; fw++) {
    const fc = fw - fI;
    if (Math.abs(fc) > 7) continue;
    const p = mod(tonicPc({ fifths: fc, mode }) - tonicPc(d.keyConcert), 12);
    let shift: { key: number[]; t: number; margin: number } | null = null;
    for (let k = -10; k <= 10; k++) {
      const t = p + 12 * k;
      if (t < band[0] - I.chromatic - lo || t > band[1] - I.chromatic - hi) continue;
      const margin = Math.min(lo + I.chromatic + t - band[0], band[1] - (hi + I.chromatic + t));
      const key = [-margin, Math.abs(t), t];
      if (!shift || less(key, shift.key)) shift = { key, t, margin };
    }
    if (!shift) continue;
    const ls = STEPS.indexOf(tonic(d.keyConcert).step);
    const lc = STEPS.indexOf(tonic({ fifths: fc, mode }).step);
    const iv: Interval = { diatonic: mod(lc - ls, 7) + 7 * ((shift.t - mod(shift.t, 12)) / 12), chromatic: shift.t };
    let spellOk = true;
    for (const n of d.measures.flatMap((m) => m.events).filter((e): e is NoteEvt => e.kind === 'note')) {
      try {
        const w = transpose(transpose(n.pitch, iv), I);
        if (Math.abs(w.alter) === 2 && d.level < 8) spellOk = false;
      } catch {
        spellOk = false;
      }
    }
    if (!spellOk) continue;
    const key = [-shift.margin, Math.abs(fw), fw];
    if (!best || less(key, best.key)) best = { key, fw, iv };
  }
  if (!best) return null;
  const clef = [...inst.clefs].filter((c) => c.fromLevel <= d.level).sort((a, b) => b.fromLevel - a.fromLevel)[0]?.clef ?? 'treble';
  return { writtenKey: { fifths: best.fw, mode }, transposition: best.iv, clef };
}

/** The golden tempo rule: the level minimum (dotted-quarter range for compound meters at L4/L5), or the excerpt minimum if inside. */
export function goldenBpm(d: ExcerptDoc, levels: LevelsConfig): number {
  const lv = levels.levels[d.level - 1]!;
  let { minBpm: lo, maxBpm: hi } = lv.tempo;
  const compound = d.meter.beatType === 8 && d.meter.beats >= 6 && d.meter.beats % 3 === 0;
  if (compound && levels.compound.dottedBeatLevels.includes(d.level)) ({ minBpm: lo, maxBpm: hi } = levels.compound.dottedBpm);
  return d.tempo.minBpm >= lo && d.tempo.minBpm <= hi ? d.tempo.minBpm : lo;
}

const STAFF_BOTTOM: Record<Clef, number> = { treble: 4 * 7 + 2, 'treble-8vb': 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 };
export function ledgers(p: SpelledPitch, clef: Clef): number {
  const d = p.octave * 7 + STEPS.indexOf(p.step);
  const bottom = STAFF_BOTTOM[clef];
  if (d < bottom) return Math.floor((bottom - d) / 2);
  if (d > bottom + 8) return Math.floor((d - bottom - 8) / 2);
  return 0;
}

/** One sounded note of a written-out line (tie chains already merged). */
export interface LineNote {
  /** Concert pitch. */
  concert: SpelledPitch;
  bar: number;
  beatInBar: number;
  onsetBeat: number;
  durBeats: number;
  eventIds: string[];
  precededByRest: boolean;
  followedByRest: boolean;
  slurOpen: boolean;
  artic: ExpectedNote['artic'];
}

/** The per-note rules shared by the excerpt and synthetic builders (01 §6.4, 02 §4.3). */
export function finishNotes(line: LineNote[], inst: Instrument, writtenKey: KeySig, clef: Clef, bpm: number, grading: GradingConfig): ExpectedNote[] {
  const out: ExpectedNote[] = line.map((c, n) => {
    const written = transpose(c.concert, inst.writtenMinusSounding);
    const cm = midiOf(c.concert);
    const prev = line[n - 1];
    const onsetKind: ExpectedNote['onsetKind'] = prev && midiOf(prev.concert) === cm && !c.precededByRest ? 'repeat' : c.slurOpen ? 'slurred' : 'articulated';
    const ks = keyAlter(writtenKey.fifths, written.step);
    return {
      idx: n,
      eventIds: c.eventIds,
      bar: c.bar,
      beatInBar: c.beatInBar,
      onsetBeat: c.onsetBeat,
      durBeats: c.durBeats,
      onsetSec: (c.onsetBeat * 60) / bpm,
      durSec: (c.durBeats * 60) / bpm,
      concertMidi: cm,
      writtenPitch: written,
      ioiPrevSec: null,
      ioiNextSec: null,
      precededByRest: c.precededByRest,
      followedByRest: c.followedByRest,
      onsetKind,
      artic: c.artic,
      durationGraded:
        c.durBeats >= grading.credit.duration.minBeats && c.artic !== 'staccato' && n !== line.length - 1 && inst.family !== 'keyboard' && inst.family !== 'guitar',
      keySigAltered: ks !== 0 && written.alter === ks,
      explicitAccidental: written.alter !== ks,
      ledgerLines: ledgers(written, clef),
    };
  });
  for (let i = 1; i < out.length; i++) {
    const ioi = out[i]!.onsetSec - out[i - 1]!.onsetSec;
    out[i - 1]!.ioiNextSec = ioi;
    out[i]!.ioiPrevSec = ioi;
  }
  return out;
}

/** Expected notes for a fixture-corpus excerpt, an instrument and a tempo (P0e's rules). */
export function excerptExpected(d: ExcerptDoc, inst: Instrument, pl: Plan, bpm: number, grading: GradingConfig): ExpectedNote[] {
  const unit = d.meter.countUnitTicks;
  const bt = d.meter.countUnitTicks * d.meter.countsPerBar;
  const flat = d.measures.flatMap((m) => m.events.map((e) => ({ m, e })));
  type Chain = { ids: string[]; first: NoteEvt; m: (typeof flat)[number]['m']; dur: number; firstIdx: number; lastIdx: number; slurOpen: boolean };
  const chains: Chain[] = [];
  let depth = 0;
  let cur: Chain | null = null;
  flat.forEach(({ m, e }, i) => {
    if (e.kind === 'rest') {
      cur = null;
      return;
    }
    const before = depth;
    if (e.slur === 'stop' || e.slur === 'continue') depth--;
    if (e.slur === 'start' || e.slur === 'continue') depth++;
    if (cur && e.tieStop) {
      cur.ids.push(e.id);
      cur.dur += e.dur;
      cur.lastIdx = i;
    } else {
      cur = { ids: [e.id], first: e, m, dur: e.dur, firstIdx: i, lastIdx: i, slurOpen: before > 0 };
      chains.push(cur);
    }
    if (!e.tieStart) cur = null;
  });
  const line: LineNote[] = chains.map((c) => {
    const e = c.first;
    const barStart = c.m.isPickup ? c.m.startTick - (bt - d.pickupTicks) : c.m.startTick;
    const a = e.artic ?? [];
    const prev = c.firstIdx > 0 ? flat[c.firstIdx - 1]!.e : null;
    const next = c.lastIdx + 1 < flat.length ? flat[c.lastIdx + 1]!.e : null;
    return {
      concert: transpose(e.pitch, pl.transposition),
      bar: d.pickupTicks ? c.m.index : c.m.index + 1,
      beatInBar: 1 + (e.tick - barStart) / unit,
      onsetBeat: (e.tick - d.pickupTicks) / unit,
      durBeats: c.dur / unit,
      eventIds: c.ids,
      precededByRest: prev?.kind === 'rest',
      followedByRest: next?.kind === 'rest',
      slurOpen: c.slurOpen,
      artic: a.includes('staccato') ? 'staccato' : a.includes('accent') || a.includes('marcato') ? 'accent' : a.includes('tenuto') ? 'tenuto' : 'normal',
    };
  });
  return finishNotes(line, inst, pl.writtenKey, pl.clef, bpm, grading);
}

/** A written-out note for `syntheticExpected`: written pitch, duration in beats; `rest` for a rest. */
export type SynthItem = { w: SpelledPitch; beats: number; slur?: boolean; artic?: ExpectedNote['artic'] } | { rest: number };

/**
 * Expected notes for a synthetic line in a simple meter starting on bar 1 beat 1 (no pickup). Pitches are
 * written; concert = written − the instrument's written-minus-sounding interval. Event ids are "s1", "s2", ...
 */
export function syntheticExpected(
  items: SynthItem[],
  beatsPerBar: number,
  inst: Instrument,
  writtenKey: KeySig,
  clef: Clef,
  bpm: number,
  grading: GradingConfig,
): ExpectedNote[] {
  const back: Interval = { diatonic: -inst.writtenMinusSounding.diatonic, chromatic: -inst.writtenMinusSounding.chromatic };
  const line: LineNote[] = [];
  let beat = 0;
  let id = 0;
  items.forEach((it, i) => {
    if ('rest' in it) {
      beat += it.rest;
      return;
    }
    const prev = items[i - 1];
    const next = items[i + 1];
    line.push({
      concert: transpose(it.w, back),
      bar: Math.floor(beat / beatsPerBar) + 1,
      beatInBar: 1 + mod(beat, beatsPerBar),
      onsetBeat: beat,
      durBeats: it.beats,
      eventIds: [`s${++id}`],
      precededByRest: prev !== undefined && 'rest' in prev,
      followedByRest: next !== undefined && 'rest' in next,
      slurOpen: it.slur === true && prev !== undefined && !('rest' in prev) && prev.slur === true,
      artic: it.artic ?? 'normal',
    });
    beat += it.beats;
  });
  return finishNotes(line, inst, writtenKey, clef, bpm, grading);
}

/** Parse "F#4", "Bb5", "C6", "Ebb4" into a spelled pitch. */
export function sp(s: string): SpelledPitch {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad pitch ${s}`);
  const acc = m[2] ?? '';
  const alter = (acc === '' ? 0 : acc.startsWith('#') ? acc.length : -acc.length) as SpelledPitch['alter'];
  return { step: m[1] as Step, alter, octave: Number(m[3]) };
}
