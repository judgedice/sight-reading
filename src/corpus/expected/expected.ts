/**
 * `buildExpectedNotes` (01 §5.5, §6.4; PLAN ruling 14): the take's expected notes from a prepared excerpt and a
 * tempo. One expected note per tie chain, in event order; a rest ends a chain. The per-note rules follow the P0e
 * goldens in fixtures/expected/ (their interpretations are documented in tools/fixtures/expected.py):
 * - bar is the displayed bar (pickup 0); beatInBar is 1-based in count units; onsetBeat is zero at bar 1 beat 1
 *   and negative in the pickup. Beats are count units, so 6/8 counts dotted quarters.
 * - onsetKind: 'repeat' (same concert pitch as the previous note, not after a rest) takes precedence over
 *   'slurred' (inside a slur, from the second note on), else 'articulated'.
 * - artic: staccato, else accent (accent or marcato), else tenuto, else normal; read from the first event of a chain.
 * - durationGraded: chain length at least the grading minimum, not staccato, not the last note, and the
 *   instrument is neither keyboard nor guitar family.
 * - keySigAltered: the written alteration equals the key signature's for that letter and is not natural.
 *   explicitAccidental: the written alteration differs from the key signature's.
 * - ledgerLines: written pitch against the clef.
 */
import type { CorpusApi } from '../../core/api.ts';
import type { Clef, ExpectedNote, PreparedNoteEvt, SpelledPitch, Step } from '../../core/types.ts';
import { toMidi } from '../../theory/index.ts';

const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

/** Alteration a key signature gives a letter. */
function keyAlter(fifths: number, step: Step): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return [...SHARP_ORDER].reverse().slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** Diatonic index (octave * 7 + letter) of the bottom staff line; treble-8vb reads on treble lines. */
const BOTTOM_LINE: Record<Clef, number> = { treble: 4 * 7 + 2, 'treble-8vb': 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 };

/** Ledger lines a written pitch needs on the clef's staff. */
function ledgerLines(p: SpelledPitch, clef: Clef): number {
  const d = p.octave * 7 + STEPS.indexOf(p.step);
  const bottom = BOTTOM_LINE[clef];
  if (d < bottom) return Math.floor((bottom - d) / 2);
  if (d > bottom + 8) return Math.floor((d - bottom - 8) / 2);
  return 0;
}

interface Chain {
  ids: string[];
  first: PreparedNoteEvt;
  displayBar: number;
  barStartTick: number;
  durTicks: number;
  slurOpen: boolean;
  precededByRest: boolean;
  followedByRest: boolean;
}

export const buildExpectedNotes: CorpusApi['buildExpectedNotes'] = (p, bpm, cfg) => {
  if (!(bpm > 0)) throw new RangeError(`bpm must be positive, got ${bpm}`);
  const inst = cfg.instrumentById[p.instrumentId];
  if (!inst) throw new Error(`unknown instrument ${p.instrumentId}`);
  const unit = p.meter.countUnitTicks;
  const barTicks = unit * p.meter.countsPerBar;

  const chains: Chain[] = [];
  let cur: Chain | null = null;
  let prevWasRest = false;
  let depth = 0;
  for (const m of p.measures) {
    const barStartTick = m.isPickup ? m.startTick - (barTicks - p.pickupTicks) : m.startTick;
    for (const e of m.events) {
      if (e.kind === 'rest') {
        const last = chains[chains.length - 1];
        if (last && !prevWasRest) last.followedByRest = true;
        cur = null;
        prevWasRest = true;
        continue;
      }
      const before = depth;
      if (e.slur === 'stop' || e.slur === 'continue') depth--;
      if (e.slur === 'start' || e.slur === 'continue') depth++;
      if (cur && e.tieStop) {
        cur.ids.push(e.id);
        cur.durTicks += e.dur;
      } else {
        cur = {
          ids: [e.id],
          first: e,
          displayBar: m.displayBar,
          barStartTick,
          durTicks: e.dur,
          slurOpen: before > 0,
          precededByRest: prevWasRest,
          followedByRest: false,
        };
        chains.push(cur);
      }
      prevWasRest = false;
      if (!e.tieStart) cur = null;
    }
  }

  const minBeats = cfg.grading.credit.duration.minBeats;
  const noDuration = inst.family === 'keyboard' || inst.family === 'guitar';
  const out: ExpectedNote[] = chains.map((c, n) => {
    const e = c.first;
    const durBeats = c.durTicks / unit;
    const onsetBeat = (e.tick - p.pickupTicks) / unit;
    const midi = toMidi(e.concertPitch);
    const prev = chains[n - 1];
    const a = e.artic ?? [];
    const artic: ExpectedNote['artic'] = a.includes('staccato') ? 'staccato' : a.includes('accent') || a.includes('marcato') ? 'accent' : a.includes('tenuto') ? 'tenuto' : 'normal';
    const w: SpelledPitch = e.writtenPitch;
    const ks = keyAlter(p.writtenKey.fifths, w.step);
    const onsetKind: ExpectedNote['onsetKind'] = prev && toMidi(prev.first.concertPitch) === midi && !c.precededByRest ? 'repeat' : c.slurOpen ? 'slurred' : 'articulated';
    return {
      idx: n,
      eventIds: c.ids,
      bar: c.displayBar,
      beatInBar: 1 + (e.tick - c.barStartTick) / unit,
      onsetBeat,
      durBeats,
      onsetSec: (onsetBeat * 60) / bpm,
      durSec: (durBeats * 60) / bpm,
      concertMidi: midi,
      writtenPitch: w,
      ioiPrevSec: null,
      ioiNextSec: null,
      precededByRest: c.precededByRest,
      followedByRest: c.followedByRest,
      onsetKind,
      artic,
      durationGraded: durBeats >= minBeats && artic !== 'staccato' && n !== chains.length - 1 && !noDuration,
      keySigAltered: ks !== 0 && w.alter === ks,
      explicitAccidental: w.alter !== ks,
      ledgerLines: ledgerLines(w, p.clef),
    };
  });
  for (let i = 1; i < out.length; i++) {
    const ioi = out[i]!.onsetSec - out[i - 1]!.onsetSec;
    out[i - 1]!.ioiNextSec = ioi;
    out[i]!.ioiPrevSec = ioi;
  }
  return out;
};
