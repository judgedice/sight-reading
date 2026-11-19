/**
 * The cover's engraved clef, key signature and time signature (05 section 8.7), about three times staff size, closed
 * by a final barline as in the `cover-*` mockups. Drawn from the Bravura outlines the setup controls already ship, in
 * staff spaces; the size comes from the stylesheet (`--cover-staff-space`), so nothing here is in pixels.
 */
import type { CSSProperties } from 'react';
import type { Clef, KeySig, Meter } from '../../../core/types.ts';
import { MUSIC_GLYPHS, type MusicGlyphName } from '../../../ui/components/setup/music-glyphs.ts';

/** Drawing units per staff space (the viewBox is in these). */
const SP = 26;
/** Bravura font units per staff space. */
const UNITS = 250;
const r2 = (n: number): number => Math.round(n * 100) / 100;

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
const CLEF: Record<Clef, { name: MusicGlyphName; step: number }> = {
  treble: { name: 'gClef', step: 2 },
  'treble-8vb': { name: 'gClef8vb', step: 2 },
  bass: { name: 'fClef', step: 6 },
  alto: { name: 'cClef', step: 4 },
  tenor: { name: 'cClef', step: 6 },
};

/** Staff top, in staff spaces from the top of the drawing (room for the treble clef's head). */
const TOP_SP = 2;
const HEIGHT_SP = 8;

function glyph(name: MusicGlyphName, x: number, y: number, key: string) {
  return <path key={key} d={MUSIC_GLYPHS[name].d} transform={`translate(${r2(x)} ${r2(y)}) scale(${r2(SP / UNITS)})`} />;
}

function digits(n: number): MusicGlyphName[] {
  return String(n)
    .split('')
    .map((d) => `timeSig${d}` as MusicGlyphName);
}

export interface CoverSignatureProps {
  clef: Clef;
  keySig: KeySig;
  meter: Meter;
}

export function CoverSignature({ clef, keySig, meter }: CoverSignatureProps) {
  const top = TOP_SP * SP;
  const bottom = top + 4 * SP;
  const yOf = (step: number): number => bottom - (step * SP) / 2;
  const c = CLEF[clef];
  const clefX = 0.7 * SP;
  const clefW = (MUSIC_GLYPHS[c.name].advance / UNITS) * SP;
  const n = Math.min(7, Math.abs(keySig.fifths));
  const acc: MusicGlyphName = keySig.fifths > 0 ? 'sharp' : 'flat';
  const steps = (keySig.fifths > 0 ? SHARP_STEPS : FLAT_STEPS)[clef].slice(0, n);
  const keyX = clefX + clefW + 0.7 * SP;
  const accStep = 1.15 * SP;
  const timeX = keyX + n * accStep + (n > 0 ? 0.7 * SP : 0);
  const rows = [digits(meter.beats), digits(meter.beatType)];
  const rowW = rows.map((row) => row.reduce((w, g) => w + (MUSIC_GLYPHS[g].advance / UNITS) * SP, 0));
  const timeW = Math.max(...rowW);
  const barX = timeX + timeW + 2.95 * SP;
  const width = r2(barX + 0.75 * SP);
  const height = HEIGHT_SP * SP;
  const style = { '--cover-sig-width': String(r2(width / SP)) } as CSSProperties;
  return (
    <svg className="scan-cover-sig" viewBox={`0 0 ${width} ${height}`} style={style} aria-hidden="true" focusable="false" data-testid="cover-signature">
      <g className="scan-cover-sig-lines" strokeWidth={r2(SP * 0.09)}>
        {[0, 1, 2, 3, 4].map((l) => (
          <line key={l} x1={0} x2={width} y1={top + l * SP} y2={top + l * SP} />
        ))}
      </g>
      <g className="scan-cover-sig-ink">
        {glyph(c.name, clefX, yOf(c.step), 'clef')}
        {steps.map((s, i) => glyph(acc, keyX + i * accStep, yOf(s), `k${i}`))}
        {rows.map((row, ri) => {
          let x = timeX + (timeW - rowW[ri]!) / 2;
          return row.map((g, gi) => {
            const el = glyph(g, x, top + (ri === 0 ? 1 : 3) * SP, `t${ri}-${gi}`);
            x += (MUSIC_GLYPHS[g].advance / UNITS) * SP;
            return el;
          });
        })}
        <rect x={r2(barX)} y={top} width={r2(0.16 * SP)} height={4 * SP} />
        <rect x={r2(barX + 0.41 * SP)} y={top} width={r2(width - barX - 0.41 * SP)} height={4 * SP} />
      </g>
    </svg>
  );
}
