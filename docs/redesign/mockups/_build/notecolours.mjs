// Note-colour proposal: the palette, and the numbers in docs/redesign/note-colours/03-design.md.
// Run `node docs/redesign/mockups/_build/notecolours.mjs` to print the tables. The mockup build imports PALETTE from here,
// so the sheet, the mockups and the note use the same values.
import * as M from './colour-math.mjs';
import { fileURLToPath } from 'node:url';

// Twelve pitch classes. `fill` is the chip fill (ink letter on it). `edge` is the chip edge and any colour drawn
// straight on paper (swatches, and the noteheads of option A). In dark, the fill is light enough to stand on dark
// paper by itself, so edge = fill. The five in-between colours are the OKLab midpoint of their neighbours.
export const PALETTE = [
  { pc: 'c', letter: 'C', name: 'red', light: { fill: '#E05864', edge: '#C5193D' }, dark: { fill: '#D96272' } },
  { pc: 'cs', letter: 'C♯/D♭', name: 'coral', chromatic: true, light: { fill: '#E26E51', edge: '#C8492D' }, dark: { fill: '#EB907D' } },
  { pc: 'd', letter: 'D', name: 'orange', light: { fill: '#E48233', edge: '#C96805' }, dark: { fill: '#FABC86' } },
  { pc: 'ds', letter: 'D♯/E♭', name: 'amber', chromatic: true, light: { fill: '#F4B953', edge: '#B47D0B' }, dark: { fill: '#FBD47F' } },
  { pc: 'e', letter: 'E', name: 'yellow', light: { fill: '#FFEF72', edge: '#9C8E11' }, dark: { fill: '#FBEB75' } },
  { pc: 'f', letter: 'F', name: 'green', light: { fill: '#97DB60', edge: '#528918' }, dark: { fill: '#96D35F' } },
  { pc: 'fs', letter: 'F♯/G♭', name: 'sea green', chromatic: true, light: { fill: '#88D1B4', edge: '#317F6F' }, dark: { fill: '#82C9AD' } },
  { pc: 'g', letter: 'G', name: 'blue', light: { fill: '#7DC3F4', edge: '#0470A5' }, dark: { fill: '#71BAE9' } },
  { pc: 'gs', letter: 'G♯/A♭', name: 'lavender', chromatic: true, light: { fill: '#A496D6', edge: '#6D5BA2' }, dark: { fill: '#9D95CD' } },
  { pc: 'a', letter: 'A', name: 'purple', light: { fill: '#B665B9', edge: '#9A389F' }, dark: { fill: '#B46CB2' } },
  { pc: 'as', letter: 'A♯/B♭', name: 'orchid', chromatic: true, light: { fill: '#D991C5', edge: '#B24B92' }, dark: { fill: '#D797C5' } },
  { pc: 'b', letter: 'B', name: 'pink', light: { fill: '#FEBCCF', edge: '#CC5A82' }, dark: { fill: '#FBC2D6' } },
];
for (const p of PALETTE) p.dark.edge = p.dark.edge || p.dark.fill;
export const LETTERS7 = PALETTE.filter((p) => !p.chromatic);
export const byLetter = (L) => PALETTE.find((p) => p.pc === L.toLowerCase());
export const PITCH_ON = '#1A1917'; // the letter on every chip, both themes
export const THEME = {
  light: { paper: '#FFFDF8', ink: '#1A1917', error: '#C23A12', correct: '#1F7A5C', ghost: '#6C3FC4', brass: '#94661A' },
  dark: { paper: '#24221F', ink: '#EEE9DF', error: '#FF7A52', correct: '#5CC9A7', ghost: '#BBA4FF', brass: '#D8A548' },
};
export const SIMS = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];
const FB = ['error', 'correct', 'ghost'];

// CSS custom properties for the mockups.
export function cssVars() {
  const v = (t) => PALETTE.map((p) => `--pc-${p.pc}: ${p[t].fill}; --pc-${p.pc}-edge: ${p[t].edge};`).join(' ');
  return `:root { ${v('light')} --pc-on: ${PITCH_ON}; }\n:root[data-theme="dark"] { ${v('dark')} --pc-on: ${PITCH_ON}; }`;
}

// ---------------------------------------------------------------- Measures
export function feedbackDistances(theme, role = 'fill', sim = 'normal', set = PALETTE) {
  const T = THEME[theme];
  return set.map((p) => {
    const c = M.simulate(p[theme][role], sim);
    const d = Object.fromEntries([...FB, 'brass'].map((k) => [k, M.de2000(c, M.simulate(T[k], sim))]));
    return { p, d, min: Math.min(...FB.map((k) => d[k])) };
  });
}
export function pairs(theme, sim, set = LETTERS7) {
  const out = [];
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
    const a = M.simulate(set[i][theme].fill, sim), b = M.simulate(set[j][theme].fill, sim);
    out.push({ a: set[i], b: set[j], de: M.de2000(a, b), dY: Math.abs(M.lum(set[i][theme].fill) - M.lum(set[j][theme].fill)) });
  }
  return out.sort((x, y) => x.de - y.de);
}

// ---------------------------------------------------------------- Report (markdown)
function report() {
  const r = (n, d = 2) => n.toFixed(d);
  const L = [];
  L.push('### Tokens\n');
  L.push('| Token | Note | Name | Light fill | Light edge | Dark fill (and edge) | Light: fill on paper | Light: edge on paper | Light: ink letter on fill | Dark: fill on paper | Dark: ink letter on fill |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of PALETTE) {
    const l = p.light, d = p.dark;
    L.push(`| \`pitch-${p.pc}\` | ${p.letter} | ${p.name} | \`${l.fill}\` | \`${l.edge}\` | \`${d.fill}\` | ${r(M.contrast(l.fill, THEME.light.paper))} | ${r(M.contrast(l.edge, THEME.light.paper))} | ${r(M.contrast(PITCH_ON, l.fill))} | ${r(M.contrast(d.fill, THEME.dark.paper))} | ${r(M.contrast(PITCH_ON, d.fill))} |`);
  }
  L.push('\n### Distance from the feedback colours (CIEDE2000)\n');
  L.push('| Note | Light fill: error / correct / ghost / brass | Light edge: error / correct / ghost / brass | Dark fill: error / correct / ghost / brass |');
  L.push('| --- | --- | --- | --- |');
  const lf = feedbackDistances('light', 'fill'), le = feedbackDistances('light', 'edge'), df = feedbackDistances('dark', 'fill');
  PALETTE.forEach((p, i) => {
    const s = (x) => ['error', 'correct', 'ghost', 'brass'].map((k) => r(x.d[k], 0)).join(' / ');
    L.push(`| ${p.letter} | ${s(lf[i])} | ${s(le[i])} | ${s(df[i])} |`);
  });
  const mins = (set) => {
    const rows = [];
    for (const [t, role] of [['light', 'fill'], ['light', 'edge'], ['dark', 'fill']]) {
      for (const sim of SIMS) {
        const x = feedbackDistances(t, role, sim, set).sort((a, b) => a.min - b.min)[0];
        const k = FB.reduce((a, b) => (x.d[a] < x.d[b] ? a : b));
        rows.push(`| ${t} ${role} | ${sim} | ${r(x.min, 1)} | ${x.p.letter} against ${k} |`);
      }
    }
    return rows;
  };
  L.push('\n### Closest approach to error, correct or ghost, the seven letter colours\n');
  L.push('| Shade | Vision | Minimum ΔE2000 | Pair |');
  L.push('| --- | --- | --- | --- |');
  L.push(...mins(LETTERS7));
  L.push('\n### Closest approach, the five in-between colours\n');
  L.push('| Shade | Vision | Minimum ΔE2000 | Pair |');
  L.push('| --- | --- | --- | --- |');
  L.push(...mins(PALETTE.filter((p) => p.chromatic)));
  L.push('\n### Letter pairs that come close under simulated colour vision (ΔE2000 under 15)\n');
  L.push('| Theme | Vision | Pairs (ΔE2000; luminance difference) |');
  L.push('| --- | --- | --- |');
  for (const t of ['light', 'dark']) for (const sim of SIMS) {
    const ps = pairs(t, sim).filter((x) => x.de < 15);
    L.push(`| ${t} | ${sim} | ${ps.length ? ps.map((x) => `${x.a.letter}–${x.b.letter} ${r(x.de, 1)}; ${r(x.dY)}`).join(', ') : 'none'} |`);
  }
  L.push('\n### Luminance order of the fills (what is left in greyscale)\n');
  for (const t of ['light', 'dark']) L.push(`- ${t}: ${[...LETTERS7].sort((a, b) => M.lum(b[t].fill) - M.lum(a[t].fill)).map((p) => `${p.letter} ${r(M.lum(p[t].fill))}`).join(' > ')}`);
  return L.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(report());
