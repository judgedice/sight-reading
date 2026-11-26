import type { Clef } from '../../../core/types.ts';
import type { StaffNote } from '../../../instruments/range.ts';
import { noteLetter } from '../../../notation/note-colours.ts';

/** Staff space in viewBox units. */
const S = 10;
const WIDTH = 15 * S;
const NOTE_X = 9.5 * S;
const HEAD_HALF = 0.844 * S;
const FONT = 4 * S;

/** SMuFL code points (Bravura), as the range picture. */
const GLYPH = { gClef: '', gClef8vb: '', cClef: '', fClef: '', wholeNote: '', ottavaAlta: '', ottavaBassaVb: '' } as const;
/** Accidentals for the heard note (SMuFL): flat and sharp, by alteration; a natural note needs none here. */
const ACCIDENTAL: Partial<Record<number, string>> = { [-1]: '\ue260', 1: '\ue262' };
/** Where the heard note sits: beside the target, to its right. */
const HEARD_X = 13.6 * S;

function clefGlyph(clef: Clef): { glyph: string; position: number } {
  switch (clef) {
    case 'treble':
      return { glyph: GLYPH.gClef, position: -2 };
    case 'treble-8vb':
      return { glyph: GLYPH.gClef8vb, position: -2 };
    case 'bass':
      return { glyph: GLYPH.fClef, position: 2 };
    case 'alto':
      return { glyph: GLYPH.cClef, position: 0 };
    case 'tenor':
      return { glyph: GLYPH.cClef, position: 2 };
  }
}

export type StaffRing = 'playing' | 'hit' | null;

/**
 * The target on a small staff with no barline (04-design §4): the clef and one whole note. A brass ring while the note
 * plays, a green one after a hit. Decorative: the note name beside it carries the meaning. `heard`: after a hold, the
 * note the player settled on, drawn grey beside the target (03-pitch-steadiness §6.3; the "You sang" line says it).
 */
export function MatchStaff({ note, ring, heard = null }: { note: StaffNote; ring: StaffRing; heard?: StaffNote | null }) {
  const reach = Math.max(4, Math.abs(note.position) + 3, heard ? Math.abs(heard.position) + 3 : 0);
  const up = (reach * S) / 2 + 2 * S;
  const height = 2 * up;
  const yOf = (p: number): number => up - (p * S) / 2;
  const clef = clefGlyph(note.clef);
  const y = yOf(note.position);
  const sign = note.position > 0 ? 1 : -1;
  const ledgers = Array.from({ length: note.ledgerLines }, (_, k) => sign * (4 + 2 * (k + 1)));
  const heardY = heard ? yOf(heard.position) : 0;
  const heardLedgers = heard ? Array.from({ length: heard.ledgerLines }, (_, k) => (heard.position > 0 ? 1 : -1) * (4 + 2 * (k + 1))) : [];
  const accidental = heard ? ACCIDENTAL[heard.pitch.alter] : undefined;
  return (
    <svg className="mt-staff" viewBox={`0 0 ${WIDTH} ${height}`} aria-hidden="true" focusable="false" data-testid="match-staff" data-ring={ring ?? 'none'}>
      {[4, 2, 0, -2, -4].map((p) => (
        <line key={p} className="mt-staff-line" x1={0} x2={WIDTH} y1={yOf(p)} y2={yOf(p)} />
      ))}
      <text className="mt-glyph" x={0.6 * S} y={yOf(clef.position)} fontSize={FONT}>
        {clef.glyph}
      </text>
      {ring ? <circle className={`mt-ring mt-ring-${ring}`} cx={NOTE_X} cy={y} r={2.6 * S} /> : null}
      {ledgers.map((p) => (
        <line key={p} className="mt-ledger" x1={NOTE_X - 1.3 * S} x2={NOTE_X + 1.3 * S} y1={yOf(p)} y2={yOf(p)} />
      ))}
      <text className={`mt-glyph mt-head${ring === 'hit' ? ' mt-head-hit' : ''}`} data-letter={noteLetter(note.pitch)} x={NOTE_X - HEAD_HALF} y={y} fontSize={FONT}>
        {GLYPH.wholeNote}
      </text>
      {heard ? (
        <g className="mt-heard" data-testid="match-heard" data-letter={noteLetter(heard.pitch)}>
          {heardLedgers.map((p) => (
            <line key={p} className="mt-ledger mt-ledger-heard" x1={HEARD_X - 1.3 * S} x2={HEARD_X + 1.3 * S} y1={yOf(p)} y2={yOf(p)} />
          ))}
          {accidental ? (
            <text className="mt-glyph mt-head-heard" x={HEARD_X - HEAD_HALF - 1.1 * S} y={heardY} fontSize={FONT}>
              {accidental}
            </text>
          ) : null}
          <text className="mt-glyph mt-head-heard" x={HEARD_X - HEAD_HALF} y={heardY} fontSize={FONT}>
            {GLYPH.wholeNote}
          </text>
        </g>
      ) : null}
      {note.octaveMark ? (
        <text className="mt-glyph" x={NOTE_X} y={note.octaveMark === '8va' ? Math.min(yOf(4) - 1.2 * S, y - 2.6 * S) : Math.max(yOf(-4) + 3 * S, y + 3.8 * S)} fontSize={FONT * 0.8} textAnchor="middle">
          {note.octaveMark === '8va' ? GLYPH.ottavaAlta : GLYPH.ottavaBassaVb}
        </text>
      ) : null}
    </svg>
  );
}
