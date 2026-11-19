/** The welcome screen's engraved phrase (05 section 8.1): four bars in 3/4, drawn with the music font. Decorative. */
const G = {
  clefG: String.fromCodePoint(0xe050),
  sharp: String.fromCodePoint(0xe262),
  three: String.fromCodePoint(0xe083),
  four: String.fromCodePoint(0xe084),
  half: String.fromCodePoint(0xe0a3),
  black: String.fromCodePoint(0xe0a4),
  dot: String.fromCodePoint(0xe1e7),
} as const;

interface Note {
  x: number;
  y: number;
  glyph: 'half' | 'black';
  /** Stem x, then its two end y values. */
  stem: readonly [number, number, number];
}

const NOTES: readonly Note[] = [
  { x: 106.15, y: 66, glyph: 'half', stem: [106.81, 67.65, 104.5] },
  { x: 162.14, y: 71.5, glyph: 'black', stem: [174.46, 69.85, 33] },
  { x: 243.47, y: 77, glyph: 'black', stem: [255.79, 75.35, 38.5] },
  { x: 282.13, y: 71.5, glyph: 'black', stem: [294.45, 69.85, 33] },
  { x: 320.8, y: 66, glyph: 'black', stem: [321.46, 67.65, 104.5] },
  { x: 402.12, y: 55, glyph: 'half', stem: [402.78, 56.65, 93.5] },
  { x: 458.12, y: 60.5, glyph: 'black', stem: [458.78, 62.15, 99] },
  { x: 539.44, y: 66, glyph: 'half', stem: [540.1, 67.65, 104.5] },
];

const STAFF_Y = [44, 55, 66, 77, 88] as const;
const BARLINES = [229.61, 388.26, 525.58, 631.75] as const;

export function WelcomePhrase() {
  return (
    <svg className="ob-phrase" viewBox="0 0 640 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" data-testid="welcome-phrase">
      <g fill="var(--ink)" color="var(--ink)" fontFamily="var(--font-music)" fontSize="44">
        <g stroke="var(--staff-line)" strokeWidth="1">
          {STAFF_Y.map((y) => (
            <line key={y} x1="0" x2="640" y1={y} y2={y} />
          ))}
        </g>
        <text x="7.7" y="77">{G.clefG}</text>
        <text x="45.1" y="44">{G.sharp}</text>
        <text x="65.45" y="55">{G.three}</text>
        <text x="65.45" y="77">{G.four}</text>
        {NOTES.map((n) => (
          <g key={n.x}>
            <text x={n.x} y={n.y}>{G[n.glyph]}</text>
            <line x1={n.stem[0]} x2={n.stem[0]} y1={n.stem[1]} y2={n.stem[2]} stroke="currentColor" strokeWidth="1.32" />
          </g>
        ))}
        <text x="556.27" y="60.5">{G.dot}</text>
        {BARLINES.map((x) => (
          <rect key={x} x={x} y="44" width="1.76" height="44" />
        ))}
        <rect x="634.5" y="44" width="5.5" height="44" />
      </g>
    </svg>
  );
}
