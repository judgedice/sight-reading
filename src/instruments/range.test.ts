import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import type { Instrument } from '../core/types.ts';
import { copy, isCopyKey } from '../ui/copy/copy.ts';
import { getInstrument } from './index.ts';
import {
  keyboardSpan,
  ledgerLinesAt,
  noteName,
  pictureNotes,
  rangeModel,
  rulerFraction,
  servedWrittenRange,
  staffPlan,
  tierAt,
  transpositionKind,
  type RangeText,
} from './range.ts';

const cfg = configs();
const inst = (id: string): Instrument => getInstrument(cfg, id);

/** Formats a range line the way the UI does (keyVars are copy keys formatted first). */
function fmt(t: RangeText, extra: Record<string, string> = {}): string {
  expect(isCopyKey(t.key)).toBe(true);
  const vars: Record<string, string | number> = { ...t.vars, ...extra };
  for (const [k, v] of Object.entries(t.keyVars ?? {})) {
    expect(isCopyKey(v)).toBe(true);
    vars[k] = copy(v as never);
  }
  return copy(t.key as never, vars);
}

/** Baritone as proposed in 05 section 6.5 (the voices package adds it to config/instruments.json). */
const baritone: Instrument = {
  ...inst('voice-bass'),
  id: 'voice-baritone',
  label: 'Voice (baritone)',
  fullWrittenRange: [43, 67],
  tiers: { A: [48, 60], B: [45, 62], C: [43, 64], D: [43, 65], E: [43, 67] },
};

describe('note names', () => {
  it('uses real accidental glyphs and the C major spelling', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(58)).toBe('B♭3');
    expect(noteName(78)).toBe('F♯5');
    expect(noteName(61)).toBe('C♯4');
    expect(noteName(63)).toBe('E♭4');
    expect(noteName(68)).toBe('A♭4');
    expect(noteName(63, true)).toBe('D♯4');
    expect(noteName(21)).toBe('A0');
  });
});

describe('served range', () => {
  it('reads the tier from levels.json', () => {
    for (const l of cfg.levels.levels) expect(tierAt(cfg, l.level)).toBe(l.tier);
    expect(servedWrittenRange(cfg, inst('flute'), 5)).toEqual(inst('flute').tiers[cfg.levelByNumber[5]!.tier]);
    expect(() => tierAt(cfg, 11)).toThrow(RangeError);
  });

  it('follows a changed tier in config, not the level number', () => {
    const levels = cfg.levels.levels.map((l) => (l.level === 2 ? { ...l, tier: 'B' as const } : l));
    const changed = { ...cfg, levelByNumber: Object.fromEntries(levels.map((l) => [l.level, l])) };
    expect(servedWrittenRange(changed, inst('flute'), 2)).toEqual(inst('flute').tiers.B);
  });
});

describe('range model text', () => {
  it('tenor: sung A2 to A4, written an octave higher', () => {
    const m = rangeModel(cfg, inst('voice-tenor'), 2);
    expect(m.names.full).toEqual(['A2', 'A4']);
    expect(m.written.full).toEqual([57, 81]);
    expect(m.transposition).toEqual({ kind: 'voice-octave' });
    expect(m.cardNote && fmt(m.cardNote)).toBe('Written an octave higher');
    expect(m.lines.map((l) => fmt(l))).toEqual([
      'Full range: A2 to A4',
      'At difficulty 2: D3 to D4',
      'Written an octave higher',
      'Sing in any octave that suits you. Pitch is marked relative to your starting note.',
    ]);
    expect(m.firstClef).toBe('treble-8vb');
  });

  it('clarinet: sounds a major 2nd lower, concert range', () => {
    const m = rangeModel(cfg, inst('clarinet-bb'), 2);
    expect(m.transposition).toEqual({ kind: 'simple', direction: 'lower', interval: 'major2' });
    expect(m.names.full).toEqual(['E3', 'G6']);
    expect(fmt(m.lines[2]!)).toBe('Sounds a major 2nd lower: concert D3 to F6');
    expect(fmt(m.cardNote!).startsWith('Sounds a major 2nd lower')).toBe(true);
  });

  it('names octave and compound transpositions', () => {
    expect(fmt(rangeModel(cfg, inst('guitar'), 1).lines[2]!)).toBe('Sounds an octave lower: E2 to B4');
    expect(transpositionKind(inst('sax-tenor'))).toEqual({ kind: 'compound', direction: 'lower', interval: 'major2', octaves: 1 });
    expect(fmt(rangeModel(cfg, inst('sax-tenor'), 1).lines[2]!)).toBe('Sounds an octave and a major 2nd lower: concert A♭2 to E5');
    expect(fmt(rangeModel(cfg, inst('sax-alto'), 1).lines[2]!)).toBe('Sounds a major 6th lower: concert C♯3 to A5');
    expect(fmt(rangeModel(cfg, inst('horn-f'), 1).lines[2]!)).toBe('Sounds a perfect 5th lower: concert B1 to F5');
    expect(transpositionKind(inst('flute'))).toEqual({ kind: 'none' });
    expect(rangeModel(cfg, inst('flute'), 1).lines).toHaveLength(2);
  });

  it('baritone: G2 to G4, C3 to C4 at difficulty 2', () => {
    const m = rangeModel(cfg, baritone, 2);
    expect(m.lines.slice(0, 2).map((l) => fmt(l))).toEqual(['Full range: G2 to G4', 'At difficulty 2: C3 to C4']);
    expect(fmt(m.servedLine)).toBe('At difficulty 2: C3 to C4');
    expect(fmt(m.a11y, { instrument: 'Baritone voice' })).toBe('Baritone voice range: G2 to G4. At difficulty 2: C3 to C4.');
    expect(m.cardNote).toBeNull();
    expect(fmt(m.lines[2]!)).toBe('Sing in any octave that suits you. Pitch is marked relative to your starting note.');
  });
});

describe('staff plan', () => {
  it('counts ledger lines from the staff', () => {
    expect([0, 4, 5, 6, 7, 8, 12, -5, -6, -8].map(ledgerLinesAt)).toEqual([0, 0, 0, 1, 1, 2, 4, 0, 1, 2]);
  });

  it('baritone: four notes in bass clef, no clef change', () => {
    const m = rangeModel(cfg, baritone, 2);
    const plan = staffPlan(baritone, pictureNotes(m));
    expect(plan.firstClef).toBe('bass');
    expect(plan.notes.map((n) => n.label)).toEqual(['G2', 'C3', 'C4', 'G4']);
    expect(plan.notes.every((n) => n.clef === 'bass' && !n.clefChange && n.octaveMark === null)).toBe(true);
    expect(plan.notes.map((n) => n.position)).toEqual([-4, -1, 6, 10]);
    expect(plan.notes.map((n) => n.ledgerLines)).toEqual([0, 0, 1, 3]);
  });

  it('cello: A5 drawn after a change to treble clef', () => {
    const m = rangeModel(cfg, inst('cello'), 9);
    expect(m.names.full).toEqual(['E2', 'A5']);
    const plan = staffPlan(inst('cello'), pictureNotes(m));
    const top = plan.notes[3]!;
    expect(top.label).toBe('A5');
    expect(top.clefChange).toBe(true);
    expect(top.clef).toBe('treble');
    expect(top.octaveMark).toBeNull();
    expect(top.ledgerLines).toBe(1);
    expect(plan.notes[0]!.clef).toBe('bass');
  });

  it('uses 8va when no higher clef is listed, and keeps the written name', () => {
    const plan = staffPlan(inst('flute'), [96]);
    expect(plan.notes[0]).toMatchObject({ label: 'C7', clef: 'treble', octaveMark: '8va', clefChange: false });
    expect(plan.notes[0]!.ledgerLines).toBeLessThanOrEqual(4);
  });

  it('uses 8vb below the staff', () => {
    const plan = staffPlan(inst('tuba'), [26]);
    expect(plan.notes[0]).toMatchObject({ label: 'D1', clef: 'bass', octaveMark: '8vb' });
    expect(plan.notes[0]!.ledgerLines).toBeLessThanOrEqual(4);
  });

  it('draws the tenor in treble-8vb at written pitch and names the sung note', () => {
    const plan = staffPlan(inst('voice-tenor'), [57]);
    expect(plan.notes[0]).toMatchObject({ label: 'A2', clef: 'treble-8vb', position: -8, ledgerLines: 2 });
  });

  it('never draws more than four ledger lines for any instrument and difficulty', () => {
    for (const i of cfg.instruments.instruments) {
      for (let l = 1; l <= 10; l++) {
        for (const n of staffPlan(i, pictureNotes(rangeModel(cfg, i, l))).notes) expect(n.ledgerLines).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('keyboard strip and ruler', () => {
  it('voices span C2 to C5, widened to C', () => {
    const b = keyboardSpan(rangeModel(cfg, baritone, 2), baritone);
    expect([b.low, b.high]).toEqual([36, 72]);
    expect(b.served).toEqual([48, 60]);
    expect(b.middleC).toBe(60);
    expect(b.cs).toEqual([36, 48, 60, 72]);
    const s = keyboardSpan(rangeModel(cfg, inst('voice-soprano'), 2), inst('voice-soprano'));
    expect([s.low, s.high]).toEqual([36, 84]);
  });

  it('other instruments round their sounding range out to C', () => {
    const k = keyboardSpan(rangeModel(cfg, inst('clarinet-bb'), 1), inst('clarinet-bb'));
    expect([k.low, k.high]).toEqual([48, 96]);
    expect(k.full).toEqual([50, 89]);
  });

  it('places notes on the shared C1 to C8 axis', () => {
    expect(rulerFraction(24)).toBe(0);
    expect(rulerFraction(108)).toBe(1);
    expect(rulerFraction(60)).toBeCloseTo(36 / 84);
    expect(rulerFraction(0)).toBe(0);
  });
});
