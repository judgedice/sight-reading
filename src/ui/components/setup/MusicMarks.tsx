import type { Clef } from '../../../core/types.ts';
import { tokens } from '../../tokens.ts';
import { MUSIC_GLYPHS, type MusicGlyphName } from './music-glyphs.ts';

/** Font units per staff space (SMuFL: one em is four staff spaces, Bravura has 1000 units per em). */
const UNITS_PER_SPACE = 250;
const r2 = (n: number): number => Math.round(n * 100) / 100;

function glyph(name: MusicGlyphName, x: number, y: number, sp: number, key?: string) {
  const s = r2(sp / UNITS_PER_SPACE);
  return <path key={key} d={MUSIC_GLYPHS[name].d} transform={`translate(${r2(x)} ${r2(y)}) scale(${s})`} />;
}

/** Staff step (half staff spaces above the bottom line) of each signature accidental, in order. */
const SHARP_STEPS: Record<Clef, readonly number[]> = {
  treble: [8, 5, 9, 6, 3, 7, 4],
  'treble-8vb': [8, 5, 9, 6, 3, 7, 4],
  bass: [6, 3, 7, 4, 1, 5, 2],
  alto: [7, 4, 8, 5, 2, 6, 3],
  tenor: [2, 6, 3, 7, 4, 8, 5],
};
const FLAT_STEPS: Record<Clef, readonly number[]> = {
  treble: [4, 7, 3, 6, 2, 5, 1],
  'treble-8vb': [4, 7, 3, 6, 2, 5, 1],
  bass: [2, 5, 1, 4, 0, 3, -1],
  alto: [3, 6, 2, 5, 1, 4, 0],
  tenor: [5, 8, 4, 7, 3, 6, 2],
};
const CLEF_GLYPH: Record<Clef, { name: MusicGlyphName; step: number }> = {
  treble: { name: 'gClef', step: 2 },
  'treble-8vb': { name: 'gClef8vb', step: 2 },
  bass: { name: 'fClef', step: 6 },
  alto: { name: 'cClef', step: 4 },
  tenor: { name: 'cClef', step: 6 },
};
/** Room above and below the staff in staff spaces (06 section 6.3: 2.4 and 2 for treble, 1.6 and 1.6 for bass). */
const PAD: Record<Clef, { top: number; bottom: number }> = {
  treble: { top: 2.4, bottom: 2 },
  'treble-8vb': { top: 2.4, bottom: 2.7 },
  bass: { top: 1.6, bottom: 1.6 },
  alto: { top: 1.6, bottom: 1.6 },
  tenor: { top: 1.6, bottom: 1.6 },
};

/** Drawn long and clipped by the chip, so the staff spans the chip at any width (06 section 6.3, critique C3). */
const MINI_STAFF_WIDTH = 480;

export interface MiniKeyStaffProps {
  clef: Clef;
  /** Key signature on the line of fifths: positive sharps, negative flats. */
  fifths: number;
  /** Staff space in CSS px. Default the `key-chip-staff-space` token (6.5). Never scaled to fit. */
  staffSpace?: number;
}

/** A decorative five-line staff with the clef and key signature, for key chips. */
export function MiniKeyStaff({ clef, fifths, staffSpace = tokens.component['key-chip-staff-space'] }: MiniKeyStaffProps) {
  const sp = staffSpace;
  const pad = PAD[clef];
  const top = pad.top * sp;
  const bottom = top + 4 * sp;
  const yOf = (step: number): number => bottom - (step * sp) / 2;
  const height = r2(bottom + pad.bottom * sp);
  const count = Math.min(7, Math.abs(fifths));
  const steps = (fifths > 0 ? SHARP_STEPS : FLAT_STEPS)[clef].slice(0, count);
  const c = CLEF_GLYPH[clef];
  return (
    <span className="su-mini-key" aria-hidden="true">
      <svg width={MINI_STAFF_WIDTH} height={height} viewBox={`0 0 ${MINI_STAFF_WIDTH} ${height}`} focusable="false" fill="currentColor">
        <g className="su-mini-key-lines" stroke="currentColor" strokeWidth={1}>
          {[0, 1, 2, 3, 4].map((l) => (
            <line key={l} x1={0} x2={MINI_STAFF_WIDTH} y1={r2(top + l * sp)} y2={r2(top + l * sp)} />
          ))}
        </g>
        {glyph(c.name, 0.25 * sp, yOf(c.step), sp)}
        {steps.map((s, i) => glyph(fifths > 0 ? 'sharp' : 'flat', 4.2 * sp + i * 1.15 * sp, yOf(s), sp, String(i)))}
      </svg>
    </span>
  );
}

export interface TimeSignatureMarkProps {
  beats: number;
  unit: number;
  /** Staff space in CSS px. Default the `time-glyph-staff-space` token (7.5): numerals about 30 px tall. */
  staffSpace?: number;
}

function digits(n: number): MusicGlyphName[] {
  return String(n)
    .split('')
    .map((d) => `timeSig${d}` as MusicGlyphName);
}

/** Stacked time-signature numerals in Bravura, decorative (the segment carries the spoken name). */
export function TimeSignatureMark({ beats, unit, staffSpace = tokens.component['time-glyph-staff-space'] }: TimeSignatureMarkProps) {
  const sp = staffSpace;
  const s = sp / UNITS_PER_SPACE;
  const rows = [digits(beats), digits(unit)];
  const widths = rows.map((row) => row.reduce((w, g) => w + MUSIC_GLYPHS[g].advance * s, 0));
  const width = r2(Math.max(...widths));
  const height = 4 * sp;
  return (
    <svg className="su-time-mark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" fill="currentColor">
      {rows.map((row, ri) => {
        let x = (width - widths[ri]!) / 2;
        return row.map((g, gi) => {
          const el = glyph(g, x, (ri === 0 ? 1 : 3) * sp, sp, `${ri}-${gi}`);
          x += MUSIC_GLYPHS[g].advance * s;
          return el;
        });
      })}
    </svg>
  );
}
