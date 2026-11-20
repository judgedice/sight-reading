// Note-colour proposal mockups. Writes docs/redesign/note-colours/mockups/*.html.
// Run: node docs/redesign/mockups/_build/notecolours-build.mjs, then node docs/redesign/mockups/_build/notecolours-render.cjs
// Options from docs/redesign/note-colours/02-ux.md §6: A coloured noteheads, B ink noteheads with a band of letter chips,
// C colour on demand only. Every screen is the owner's state: baritone voice, difficulty 1, F major, not calibrated.
// The palette comes from notecolours.mjs, so the sheet, the mockups and the design note agree.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './parts.mjs';
import { parsePitch } from './engrave.mjs';
import { RES_CSS, SCAN_CSS, modeChip, liveCap, PERF_CSS } from './screens2.mjs';
import * as NC from './notecolours.mjs';
import * as M from './colour-math.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'note-colours', 'mockups');
mkdirSync(OUT, { recursive: true });
const { icon, T } = P;

// ---------------------------------------------------------------- Data (the round 2 excerpt: Melody in F major)
const D1 = [
  [{ p: 'F3', d: 'q' }, { p: 'G3', d: 'q' }, { p: 'A3', d: 'q' }, { p: 'F3', d: 'q' }],
  [{ p: 'G3', d: 'q' }, { p: 'A3', d: 'q' }, { p: 'Bb3', d: 'h' }],
  [{ p: 'A3', d: 'q' }, { p: 'G3', d: 'q' }, { p: 'F3', d: 'q' }, { p: 'A3', d: 'q' }],
  [{ p: 'G3', d: 'h' }, { r: true, d: 'h' }],
  [{ p: 'C4', d: 'q' }, { p: 'Bb3', d: 'q' }, { p: 'A3', d: 'q' }, { p: 'G3', d: 'q' }],
  [{ p: 'A3', d: 'q' }, { p: 'F3', d: 'q' }, { p: 'G3', d: 'h' }],
  [{ p: 'E3', d: 'q' }, { p: 'F3', d: 'q' }, { p: 'G3', d: 'q' }, { p: 'E3', d: 'q' }],
  [{ p: 'F3', d: 'w' }],
];
const FKEY = { type: 'b', count: 1 };
const SUM1 = `Difficulty 1 · F major · 4/4 · ${T(60)} · 8 bars`;
const TITLE = 'Melody in F major';
const OPT = {
  a: { id: 'A', name: 'Coloured noteheads' },
  b: { id: 'B', name: 'Ink noteheads, a band of letter chips' },
  c: { id: 'C', name: 'Colour on demand only' },
};

// ---------------------------------------------------------------- Pitch helpers
const ACC = { b: '\u{E260}', '#': '\u{E262}', n: '' };
const ACC_TXT = { b: '♭', '#': '♯', n: '' };
const pcOf = (p) => parsePitch(p).L.toLowerCase();
// Degree mode in F major (02-ux §1): do is the first colour (red), re the second, and so on.
const F_DEGREES = { F: 0, G: 1, A: 2, B: 3, C: 4, D: 5, E: 6 };
const SYL = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'];
const head = (n) => `var(--pc-${pcOf(n.p)}-edge)`;

// A chip: rounded rectangle in the note's fill, its edge one shade deeper, the letter in ink. Sizes in staff spaces,
// with a floor so the letter never drops below 11.5 px on a phone (UX 16 item 19: readable at a metre).
function chip(cx, cy, n, sp, { mode = 'name', opacity = 1, floor = false } = {}) {
  const Pp = parsePitch(n.p);
  let pc = Pp.L.toLowerCase(), txt = Pp.L, acc = Pp.acc;
  if (mode === 'degree') { const d = F_DEGREES[Pp.L]; pc = NC.LETTERS7[d].pc; txt = SYL[d]; acc = ''; }
  const fs = Math.max(0.98 * sp, floor ? 11.5 : 0);
  const h = Math.max(1.56 * sp, floor ? 18 : 0);
  const w = mode === 'degree' ? Math.max(h * 1.25, fs * (txt.length * 0.62 + 0.7)) : acc ? h * 1.55 : h * 1.1;
  const sw = Math.max(1, sp * 0.085);
  const op = opacity !== 1 ? ` opacity="${opacity}"` : '';
  const letter = acc
    ? `<text x="${(cx - fs * 0.22).toFixed(2)}" y="${(cy + fs * 0.36).toFixed(2)}" text-anchor="middle" font-family="var(--font-text)" font-weight="650" font-size="${fs.toFixed(2)}" fill="var(--pc-on)">${txt}</text><text x="${(cx + fs * 0.36).toFixed(2)}" y="${(cy + fs * 0.25).toFixed(2)}" font-family="Bravura" font-size="${(fs * 1.25).toFixed(2)}" fill="var(--pc-on)">${ACC[acc]}</text>`
    : `<text x="${cx.toFixed(2)}" y="${(cy + fs * 0.36).toFixed(2)}" text-anchor="middle" font-family="var(--font-text)" font-weight="650" font-size="${fs.toFixed(2)}" fill="var(--pc-on)">${txt}</text>`;
  return `<g class="pchip"${op}><rect x="${(cx - w / 2).toFixed(2)}" y="${(cy - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(h * 0.3).toFixed(2)}" fill="var(--pc-${pc})" stroke="var(--pc-${pc}-edge)" stroke-width="${sw.toFixed(2)}"/>${letter}</g>`;
}
// The band: one chip under each notehead, centred on its x, in the lane slot (2.2 staff spaces under the staff, or
// under the lowest ledger line in that system), so it sits exactly where the take's lane glyphs will be.
const band = (o = {}) => (notes, { sp }) => {
  const ys = {};
  for (const n of notes) ys[n.si] = Math.max(ys[n.si] ?? 0, n.yb + 2.25 * sp, n.y + 2.2 * sp);
  return `<g class="band">${notes.map((n) => chip(n.x + n.hw / 2, ys[n.si], n.n, sp, o)).join('')}</g>`;
};

// ---------------------------------------------------------------- Score presets
const score1 = (o) => P.engrave({ clef: 'bass', key: FKEY, time: [4, 4], bars: D1, barNumbers: true, ...o });
const scanD = (o) => score1({ width: 872, sp: 15, perSystem: 4, systemGap: 10, ...o });
const scanP = (o) => score1({ width: 342, sp: 9.5, perSystem: 2, systemGap: 0, topPad: 3.8 * 9.5, ...o });
const takeD = (o) => score1({ width: 1150, sp: 16.5, perSystem: 4, systemGap: 8, ...o });
const takeP = (o) => score1({ width: 350, sp: 11, perSystem: 2, systemGap: 2, topPad: 3.4 * 11, bottomPad: 0.6 * 11, ...o });
const resD = (o) => score1({ width: 1100, sp: 12.5, perSystem: 4, ghostStyle: 'review', systemGap: 12, ...o });
const resP = (o) => score1({ width: 314, sp: 9, perSystem: 2, ghostStyle: 'review', systemGap: 2, topPad: 3.4 * 9, bottomPad: 0.5 * 9, ...o });
// Per option: what the read-through draws. A colours heads in today's layout. B draws the band in the take's layout
// (lane slot reserved, so nothing moves at Start). C reserves the same slot but draws nothing until asked.
function scanOpts(opt, { on = false, phone = false, mode = 'name' } = {}) {
  if (opt === 'a') return { showLane: false, bottomPad: (phone ? 1.4 : 2.4) * (phone ? 9.5 : 15), headFill: head };
  const o = { showLane: true, bottomPad: (phone ? 0.2 : 0.4) * (phone ? 9.5 : 15) };
  if (opt === 'b' || on) o.overlay = band({ floor: phone, mode });
  return o;
}

// ---------------------------------------------------------------- Page
const sizes = (s) => `<meta name="sizes" content="${s}">`;
const themes = (s) => `<meta name="themes" content="${s}">`;
const NC_CSS = `${NC.cssVars()}
.as-dark { --paper: #24221F; --ink: #EEE9DF; --staff-line: #8E8981; --error: #FF7A52; --ghost: #BBA4FF; --correct: #5CC9A7; --brass: #D8A548; --brass-ink: #E2B460; --text: #EEEAE2; --text-muted: #A9A398; --surface: #1B1B1E; --border: #2E2E33; ${NC.PALETTE.map((p) => `--pc-${p.pc}: ${p.dark.fill}; --pc-${p.pc}-edge: ${p.dark.edge};`).join(' ')} }
.as-light { --paper: #FFFDF8; --ink: #1A1917; --staff-line: #77736B; --error: #C23A12; --ghost: #6C3FC4; --correct: #1F7A5C; --brass: #94661A; --brass-ink: #7D5512; --text: #1C1B19; --text-muted: #5F5A51; --surface: #FFFDF9; --border: #E3DDD1; ${NC.PALETTE.map((p) => `--pc-${p.pc}: ${p.light.fill}; --pc-${p.pc}-edge: ${p.light.edge};`).join(' ')} }
.psw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12); }
.help-row { display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; margin: 12px 4px 14px; font-size: 13.5px; color: var(--text-muted); }
.help-row .t-small { margin: 0; }
.help-row .sp { flex: 1; }
.help-row .qlink { font-size: 13.5px; }
.help-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font-weight: 600; font-size: 13.5px; }
.help-btn.is-on { background: var(--selected); border-color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }
.help-btn .dots { display: inline-flex; gap: 2px; }
.help-btn .dots i { width: 7px; height: 7px; border-radius: 2px; display: block; }
.mchip { display: inline-flex; align-items: center; justify-content: center; min-width: 52px; height: 46px; padding: 0 10px; border-radius: 14px; font: 650 28px/1 var(--font-text); color: var(--pc-on); border: 1.5px solid; vertical-align: middle; }
.mt-name .mchip { margin-left: 14px; position: relative; top: -10px; }
.note-btn .psw { margin-right: 2px; }
.key-pop { margin: 0 4px 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-2); display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.key-pop .row { display: flex; gap: 6px; }
.key-pop .k { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11.5px; color: var(--text-muted); }
.key-pop .k b { display: grid; place-items: center; width: 30px; height: 24px; border-radius: 7px; border: 1px solid; font: 650 14px/1 var(--font-text); color: var(--pc-on); }
.key-pop p { margin: 0; font-size: 13px; color: var(--text-muted); max-width: 340px; }
`;
function page({ title, body, cls = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../../mockups/mockup.css">
<link rel="stylesheet" href="../../round2/mockups/round2.css">
<link rel="stylesheet" href="nc.css">
<script>if (/dark/.test(location.search)) document.documentElement.dataset.theme = 'dark';</script>
</head>
<body class="${cls}">
${body}
</body>
</html>
`;
}
const loopbar = ({ right = '', home = 'Practice', text = SUM1 } = {}) => `<header class="loopbar">
  <button class="btn btn-quiet btn-compact">${icon('chevL')}${home}</button>
  <p class="summary only-desktop">${text}</p>
  <span class="only-phone" style="margin-left:auto"></span>
  ${right}
</header>`;
const keyChips = (dark = false) => NC.LETTERS7.map((p) => `<span class="k"><b style="background:var(--pc-${p.pc});border-color:var(--pc-${p.pc}-edge)">${p.letter}</b>${p.name}</span>`).join('');
const colourKey = () => `<div class="key-pop" role="dialog" aria-label="Colour key"><div class="row">${keyChips()}</div><p>Each letter has its own colour, in every key and octave. Sharps and flats keep their letter's colour. The colours go before you play.</p></div>`;

// ---------------------------------------------------------------- Read-through
function lookList() {
  const items = [
    ['Key and time', 'F major, 1 flat: B♭. 4/4, felt in 4.', 'Say the key, its flat, and the beats in a bar.'],
    ['Tempo', `${T(60)}, one beat a second.`, 'Feel one beat. Hear the tempo if you like.'],
    ['Accidentals', 'None in the music.', ''],
    ['Rhythm', 'Bar 4: a half note, then a half rest.', 'Count the hardest bar once in your head.'],
    ['Shape', 'Lowest E3, highest C4. Ends on F3.', 'Highest, lowest, big jumps, and the ending.'],
  ];
  return `<section class="card look"><h3 class="t-label" style="margin:0">Look before you play</h3><p class="t-caption muted" style="margin:2px 0 0">Five things to spot before you start.</p>
  <ul>${items.map(([t, f, a]) => `<li><p class="tt">${t}</p><p class="fact">${f}</p>${a ? `<p class="adv">${a}</p>` : ''}</li>`).join('')}</ul></section>`;
}
function sounds() {
  return `<section class="card sounds-card" aria-label="Sounds">
  <h3 class="t-label" style="margin:0">Sounds</h3><p class="t-caption muted" style="margin:2px 0 10px">When you start: your starting pitch, then two bars of clicks.</p>
  <button class="sound"><span class="ic">${icon('listen')}</span><span class="lbl">Listen first</span><span class="cap">Hear how it goes before you play.</span></button>
  <button class="sound"><span class="ic">${icon('metronome')}</span><span class="lbl">Hear the tempo</span><span class="cap">One bar of clicks at ${T(60)}.</span></button>
  <div class="sound" style="margin-top:8px"><span class="ic">${icon('pitch')}</span><span class="lbl">Hear starting pitch</span><span class="cap">Plays the key chord, then your first note.</span><span class="info"><button class="info-btn" aria-label="About Hear starting pitch">${icon('info', 'sm')}</button></span></div>
</section>`;
}
const dots7 = () => `<span class="dots" aria-hidden="true">${['c', 'd', 'e', 'f', 'g', 'a', 'b'].map((p) => `<i style="background:var(--pc-${p})"></i>`).join('')}</span>`;
function helpRow(opt, { on = false, phone = false, key = false, mode = 'name' } = {}) {
  const read = '<p class="t-small">Read it through. Start when you are ready.</p>';
  if (opt === 'a') return `<div class="help-row">${read}<span class="sp"></span><button class="qlink">Colour key</button></div>`;
  if (opt === 'b') return `<div class="help-row">${phone ? '' : read}${phone ? '' : `<span class="t-small">${mode === 'degree' ? 'Coloured by scale degree: do is the key note.' : 'The colours go during the count-in.'}</span>`}<span class="sp"></span><button class="qlink ${key ? 'is-open' : ''}">Colour key</button><button class="qlink">Hide note help</button></div>`;
  return `<div class="help-row">${phone ? '' : read}<span class="sp"></span><button class="help-btn ${on ? 'is-on' : ''}" aria-pressed="${on}">${dots7()}${on ? 'Hide note help' : 'Show note help'}</button></div>`;
}
function scanPage(opt, { on = false, key = false, mode = 'name', only = '' } = {}) {
  const s = scanD(scanOpts(opt, { on, mode }));
  const ps = scanP(scanOpts(opt, { on, phone: true, mode }));
  const desktop = `<div class="only-desktop">
${loopbar({ right: `${modeChip('', 0, true)}<button class="icon-btn" aria-label="More">${icon('more')}</button>` })}
<main class="scan-grid">
  <section>
    <div class="paper" style="padding:36px 48px 26px">${s.svg}</div>
    ${helpRow(opt, { on, key, mode })}
    ${key ? colourKey() : ''}
    ${lookList()}
  </section>
  <aside>
    <button class="btn btn-primary btn-hero btn-block">Start playing <span class="kbd">Space</span></button>
    <p class="cal-line">${icon('speaker', 'sm')}<span>Not calibrated ·</span><button class="qlink" style="margin-left:0">Calibrate</button></p>
    ${sounds()}
  </aside>
</main>
</div>`;
  const phone = `<div class="only-phone" style="position:relative">
${loopbar({ right: `${modeChip('', 0, true)}<button class="icon-btn" aria-label="More">${icon('more')}</button>` })}
<main style="padding:10px 10px 300px">
  <p class="t-caption muted" style="margin:0 4px 2px;text-align:center">${SUM1}</p>
  <p class="cal-line ph">${icon('speaker', 'sm')}<span>Not calibrated ·</span><button class="qlink">Calibrate</button></p>
  <div class="paper" style="padding:12px 12px 8px;border-radius:16px">${ps.svg}</div>
  ${helpRow(opt, { on, phone: true, mode })}
</main>
<div class="dock">
  <button class="peek"><span class="t-label">Look before you play</span>${icon('chevU', 'sm')}</button>
  <div class="dock-inner">
    <div class="dock-row">
      <button class="dbtn"><span class="ic">${icon('listen')}</span><span>Listen first</span></button>
      <button class="dbtn"><span class="ic">${icon('metronome')}</span><span>Tempo</span></button>
      <button class="dbtn"><span class="ic">${icon('pitch')}</span><span>Starting pitch</span></button>
      <button class="info-btn" style="width:44px;height:44px;align-self:center" aria-label="What do these do?">${icon('info')}</button>
    </div>
    <button class="btn btn-primary btn-hero btn-block" style="margin-top:12px">Start playing</button>
  </div>
</div>
</div>`;
  return page({ title: `Option ${OPT[opt].id}: read-through`, body: (only ? sizes(only) : '') + SCAN_CSS + `<style>.help-row .qlink.is-open{ text-decoration-thickness: 2px; }</style>` + desktop + phone });
}

// ---------------------------------------------------------------- Mid-try
// Playhead in bar 6. Bars 1 to 4 are the system already left (marks at 70%). Bar 2: a flat A (red head, down
// triangle). Bar 5: C4 right (green dot), B♭3 wrong (sung A3: red head, ✕, violet ghost at A3), A3 and G3 right.
// The heard-note ghost is live because the owner's Display setting "Show played notes live" is on Always here.
function takeMarks() {
  const m = {};
  for (const id of ['b1n1', 'b1n2', 'b1n3', 'b1n4', 'b2n1', 'b2n3', 'b3n1', 'b3n2', 'b3n3', 'b3n4', 'b4n1']) m[id] = { lane: 'dot', past: 0.7 };
  m.b2n2 = { state: 'error', lane: 'flat', ghost: { p: 'Ab3', dx: 1.0, arrow: 'down' }, past: 0.7 };
  m.b5n1 = { lane: 'dot' };
  m.b5n2 = { state: 'error', lane: 'wrong', ghost: { p: 'A3', dx: 0.85 } };
  m.b5n3 = { lane: 'dot' };
  m.b5n4 = { lane: 'dot' };
  m.b6n1 = { lane: 'dot' };
  return m;
}
function takePage(opt) {
  const o = { marks: takeMarks(), playheadBar: 6, ...(opt === 'a' ? { headFill: head } : {}) };
  const d = takeD(o), p = takeP(o);
  const meterBars = [5, 9, 13, 16, 12, 7, 4].map((h, i) => `<i class="${i < 5 ? 'on' : ''}" style="height:${h}px"></i>`).join('');
  const body = `<header class="perfbar"><button class="btn btn-secondary btn-compact">${icon('stop', 'sm')}Stop</button><div class="perf-mid"><span class="beats"><i class="down done"></i><i class="on"></i><i></i><i></i></span><span class="t-label">Bar 6 of 8</span><span class="muted t-small only-desktop">${T(60)}</span></div><span class="mic">Mic <span class="bars">${meterBars}</span></span></header>
<main class="perf-wrap"><div class="paper perf-paper"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
  return page({ title: `Option ${OPT[opt].id}: mid-try`, cls: 'viewport-only', body: PERF_CSS + body });
}

// ---------------------------------------------------------------- Results
function reviewMarks() {
  const m = {};
  m.b2n2 = { state: 'error', lane: 'flat', ghost: { p: 'Ab3', dx: 1.0, arrow: 'down' } };
  m.b5n2 = { state: 'error', lane: 'wrong', ghost: { p: 'A3', dx: 0.85 } };
  m.b7n4 = { state: 'missed', lane: 'missed' };
  return m;
}
const ACTIONS2 = `<button class="btn btn-primary btn-hero">Next piece${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero">Try again (practice)</button><button class="btn btn-quiet btn-hero">Change setup</button>`;
function gradeHead(opt) {
  const reason = opt === 'a' ? 'Note colours were on, so this one is practice. Not calibrated: timing marks may be a little off.' : 'Not calibrated: timing marks may be a little off.';
  return `<section class="grade-head">
  <div class="g-left"><span class="grade">B</span><div><div style="display:flex;align-items:baseline;gap:8px"><span class="t-display num">84</span><span class="muted t-small">of 100</span></div><div class="stars">${P.star(1)}${P.star(1)}${P.star(0)}</div><p style="margin:6px 0 0;font-weight:500">Solid. A few mistakes.</p></div></div>
  <div class="g-right">
    <div class="xp-line"><span class="badge">Practice</span><span class="t-h3 num">+4 XP</span><span class="t-small muted nb">Novice · 14% to Apprentice</span><span class="xpbar" style="width:120px"><i style="width:14%"></i></span></div>
    <p class="t-small reason muted">${reason}</p>
    <div class="res-actions only-desktop">${ACTIONS2}</div>
    <p class="tries-line">${icon('history')}<button class="qlink">2 tries at this piece</button> · <button class="qlink">See all tries</button></p>
  </div>
</section>`;
}
const toolbar = (opt) => {
  const clean = opt !== 'a';
  return `<div class="score-tools">
  <div class="seg" role="radiogroup" aria-label="Show"><button class="seg-btn ${clean ? '' : 'is-on'}" style="min-height:36px">My marks</button><button class="seg-btn ${clean ? 'is-on' : ''}" style="min-height:36px">Clean score</button></div>
  ${clean ? '' : `<span class="nav-slips mstep"><button class="btn btn-secondary btn-compact" aria-label="Previous mistake">${icon('chevL', 'sm')}</button><span class="t-small">Mistake 1 of 3</span><button class="btn btn-secondary btn-compact" aria-label="Next mistake">${icon('chevR', 'sm')}</button></span>`}
  ${opt === 'b' ? `<span class="t-small muted only-desktop">Note help is on the clean score only.</span>` : ''}
  ${opt === 'c' ? `<button class="help-btn">${dots7()}Show note help</button>` : ''}
  <span style="flex:1"></span>
  <span class="switch only-desktop"><span class="switch-track"></span>Slower</span>
  <button class="btn btn-secondary btn-compact">${icon('listen', 'sm')}Listen</button>
</div>`;
};
function resultsPage(opt) {
  const o = opt === 'a' ? { marks: reviewMarks(), headFill: head } : opt === 'b' ? { overlay: band() } : {};
  const op = opt === 'b' ? { overlay: band({ floor: true }) } : o;
  const d = resD(o), p = resP(op);
  const tip = `<section class="card card-pad tip-card"><div class="tip-head"><span class="tip-ic">${icon('lightbulb')}</span><h2 class="t-h2">One thing to try</h2></div>
  <p class="tip-text">The A in bar 2 sat low. Before you sing, hear the starting pitch and think the first three notes: F, G, A.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="btn btn-tonal btn-compact">${icon('listen', 'sm')}Hear bar 2</button></div></section>`;
  const c = (l, v, weak) => `<div class="comp"><span class="t-small" style="font-weight:600">${l}</span><span class="bar"><i class="${weak ? 'weak' : ''}" style="width:${v}%"></i></span><span class="v num">${v}</span></div>`;
  const comps = `<section class="card card-pad"><h2 class="t-h3" style="margin-bottom:8px">How it went</h2>${c('Notes', 93)}${c('In tune', 74, true)}${c('Rhythm', 86)}<p class="t-small muted counts" style="margin:12px 0 0">24 notes · 21 right · 1 wrong · 1 out of tune · 1 missed</p></section>`;
  const body = `${loopbar({ text: SUM1 })}
<main class="res">
  ${gradeHead(opt)}
  <section class="card score-card">${toolbar(opt)}
    <div class="paper" style="padding:24px 28px 14px;box-shadow:none;border:1px solid var(--border)"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></section>
  <div class="res-cols">${tip}${comps}</div>
</main>
<div class="res-sticky"><button class="btn btn-primary btn-hero">Next piece${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero" aria-label="Try again (practice)">${icon('retry', 'sm')}Try again</button></div>`;
  return page({ title: `Option ${OPT[opt].id}: results`, body: themes('light') + RES_CSS + body });
}

// ---------------------------------------------------------------- Match a note
const MT_STAFF = (opt, sp = 17) => P.engrave({ clef: 'bass', key: null, time: null, bars: [[{ p: 'E3', d: 'w' }]], perSystem: 1, noFinal: true, width: 10.5 * sp, sp, showLane: false, topPad: 3.2 * sp, bottomPad: 1.2 * sp, ...(opt === 'a' ? { headFill: head } : {}) }).svg;
function meter(pos) {
  const X = (c) => `${50 + c}%`;
  return `<div class="meter" role="meter" aria-valuemin="-50" aria-valuemax="50" aria-valuenow="${pos}" aria-label="Pitch against the note">
  <div class="trk"></div><div class="band" style="left:${X(-25)};width:50%"></div>
  ${[-50, -25, 25, 50].map((c) => `<span class="tk" style="left:${X(c)}"></span>`).join('')}<span class="tk c" style="left:50%"></span>
  <span class="lbl l">Low</span><span class="lbl" style="left:50%">In tune</span><span class="lbl r">High</span>
  <span class="needle" style="left:${X(pos)}"></span>
</div>`;
}
const mchip = (L) => `<span class="mchip" style="background:var(--pc-${L.toLowerCase()});border-color:var(--pc-${L.toLowerCase()}-edge)" aria-hidden="true">${L}</span>`;
function matchPage(opt) {
  const inner = (phone) => `<header class="mt-bar" style="position:relative"><button class="btn btn-quiet btn-compact">${icon('chevL')}${phone ? '' : 'Practice'}</button><span class="ttl">Match a note</span><span class="prog"><span class="only-desktop">Note 1 of 5</span><span class="mt-dots"><i class="now"></i><i></i><i></i><i></i><i></i></span></span></header>
<main class="mt">
  <div class="mt-target"><div class="paper">${MT_STAFF(opt, phone ? 13 : 17)}</div><div class="mt-name">E3${mchip('E')}<small>Listen, then sing it.</small></div></div>
  <p class="mt-state" aria-live="polite">${icon('chevU')}A little low. Go up.</p>
  <p class="mt-you">You: <b>E3</b>, 34 cents low</p>
  ${meter(-34)}
  <p class="t-small muted" style="margin:6px 0 0;text-align:center">Lift it a little until the needle sits in the middle.</p>
  <div class="mt-acts"><button class="btn btn-secondary">${icon('play', 'sm')}Play it again</button></div>
  <div class="mt-pick"><span>Or tap a note in your range:</span>${['C3', 'E3', 'G3', 'C4'].map((n) => `<button class="note-btn served ${n === 'E3' ? 'cur' : ''}" style="display:inline-flex;align-items:center;gap:6px;${n === 'E3' ? '' : 'background:var(--surface);color:var(--text);border-color:var(--border)'}"><i class="psw" style="background:var(--pc-${n[0].toLowerCase()});box-shadow:inset 0 0 0 1.5px var(--pc-${n[0].toLowerCase()}-edge)"></i>${n}</button>`).join('')}</div>
</main>`;
  return page({ title: `Option ${OPT[opt].id}: Match a note`, cls: 'viewport-only', body: themes('light') + `<style>@media (max-width:700px){ .mchip { min-width: 38px; height: 34px; font-size: 21px; border-radius: 10px; top: -6px; margin-left: 8px; } }</style>` + `<div class="only-desktop">${inner(false)}</div><div class="only-phone">${inner(true)}</div>` });
}

// ---------------------------------------------------------------- Picker: range picture and keyboard strip
const BARI = P.BARI;
// Option A colours the keyboard: a cap at the foot of every key, the five in-between colours on the black keys.
function kbColoured(html, { loM = 36, hiM = 72, width = 400, height = 36 } = {}) {
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const whites = [];
  for (let m = loM; m <= hiM; m++) if (!isBlack(m)) whites.push(m);
  const ww = width / whites.length;
  const pcs = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];
  const caps = [];
  whites.forEach((m, i) => caps.push(`<rect x="${(i * ww + 2).toFixed(2)}" y="${height - 9}" width="${(ww - 4).toFixed(2)}" height="6" rx="2" fill="var(--pc-${pcs[m % 12]}-edge)"/>`));
  for (let m = loM; m <= hiM; m++) if (isBlack(m)) { const wi = whites.indexOf(m - 1); caps.push(`<rect x="${((wi + 1) * ww - ww * 0.32 + 1.5).toFixed(2)}" y="${(height * 0.6 - 7).toFixed(2)}" width="${(ww * 0.64 - 3).toFixed(2)}" height="5" rx="1.5" fill="var(--pc-${pcs[m % 12]})"/>`); }
  return html.replace('</svg>', caps.join('') + '</svg>');
}
function rangeFig(opt, { width = 394, sp = 10.5, kb = true, voiceLine = true } = {}) {
  const rp = P.rangePicture({ clef: BARI.clef, full: BARI.full, served: BARI.served, width, sp });
  const labels = rp.labels.map((l) => `<button class="note-btn ${l.kind}" style="left:${((l.x / width) * 100).toFixed(2)}%;display:inline-flex;align-items:center;gap:5px" aria-label="Hear ${l.name}">${icon('play')}<i class="psw" style="background:var(--pc-${l.name[0].toLowerCase()});box-shadow:inset 0 0 0 1.5px var(--pc-${l.name[0].toLowerCase()}-edge)"></i>${l.name}</button>`).join('');
  let k = kb ? P.keyboard({ loM: 36, hiM: 72, full: BARI.full, served: BARI.served, width: 400, height: 36 }) : '';
  if (kb && opt === 'a') k = kbColoured(k);
  return `<figure class="range-figure">
  <div class="range-stage">${rp.svg}<div class="range-labels">${labels}</div></div>
  ${k}
  <figcaption class="range-legend">
    <div><span class="sw full"></span><span>Full range: <b>G2 to G4</b></span></div>
    <div><span class="sw served"></span><span>At difficulty 1: <b>C3 to C4</b></span></div>
    ${voiceLine ? `<div class="muted" style="padding-left:28px">Sing in any octave that suits you. Pitch is marked relative to your starting note.</div>` : ''}
    ${opt === 'a' ? `<div class="muted" style="padding-left:28px">The colour at the foot of each key is its note colour.</div>` : ''}
  </figcaption>
</figure>`;
}
const PICK_CSS = `<style>
body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); }
:root[data-theme="dark"] body { background: #050506; }
.pdlg { width: 1280px; max-width: calc(100vw - 48px); height: calc(100vh - 48px); margin: 24px auto; display: flex; flex-direction: column; overflow: hidden; }
.dlg-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 24px 24px 14px 32px; border-bottom: 1px solid var(--border); flex: none; }
.pbody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 452px; }
.pgrid-pane { overflow: hidden; padding: 4px 28px 24px 32px; }
.picked { border-left: 1px solid var(--border); background: var(--bg); padding: 22px 28px; overflow: hidden; }
.dlg-foot { display: flex; align-items: center; gap: 8px; padding: 14px 32px 18px; border-top: 1px solid var(--border); flex: none; background: var(--surface); }
.pick-grid.voices { grid-template-columns: repeat(3, minmax(0,1fr)); }
.pcard { grid-template-columns: 40px 1fr; grid-template-rows: auto auto 30px; align-items: start; }
.pcard .pic { grid-row: 1 / span 2; }
.pcard .rb { margin-top: 8px; }
.note-btn .icon { width: 12px; height: 12px; }
@media (max-width: 700px) {
  .psheet { margin-top: 12px; min-height: calc(100vh - 12px); }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 4px; }
  .psheet .pick-grid.voices { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .psheet .voices .pcard { grid-template-columns: 1fr; grid-template-rows: auto auto auto 22px; padding: 12px 10px 10px; }
  .psheet .voices .pcard .pic { grid-row: auto; width: 34px; height: 34px; margin-bottom: 6px; }
  .psheet .voices .pcard .pic .music { font-size: 22px; }
  .psheet .voices .pcard .nm { font-size: 14px; padding-right: 0; }
  .psheet .voices .pcard .rg { font-size: 12.5px; }
  .ppanel { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -16px 32px rgba(0,0,0,0.14); padding: 12px 16px 22px; border-radius: 22px 22px 0 0; }
  .ppanel .ph { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 2px; }
  .ppanel .snd-line { margin-top: 8px; padding: 9px 12px; font-size: 12.5px; }
}
</style>`;
const VOICES = [['Soprano', 'treble', [57, 84], [62, 74]], ['Mezzo', 'treble', [55, 81], [60, 72]], ['Alto', 'treble', [52, 77], [57, 69]], ['Tenor', 'treble-8vb', [45, 69], [50, 62]], ['Baritone', 'bass', [43, 67], [48, 60]], ['Bass', 'bass', [40, 65], [45, 57]]];
const vcard = ([name, clef, full, served], w) => {
  const on = name === 'Baritone';
  return `<button class="pcard ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}"><span class="pic"><span class="music">${P.clefGlyph[clef]}</span></span><span class="nm">${name}</span><span class="rg">${P.midiName(full[0])} to ${P.midiName(full[1])}</span><span class="rb">${P.rulerBar({ full, served, width: w, height: 22 })}</span>${on ? `<span class="check">${icon('check')}</span>` : ''}</button>`;
};
const OTHERS = [['Woodwinds', [['Flute', 'flute', [60, 96], [65, 77]], ['Clarinet in B♭', 'clarinet', [50, 89], [53, 68]], ['Alto saxophone', 'sax', [49, 81], [53, 65]]]], ['Brass', [['Trumpet in B♭', 'trumpet', [52, 82], [58, 70]]]], ['Strings', [['Violin', 'violin', [55, 100], [62, 81]], ['Cello', 'cello', [40, 81], [43, 62]]]], ['Keyboard', [['Piano (right hand)', 'piano', [45, 96], [60, 72]]]]];
const icard = ([name, ic, full, served], w) => `<button class="pcard"><span class="pic">${icon(ic, 'lg')}</span><span class="nm">${name}</span><span class="rg">${P.midiName(full[0])} to ${P.midiName(full[1])}</span><span class="rb">${P.rulerBar({ full, served, width: w, height: 22 })}</span></button>`;
function pickerPage(opt) {
  const desktop = `<div class="only-desktop"><div class="dialog pdlg" role="dialog" aria-label="Choose your instrument">
  <div class="dlg-head"><div><h2 class="t-title" style="font-size:30px">Choose your instrument</h2><p class="t-small muted" style="margin:4px 0 0">We choose music in your range. Pick a card, then press play to hear it.</p></div><button class="icon-btn" aria-label="Close">${icon('x')}</button></div>
  <div class="pbody">
    <div class="pgrid-pane">
      <section class="pick-group"><h3 class="t-label">Voice</h3><div class="pick-grid voices">${VOICES.map((v) => vcard(v, 200)).join('')}</div></section>
      <div style="display:grid;grid-template-columns:3fr 1fr;column-gap:10px">${OTHERS.slice(0, 2).map(([g, cs]) => `<section class="pick-group"><h3 class="t-label">${g}</h3><div class="pick-grid" style="grid-template-columns:repeat(${cs.length},minmax(0,1fr))">${cs.map((c) => icard(c, 150)).join('')}</div></section>`).join('')}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;column-gap:10px">${OTHERS.slice(2).map(([g, cs]) => `<section class="pick-group"><h3 class="t-label">${g}</h3><div class="pick-grid" style="grid-template-columns:repeat(${cs.length},minmax(0,1fr))">${cs.map((c) => icard(c, 150)).join('')}</div></section>`).join('')}</div>
    </div>
    <aside class="picked">
      <p class="t-eyebrow" style="margin:0 0 6px">Selected</p>
      <h3 class="t-h2">Baritone voice</h3>
      <p class="t-small muted" style="margin:4px 0 14px">Shown at difficulty 1.</p>
      <div class="snd-row"><button class="btn btn-secondary btn-compact btn-play">${icon('play', 'sm')}Play my range</button><span class="t-caption muted">or tap one note</span></div>
      <p class="t-caption muted" style="margin:0 0 4px">Lowest, your notes at difficulty 1, highest.</p>
      ${rangeFig(opt)}
      <p class="snd-line">${icon('speaker')}<span><b>This is how it will sound.</b> The starting pitch, Listen and Match a note use this sung “ah” in baritone range. It's made by the app, not recorded.</span></p>
    </aside>
  </div>
  <div class="dlg-foot"><span class="switch"><span class="switch-track"></span>Show more instruments (less tested)</span><span style="flex:1"></span><button class="btn btn-quiet">Cancel</button><button class="btn btn-primary">Done</button></div>
</div></div>`;
  const phone = `<div class="only-phone">
  <div class="sheet psheet">
    <div class="grabber"></div>
    <div class="sheet-head"><button class="btn btn-quiet btn-compact">Cancel</button><h2 class="t-h3">Choose your instrument</h2><button class="btn btn-primary btn-compact">Done</button></div>
    <div style="padding:0 16px 24px"><section class="pick-group" style="margin-top:12px"><h3 class="t-label">Voice</h3><div class="pick-grid voices">${VOICES.map((v) => vcard(v, 96)).join('')}</div></section></div>
  </div>
  <section class="ppanel" aria-label="Selected instrument">
    <div class="ph"><h3 class="t-h3">Baritone voice</h3><button class="btn btn-secondary btn-compact btn-play">${icon('play', 'sm')}Play my range</button></div>
    ${rangeFig(opt, { width: 358, sp: 8.5, voiceLine: false })}
  </section>
</div>`;
  return page({ title: `Option ${OPT[opt].id}: picker`, cls: 'viewport-only', body: themes('light') + PICK_CSS + desktop + phone });
}

// ---------------------------------------------------------------- Option B: from the read-through to bar 1
function fadeBoard() {
  const sys = (o) => score1({ width: 600, sp: 9, perSystem: 4, topPad: 3.6 * 9, bars: D1.slice(0, 4), showLane: true, bottomPad: 0.4 * 9, ...o }).svg;
  const cueRef = `<div class="ref-card" role="status"><span class="ic">${icon('pitch')}</span><h2>Your starting pitch</h2><p class="why">First note: <b>F3</b> <span class="mchip" style="min-width:24px;height:20px;font-size:12px;border-radius:6px;padding:0 6px;background:var(--pc-f);border-color:var(--pc-f-edge);vertical-align:-3px">F</span>. You don't need to sing yet.</p><div class="ref-steps2"><span class="st done">${icon('check')}Key chord: F major</span>${liveCap('First note: F3')}</div></div>`;
  const cells = (bar, beat) => (b) => [1, 2, 3, 4].map((n) => `<span class="cell ${b < bar || (b === bar && n < beat) ? 'done' : b === bar && n === beat ? 'now' : ''}">${n}</span>`).join('');
  const track = (bar, beat) => `<div class="ctrack" aria-hidden="true">${bar === 2 ? `<p class="line last">Come in after 4 <span class="muted">Count-in bar 2 of 2 · ${T(60)}</span></p>` : `<p class="line">Count-in: listen to the beat <span class="muted">Count-in bar 1 of 2 · ${T(60)}</span></p>`}<div class="cells"><span class="bar listen">${cells(bar, beat)(1)}</span><span class="bsep"></span><span class="bar last">${cells(bar, beat)(2)}</span><span class="entry">Sing</span></div></div>`;
  const frame = ({ id, t, cue = '', o = {}, dim = false, line, strip }) => `<article class="frame">
    <div class="fhead"><span class="fid">${id}</span><span class="t">${t}</span></div>
    <div class="fbar">${strip === 'Read-through' ? '<span class="muted">Start playing</span>' : `<span class="stopb">${icon('stop', 'sm')}Stop</span>`}<span class="mid">${strip}</span><span class="muted">${strip === 'Bar 1 of 8' ? 'Mic' : strip === 'Read-through' ? 'Nothing is judged' : 'Marks start at bar 1'}</span></div>
    <div class="fpaper"><div class="cue">${cue}</div><div style="opacity:${dim ? 0.55 : 1}">${sys(o)}</div></div>
    <div class="fcap">${line}</div></article>`;
  const body = `<main class="fb">
  <h1 class="t-title">Option B: the band from the read-through to bar 1</h1>
  <p class="lead">Baritone, difficulty 1, ${T(60)}. Times from pressing Start, as on the round 2 frames board. The band sits in the lane slot, so the read-through already has the take's layout: nothing moves at Start, at the count-in or at bar 1. Opacity only; under reduced motion the band is cut at the first click.</p>
  <div class="fgrid">
    ${frame({ id: 'S · read-through', t: 'before Start', o: { overlay: band() }, strip: 'Read-through', line: 'Every note has its chip. Noteheads stay ink. Nothing is judged.' })}
    ${frame({ id: 'R2 · starting pitch', t: '2.3 s', cue: cueRef, dim: true, o: { overlay: band(), marks: { b1n1: { ring: 'brass', label: 'F3' } } }, strip: 'Starting pitch', line: 'The card names the first note with its chip. The first note keeps its brass ring: brass is “now”. The band stays, dimmed with the score.' })}
    ${frame({ id: 'C1.3 · count-in bar 1, beat 3', t: '6.3 s', cue: track(1, 3), o: { overlay: band({ opacity: 0.45 }) }, strip: 'Count-in', line: 'The band fades over the first count-in bar, 100% to 0. Here, beat 3: about 45%.' })}
    ${frame({ id: 'C2.1 · count-in bar 2, beat 1', t: '8.3 s', cue: track(2, 1), o: { marks: { b1n1: { ring: 'brass', label: 'Sing' } } }, strip: 'Count-in', line: '<b>No colour anywhere.</b> From the last count-in bar the player reads plain ink, and the lane slot is empty.' })}
    ${frame({ id: 'M2 · bar 1', t: '12.6 s', o: { marks: { b1n1: { lane: 'dot' } } }, strip: 'Bar 1 of 8', line: 'The lane slot now belongs to feedback: the green dot sits where the F chip was. Chip and dot never share the slot.' })}
  </div>
</main>`;
  return page({ title: 'Option B: count-in fade', body: sizes('desktop') + themes('light') + body });
}

// ---------------------------------------------------------------- Palette sheet
function paletteSheet() {
  const r = (n, d = 2) => n.toFixed(d);
  const sw = (p, t) => {
    const c = p[t];
    const paper = NC.THEME[t].paper;
    return `<div class="pt"><span class="ch" style="background:${c.fill};border-color:${c.edge}">${p.letter.replace('/', '<br>')}</span><span class="nm">${p.name}</span><code>${c.fill}</code>${t === 'light' ? `<code class="e">edge ${c.edge}</code>` : ''}<span class="ct">ink ${r(M.contrast(NC.PITCH_ON, c.fill), 1)} · ${t === 'light' ? `edge on paper ${r(M.contrast(c.edge, paper), 1)}` : `on paper ${r(M.contrast(c.fill, paper), 1)}`}</span></div>`;
  };
  const row = (t) => `<div class="prow ${t === 'dark' ? 'as-dark' : 'as-light'}" style="background:${NC.THEME[t].paper}">${NC.PALETTE.map((p) => sw(p, t)).join('')}</div>`;
  const sims = ['normal', 'deuteranopia', 'protanopia', 'tritanopia'];
  const simRow = (t, sim) => {
    const set = [...NC.LETTERS7.map((p) => ({ k: p.letter, c: p[t].fill, e: p[t].edge })), { k: '·' }, ...['error', 'correct', 'ghost', 'brass'].map((k) => ({ k, c: NC.THEME[t][k], fb: true }))];
    return `<div class="srow2"><span class="sl">${sim === 'normal' ? 'Normal vision' : sim[0].toUpperCase() + sim.slice(1)}</span>${set.map((x) => x.k === '·' ? '<span class="gap"></span>' : x.fb
      ? `<span class="fbsw"><i style="background:${M.simulate(x.c, sim)}"></i><small>${x.k}</small></span>`
      : `<span class="ssw" style="background:${M.simulate(x.c, sim)};border-color:${M.simulate(x.e, sim)}">${x.k}</span>`).join('')}<span class="close">${NC.pairs(t, sim).filter((x) => x.de < 15).map((x) => `${x.a.letter}–${x.b.letter} ${r(x.de, 1)}`).join(', ') || 'no pair under 15'}</span></div>`;
  };
  const simBlock = (t) => `<div class="simb ${t === 'dark' ? 'as-dark' : 'as-light'}" style="background:${NC.THEME[t].paper};color:${t === 'dark' ? '#EEE9DF' : '#1A1917'}"><p class="sh">${t === 'light' ? 'Light paper' : 'Dark paper'}<span>chips, then the feedback colours, then the pairs that come within ΔE2000 15</span></p>${sims.map((s) => simRow(t, s)).join('')}</div>`;
  // Dense rhythm: difficulty 6 style eighths. Chips collapse to dots when they would touch; the first note of each beat keeps its letter.
  const dense = [[{ p: 'F3', d: 'e' }, { p: 'G3', d: 'e' }, { p: 'A3', d: 'e' }, { p: 'Bb3', d: 'e' }, { p: 'C4', d: 'e' }, { p: 'A3', d: 'e' }, { p: 'F3', d: 'e' }, { p: 'A3', d: 'e' }], [{ p: 'G3', d: 'e' }, { p: 'E3', d: 'e' }, { p: 'C3', d: 'e' }, { p: 'E3', d: 'e' }, { p: 'F3', d: 'h' }]];
  const denseBand = (notes, { sp }) => {
    const y = Math.max(...notes.map((n) => Math.max(n.yb + 2.25 * sp, n.y + 2.2 * sp)));
    return notes.map((n, i) => {
      const beatStart = i % 2 === 0;
      const cx = n.x + n.hw / 2;
      if (beatStart || n.n.d !== 'e') return chip(cx, y, n.n, sp, { floor: true });
      return `<circle cx="${cx.toFixed(2)}" cy="${y.toFixed(2)}" r="${(0.34 * sp).toFixed(2)}" fill="var(--pc-${pcOf(n.n.p)})" stroke="var(--pc-${pcOf(n.n.p)}-edge)" stroke-width="1"/>`;
    }).join('');
  };
  const denseSvg = P.engrave({ clef: 'bass', key: FKEY, time: [4, 4], bars: dense, perSystem: 2, width: 470, sp: 10, showLane: true, topPad: 3.4 * 10, bottomPad: 0.4 * 11, overlay: denseBand }).svg;
  const lowSvg = P.engrave({ clef: 'bass', key: null, time: null, bars: [[{ p: 'G2', d: 'q' }, { p: 'A2', d: 'q' }, { p: 'B2', d: 'q' }, { p: 'C3', d: 'q' }], [{ p: 'E2', d: 'h' }, { p: 'G2', d: 'h' }]], perSystem: 2, width: 420, sp: 10, showLane: true, topPad: 3.4 * 10, bottomPad: 1.6 * 10, overlay: band({ floor: true }) }).svg;
  const anat = `<svg width="300" height="110" viewBox="0 0 300 110" aria-hidden="true" style="font-family:var(--font-text)">
    <g transform="translate(14,8)">${chip(30, 30, { p: 'F3' }, 24)}${chip(130, 30, { p: 'Bb3' }, 24)}</g>
    <text x="20" y="92" font-size="12" fill="var(--text-muted)">1.56 sp tall, radius 30%, edge 0.085 sp</text>
    <text x="20" y="106" font-size="12" fill="var(--text-muted)">letter Inter 650 at 0.98 sp, at least 11.5 px</text></svg>`;
  const settings = `<div class="card setc"><p class="t-label" style="margin:0 0 6px">Settings › Display</p>
    <div class="srowx"><div><b>Note help</b><small>Shows the name of each note under the music while you read it through. It goes before you start playing.</small></div><div class="seg"><button class="seg-btn">Off</button><button class="seg-btn">Letters</button><button class="seg-btn is-on">Letters and colours</button></div></div>
    <div class="srowx"><div><b>Show it</b></div><div class="seg"><button class="seg-btn is-on">At difficulties 1 to 3</button><button class="seg-btn">Always</button></div></div>
    <div class="srowx"><div><b>Colour by</b><small>C is always red, in every key.</small></div><div class="seg"><button class="seg-btn is-on">Note name</button><button class="seg-btn">Scale degree</button></div></div>
    <div class="kleg">${P.keyboard({ loM: 48, hiM: 59, full: [0, 0], served: [0, 0], width: 280, height: 56, labels: false }).replace('</svg>', (() => { const ww = 280 / 7; return [0, 2, 4, 5, 7, 9, 11].map((m, i) => `<rect x="${i * ww + 3}" y="44" width="${ww - 6}" height="8" rx="2.5" fill="var(--pc-${['c', 'd', 'e', 'f', 'g', 'a', 'b'][i]}-edge)"/>`).join(''); })() + '</svg>')}<div class="kl">${NC.LETTERS7.map((p) => `<span><b style="background:var(--pc-${p.pc});border-color:var(--pc-${p.pc}-edge)">${p.letter}</b></span>`).join('')}</div></div>
  </div>`;
  const minLine = (t, role) => {
    const x = NC.feedbackDistances(t, role, 'normal', NC.LETTERS7).sort((a, b) => a.min - b.min)[0];
    return `${r(x.min, 1)} (${x.p.letter})`;
  };
  const body = `<main class="fb pal">
  <h1 class="t-title">Note colours: the palette</h1>
  <p class="lead">Twelve colours, in the classroom order that runs up from C: red, orange, yellow, green, blue, purple, pink. The seven letter colours do the work on the page: a sharp or flat keeps its letter's colour, and the chip says F♯ or B♭. The five in-between colours are pale on purpose, because at full strength they land on the feedback hues; they are used only on a coloured keyboard. Every chip carries its letter. Closest letter colour to error, correct or ghost (ΔE2000, normal vision): light fills ${minLine('light', 'fill')}, dark fills ${minLine('dark', 'fill')}, light edges ${minLine('light', 'edge')}.</p>
  <h2 class="t-h3">Light paper <span class="muted t-small">fill, edge, ink letter on fill, edge on paper</span></h2>${row('light')}
  <h2 class="t-h3">Dark paper <span class="muted t-small">fill (it is also the edge), ink letter on fill, fill on paper</span></h2>${row('dark')}
  <h2 class="t-h3">Simulated colour vision <span class="muted t-small">Machado, Oliveira and Fernandes 2009, severity 1</span></h2>
  <div class="sgrid">${simBlock('light')}${simBlock('dark')}</div>
  <p class="t-small muted" style="margin:10px 0 0">Close pairs are almost all on the red-to-green run (C, D, E, F), which collapses to yellows and browns for the 1 in 12 men with a red-green deficiency. They stay apart in lightness where they can (E and F differ by 0.26 in luminance), and the letter on the chip always separates them. Under deuteranopia and protanopia the light edges of F and A come within 3 to 5 of error and ghost: that is why colour never shares a score with marks in option B.</p>
  <h2 class="t-h3">Chip, dense rhythm, low notes, settings</h2>
  <div class="cgrid">
    <div class="card cc"><p class="state-label">“Always” at difficulty 6: eighths</p><div class="paper pp">${denseSvg}</div><p class="t-small muted">Where two chips would touch, the second becomes a dot in its colour. The first note of every beat keeps its letter.</p></div>
    <div class="card cc"><p class="state-label">Low notes with ledger lines (bass G2, E2)</p><div class="paper pp">${lowSvg}</div><p class="t-small muted">The band drops below the lowest ledger line in the system, like the lane glyphs.</p></div>
    <div class="card cc"><p class="state-label">Chip</p>${anat}</div>
    ${settings}
  </div>
</main>
<style>
.pal h2 { margin: 26px 0 10px; display: flex; gap: 12px; align-items: baseline; }
.prow { display: grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap: 8px; padding: 16px; border-radius: 16px; border: 1px solid var(--border); }
.pt { display: grid; gap: 4px; justify-items: start; font-size: 11.5px; color: var(--text); }
.pt .ch { width: 100%; height: 54px; border-radius: 12px; border: 2px solid; display: grid; place-items: center; text-align: center; font: 650 17px/1.05 var(--font-text); color: ${NC.PITCH_ON}; }
.pt .nm { font-weight: 600; font-size: 12.5px; }
.pt code { font-size: 11px; color: var(--text); background: none; padding: 0; }
.pt code.e, .pt .ct { color: var(--text-muted); }
.sgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.simb { border-radius: 16px; border: 1px solid var(--border); padding: 14px 16px; }
.simb .sh { margin: 0 0 8px; font-weight: 600; font-size: 14px; display: flex; gap: 10px; align-items: baseline; }
.simb .sh span { font-weight: 400; font-size: 12px; color: var(--text-muted); }
.srow2 { display: flex; align-items: center; gap: 5px; padding: 5px 0; border-top: 1px solid var(--border); }
.srow2 .sl { width: 92px; font-size: 12px; font-weight: 600; flex: none; }
.ssw { width: 30px; height: 26px; border-radius: 7px; border: 1.5px solid; display: grid; place-items: center; font: 650 13px/1 var(--font-text); color: ${NC.PITCH_ON}; flex: none; }
.fbsw { display: grid; justify-items: center; gap: 1px; width: 38px; flex: none; }
.fbsw i { width: 14px; height: 14px; border-radius: 50%; display: block; }
.fbsw small { font-size: 9.5px; color: var(--text-muted); }
.srow2 .gap { width: 6px; }
.srow2 .close { font-size: 11.5px; color: var(--text-muted); margin-left: 6px; line-height: 1.3; }
.cgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
.cc .pp { display: inline-block; }
.cc { padding: 14px 16px; }
.cc .pp { padding: 4px 10px; box-shadow: none; border: 1px solid var(--border); border-radius: 12px; }
.cc .t-small { margin: 8px 0 0; }
.setc { padding: 14px 16px; }
.srowx { display: grid; gap: 6px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 13px; }
.srowx small { display: block; color: var(--text-muted); font-size: 12px; margin-top: 2px; }
.srowx .seg { justify-self: start; }
.srowx .seg-btn { min-height: 30px; font-size: 12.5px; padding: 0 10px; }
.kleg { margin-top: 8px; width: 280px; }
.kleg .kb-brackets { display: none; }
.kl { display: grid; grid-template-columns: repeat(7, 1fr); margin-top: 4px; }
.kl span { display: grid; place-items: center; }
.kl b { display: grid; place-items: center; width: 26px; height: 20px; border-radius: 6px; border: 1px solid; font: 650 12px/1 var(--font-text); color: ${NC.PITCH_ON}; }
</style>`;
  return page({ title: 'Note colours: palette', body: sizes('desktop') + themes('light') + body });
}

// ---------------------------------------------------------------- Side by side: A, B and C on bars 5 to 8
function compareSheet() {
  const bars = D1.slice(4, 6);
  const sys = (o) => P.engrave({ clef: 'bass', key: FKEY, time: null, bars, perSystem: 2, width: 400, sp: 11, topPad: 3.4 * 11, noFinal: true, ...o }).svg;
  const live = { b1n1: { lane: 'dot' }, b1n2: { state: 'error', lane: 'wrong', ghost: { p: 'A3', dx: 0.85 } }, b1n3: { lane: 'dot' }, b1n4: { lane: 'dot' }, b2n1: { lane: 'dot' } };
  const rev = { b1n2: { state: 'error', lane: 'wrong', ghost: { p: 'A3', dx: 0.85 } }, b2n2: { state: 'missed', lane: 'missed' } };
  const cell = (svg, cap) => `<div class="cmp"><div class="paper cp">${svg}</div><p>${cap}</p></div>`;
  const A = {
    read: cell(sys({ headFill: head, showLane: false, bottomPad: 2 * 11 }), 'Every notehead in its colour. Layout as today.'),
    take: cell(sys({ headFill: head, marks: live, playheadBar: 2 }), 'Colour stays. The wrong B♭ turns red next to a red C, and the violet ghost sits beside a purple A.'),
    res: cell(sys({ headFill: head, marks: rev, ghostStyle: 'review' }), 'Marks drawn over colour. Must count as practice.'),
  };
  const B = {
    read: cell(sys({ overlay: band(), bottomPad: 0.4 * 11 }), 'Ink noteheads, a chip with the letter under each, in the lane slot.'),
    take: cell(sys({ marks: live, playheadBar: 2, bottomPad: 0.4 * 11 }), 'The band has gone by bar 1. The lane holds only feedback.'),
    res: cell(sys({ overlay: band(), bottomPad: 0.4 * 11 }), 'Clean score shows the band. “My marks” is today’s, with no colour.'),
  };
  const C = {
    read: cell(sys({ bottomPad: 0.4 * 11 }) + `<div class="cbtn"><span class="help-btn">${dots7()}Show note help</span></div>`, 'Ink only. The same band as B appears while “Show note help” is on.'),
    take: cell(sys({ marks: live, playheadBar: 2, bottomPad: 0.4 * 11 }), 'Same as B.'),
    res: cell(sys({ bottomPad: 0.4 * 11 }), 'Ink only, with the same button.'),
  };
  const col = (k, o, verdict) => `<section class="ccol"><h2><span class="tag">${OPT[k].id}</span>${OPT[k].name}</h2>${o.read}${o.take}${o.res}<p class="verdict">${verdict}</p></section>`;
  const body = `<main class="fb">
  <h1 class="t-title">Options A, B and C on the same bars</h1>
  <p class="lead">Bars 5 and 6 of Melody in F major, baritone, difficulty 1. Rows: the read-through, a moment mid-try (C4 right, B♭3 sung as A3: red head, ✕ and a violet heard note; “Show played notes live” set to Always so the heard note shows), and the results.</p>
  <div class="rlab"><span>Read-through</span><span>Mid-try</span><span>Results</span></div>
  <div class="cgrid3">
    ${col('a', A, '<b>Most familiar from classrooms.</b> Colour and feedback share the noteheads, and a red C, a red mistake and a purple A beside a violet heard note are one glance apart. Ranked tries would count as practice.')}
    ${col('b', B, '<b>Recommended.</b> The colour labels the written note while you study it, and is gone before you are marked. Ranked tries are unchanged. One more row in the read-through.')}
    ${col('c', C, '<b>Quietest.</b> Today’s screen until asked. Few players will find the button, so it helps least.')}
  </div>
</main>
<style>
.cgrid3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 18px; }
.ccol { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 16px 16px 18px; }
.ccol h2 { font-size: 17px; margin: 0 0 12px; display: flex; gap: 10px; align-items: center; }
.ccol .tag { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--text); color: var(--surface); font-weight: 700; }
.cmp { margin-bottom: 12px; }
.cmp .cp { padding: 2px 10px; box-shadow: none; border: 1px solid var(--border); border-radius: 12px; position: relative; }
.cmp p { margin: 6px 2px 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.4; min-height: 35px; }
.cbtn { position: absolute; right: 10px; bottom: 8px; }
.cbtn .help-btn { min-height: 28px; font-size: 12px; padding: 0 10px; }
.verdict { margin: 4px 2px 0; font-size: 13.5px; line-height: 1.45; }
.rlab { display: none; }
</style>`;
  return page({ title: 'Options A, B and C side by side', body: sizes('desktop') + body });
}

// ---------------------------------------------------------------- Write
const files = {
  'nc.css': NC_CSS,
  'palette.html': paletteSheet(),
  'compare.html': compareSheet(),
  'b-fade.html': fadeBoard(),
  'b-scan-degree.html': scanPage('b', { mode: 'degree', only: 'desktop', key: false }).replace('<meta name="sizes" content="desktop">', '<meta name="sizes" content="desktop"><meta name="themes" content="light">'),
  'b-scan-key.html': scanPage('b', { key: true, only: 'desktop' }).replace('<meta name="sizes" content="desktop">', '<meta name="sizes" content="desktop"><meta name="themes" content="light">'),
  'c-scan-on.html': scanPage('c', { on: true }),
};
for (const o of ['a', 'b', 'c']) {
  files[`${o}-scan.html`] = scanPage(o);
  files[`${o}-take.html`] = takePage(o);
  files[`${o}-results.html`] = resultsPage(o);
  files[`${o}-match.html`] = matchPage(o);
  files[`${o}-picker.html`] = pickerPage(o);
}
for (const [name, html] of Object.entries(files)) writeFileSync(join(OUT, name), html);
console.log('wrote', Object.keys(files).length, 'files to', OUT);
