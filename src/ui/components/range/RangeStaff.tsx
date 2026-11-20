import type { Clef } from '../../../core/types.ts';
import type { StaffNoteView, StaffView } from './types.ts';

/** Staff space in viewBox units. The SVG scales to its container, so a 350-unit picture at 384 px is 11 px a space. */
export const S = 10;
/** Picture width in staff spaces (06 section 6.10; the mockup column is 384 px at 11 px a space). */
export const WIDTH_SPACES = 35;
/** Where the whole notes sit in the space after the clef (06 section 6.10). */
export const NOTE_SLOTS: readonly number[] = [0.08, 0.36, 0.64, 0.92];
const SLOT_START = 4.4 * S;
const SLOT_END = 32.8 * S;
/** Least room above the top line and below the bottom line, so most pictures share one height (mockup: 4.6 spaces). */
const MIN_PAD = 4.6 * S;
const HEAD_HALF_WIDTH = 0.844 * S;
const LEDGER_HALF_WIDTH = 1.3 * S;
const FONT_SIZE = 4 * S;

/** SMuFL code points (Bravura). */
const GLYPH = {
  gClef: '',
  gClef8vb: '',
  cClef: '',
  fClef: '',
  wholeNote: '',
  ottavaAlta: '',
  ottavaBassaVb: '',
} as const;

/** The clef glyph and the staff position (half spaces from the middle line) its baseline sits on. */
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

/** x of a slot's note centre, in viewBox units. */
export function slotCentre(slot: number): number {
  return SLOT_START + (NOTE_SLOTS[slot] ?? 0) * (SLOT_END - SLOT_START);
}

/** Vertical extent of a note above (+) and below (−) the middle line, in viewBox units, marks included. */
function noteExtent(n: StaffNoteView): { up: number; down: number } {
  const y = (n.position * S) / 2;
  let up = y + S / 2;
  let down = y - S / 2;
  // The mark's baseline (see `markBaseline`) plus the glyph's own height above it.
  if (n.octaveMark === '8va') up = Math.max(y + 1.6 * S, 3.2 * S) + 1.6 * S;
  if (n.octaveMark === '8vb') down = -Math.max(-y + 2.8 * S, 5 * S) - 0.4 * S;
  return { up, down };
}

export interface StaffGeometry {
  width: number;
  height: number;
  /** y of the middle line. */
  mid: number;
}

/** The picture's size: the staff with at least 4.6 spaces above and below, more when a note or mark needs it. */
export function staffGeometry(staff: StaffView): StaffGeometry {
  let up = 2 * S + MIN_PAD;
  let down = -(2 * S + MIN_PAD);
  for (const n of staff.notes) {
    const e = noteExtent(n);
    up = Math.max(up, e.up + 0.4 * S);
    down = Math.min(down, e.down - 0.4 * S);
  }
  return { width: WIDTH_SPACES * S, height: up - down, mid: up };
}

function Ledgers({ n, x }: { n: StaffNoteView; x: number }) {
  if (n.ledgerLines === 0) return null;
  const sign = n.position > 0 ? 1 : -1;
  const lines = Array.from({ length: n.ledgerLines }, (_, k) => sign * (4 + 2 * (k + 1)));
  // Drawn relative to the note's own baseline, so the group can move as one.
  return (
    <>
      {lines.map((p) => {
        const dy = ((n.position - p) * S) / 2;
        return <line key={p} x1={x - LEDGER_HALF_WIDTH} x2={x + LEDGER_HALF_WIDTH} y1={dy} y2={dy} className="rp-ledger" />;
      })}
    </>
  );
}

export interface RangeStaffProps {
  /** Slot (0 to 3) of the note that sounds now: its head turns brass with a soft halo. */
  lit?: number | null;
  staff: StaffView;
  /** Hide the served notes and band (served data not loaded yet, 05 section 8.2). */
  showServed?: boolean;
}

/**
 * The large staff (05 section 7.4, 06 section 6.10): first clef, the served band, four whole notes (full in
 * `range-full`, served in `ink`), ledger lines in the note's colour, a clef change or an 8va or 8vb mark where the
 * range model says so. Decorative: the note buttons and the legend carry the meaning. Served notes move by a CSS
 * transform, so a difficulty change animates over `--dur-base` and jumps under reduced motion.
 */
export function RangeStaff({ staff, showServed = true, lit = null }: RangeStaffProps) {
  const g = staffGeometry(staff);
  const yOf = (position: number): number => g.mid - (position * S) / 2;
  const top = yOf(4);
  const bottom = yOf(-4);
  const first = clefGlyph(staff.firstClef);
  const bandLeft = slotCentre(1) - HEAD_HALF_WIDTH - 0.6 * S;
  const bandRight = slotCentre(2) + HEAD_HALF_WIDTH + 0.6 * S;
  let drawnClef: Clef = staff.firstClef;
  return (
    <svg
      className="rp-staff"
      viewBox={`0 0 ${g.width} ${g.height}`}
      width={g.width}
      height={g.height}
      aria-hidden="true"
      focusable="false"
      data-testid="range-staff"
    >
      {showServed ? (
        <rect
          className="rp-band"
          x={bandLeft}
          y={top - 2.2 * S}
          width={bandRight - bandLeft}
          height={bottom - top + 4.4 * S}
          rx={0.8 * S}
          data-testid="range-band"
        />
      ) : null}
      {[4, 2, 0, -2, -4].map((p) => (
        <line key={p} className="rp-staff-line" x1={0} x2={g.width} y1={yOf(p)} y2={yOf(p)} />
      ))}
      <text className="rp-glyph rp-clef" x={0.6 * S} y={yOf(first.position)} fontSize={FONT_SIZE}>
        {first.glyph}
      </text>
      {staff.notes.map((n, slot) => {
        const served = slot === 1 || slot === 2;
        if (served && !showServed) return null;
        const x = slotCentre(slot);
        const y = yOf(n.position);
        const change = n.clef !== drawnClef;
        drawnClef = n.clef;
        const changeGlyph = change ? clefGlyph(n.clef) : null;
        return (
          <g
            key={slot}
            className={[served ? 'rp-note rp-note-served' : 'rp-note rp-note-full', lit === slot ? 'rp-note-lit' : null].filter(Boolean).join(' ')}
            style={{ transform: `translateY(${y}px)` }}
            data-testid={`range-note-${slot}`}
            data-midi={n.midi}
          >
            {changeGlyph ? (
              <text
                className="rp-glyph"
                x={x - HEAD_HALF_WIDTH - 2.6 * S}
                y={((n.position - changeGlyph.position) * S) / 2}
                fontSize={FONT_SIZE * 0.75}
                data-testid="range-clef-change"
              >
                {changeGlyph.glyph}
              </text>
            ) : null}
            {lit === slot ? <circle className="rp-halo" cx={x} cy={0} r={1.5 * S} data-testid="range-halo" /> : null}
            <Ledgers n={n} x={x} />
            <text className="rp-glyph" x={x - HEAD_HALF_WIDTH} y={0} fontSize={FONT_SIZE}>
              {GLYPH.wholeNote}
            </text>
            {n.octaveMark ? (
              <text
                className="rp-glyph rp-octave"
                x={x}
                y={n.octaveMark === '8va' ? Math.min(top - 1.2 * S, y - 1.6 * S) - y : Math.max(bottom + 3 * S, y + 2.8 * S) - y}
                fontSize={FONT_SIZE * 0.8}
                textAnchor="middle"
                data-testid="range-octave-mark"
              >
                {n.octaveMark === '8va' ? GLYPH.ottavaAlta : GLYPH.ottavaBassaVb}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
