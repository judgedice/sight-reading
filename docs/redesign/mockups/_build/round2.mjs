// Round 2 mockups: the owner's second walk. Writes docs/redesign/round2/mockups/*.html.
// Run: node docs/redesign/mockups/_build/round2.mjs, then node docs/redesign/mockups/_build/render2.cjs
// Every screen is the owner's own state: Baritone voice, difficulty 1, F major, built-in speakers, not calibrated.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './parts.mjs';
import { RES_CSS, SCAN_CSS, modeChip, liveCap, PERF_CSS } from './screens2.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'round2', 'mockups');
mkdirSync(OUT, { recursive: true });
const { icon, T } = P;

// ---------------------------------------------------------------- Data
// Difficulty 1, F major, 4/4, quarters and halves, inside C3 to C4. Bar 4 ends on a half note and a half rest:
// the place where the owner's voice trailed into the rest and drew a ghost and a "+".
export const D1 = [
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
const score1 = (o) => P.engrave({ clef: 'bass', key: FKEY, time: [4, 4], bars: D1, barNumbers: true, hlFirstOnly: true, ...o });
const SUM1 = `Difficulty 1 · F major · 4/4 · ${T(60)} · 8 bars`;
const TITLE = 'Melody in F major';
const BARI = P.BARI;

// ---------------------------------------------------------------- Timings from the code (05 R17)
// The frames board reads its times from the session code, not from numbers typed here.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'src', 'session');
const num = (text, re, name) => {
  const m = text.match(re);
  if (!m) throw new Error(`round2.mjs: could not read ${name} from src/session`);
  return +m[1];
};
const takePlanTs = readFileSync(join(SRC, 'take-plan.ts'), 'utf8');
const sessionTs = readFileSync(join(SRC, 'practice-session.ts'), 'utf8');
const VR = {
  triadToneSec: num(takePlanTs, /VOICE_REFERENCE = \{[^}]*triadToneSec:\s*([\d.]+)/, 'VOICE_REFERENCE.triadToneSec'),
  gapSec: num(takePlanTs, /VOICE_REFERENCE = \{[^}]*gapSec:\s*([\d.]+)/, 'VOICE_REFERENCE.gapSec'),
  firstNoteSec: num(takePlanTs, /VOICE_REFERENCE = \{[^}]*firstNoteSec:\s*([\d.]+)/, 'VOICE_REFERENCE.firstNoteSec'),
  leadSec: num(sessionTs, /VOICE_REFERENCE_LEAD_SEC = ([\d.]+)/, 'VOICE_REFERENCE_LEAD_SEC'),
  // The first click comes one beat after the first note ends: `firstClickAt = ref.end + 60 / plan.bpm`. The board is at 60 bpm.
  afterSec: sessionTs.includes('firstClickAt = ref.end + 60 / plan.bpm') ? 60 / 60 : num('', /(x)/, 'the one-beat gap after the reference in practice-session.ts'),
};
// Same arithmetic as voiceReferenceTones(): three chord tones, one extra gap, then the first note.
const REF_T = (() => {
  const at = [];
  let t = 0;
  for (let i = 0; i < 3; i++) { at.push(t); t += VR.triadToneSec + VR.gapSec; }
  t += VR.gapSec;
  const first = t;
  const end = first + VR.firstNoteSec;
  const s = (x) => VR.leadSec + x; // seconds from pressing Start
  const countIn = s(end) + VR.afterSec;
  return { chord: at.map(s), first: s(first), end: s(end), countIn, beat: 60 / 60 };
})();
const sec = (x) => `${x.toFixed(2).replace(/\.?0+$/, '')} s`;

const sizes = (s) => `<meta name="sizes" content="${s}">`;
const themes = (s) => `<meta name="themes" content="${s}">`;
function page({ title, body, cls = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../../mockups/mockup.css">
<link rel="stylesheet" href="round2.css">
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

// Range figure with sound: which of the four notes is playing (0 to 3), and the keyboard key under it.
function rangeFigure2({ width = 400, sp = 10, kb = true, playIndex = -1, level = 1, legend = true, voiceLine = true, compactKb = false, served = null }) {
  const inst = served ? { ...BARI, served } : BARI;
  const rp = P.rangePicture({ clef: inst.clef, full: inst.full, served: inst.served, width, sp, playIndex });
  const mids = [inst.full[0], inst.served[0], inst.served[1], inst.full[1]];
  const labels = rp.labels.map((l, i) => `<button class="note-btn ${l.kind} ${i === playIndex ? 'is-playing' : ''}" style="left:${((l.x / width) * 100).toFixed(2)}%" aria-label="Hear ${l.name}">${icon(i === playIndex ? 'speaker' : 'play')}${l.name}</button>`).join('');
  return `<figure class="range-figure">
  <div class="range-stage">${rp.svg}<div class="range-labels">${labels}</div></div>
  ${kb ? P.keyboard({ loM: 36, hiM: 72, full: inst.full, served: inst.served, width: 400, height: compactKb ? 30 : 36, pressed: playIndex >= 0 ? mids[playIndex] : -1 }) : ''}
  ${legend ? `<figcaption class="range-legend">
    <div><span class="sw full"></span><span>Full range: <b>G2 to G4</b></span></div>
    <div><span class="sw served"></span><span>At difficulty ${level}: <b>${P.midiName(inst.served[0])} to ${P.midiName(inst.served[1])}</b></span></div>
    ${voiceLine ? `<div class="muted" style="padding-left:28px">Sing in any octave that suits you. Pitch is marked relative to your starting note.</div>` : ''}
  </figcaption>` : ''}
</figure>`;
}

const ringSvg = (frac, s = 22) => P.ring(frac, s).replace('class="ring"', `class="ring" style="width:${s}px;height:${s}px"`);

// ---------------------------------------------------------------- Calibration status
// state: 'none' | 'ok' | 'changed' | 'failed'
const CAL = {
  none: { cls: '', ic: 'speaker', text: 'Not calibrated' },
  ok: { cls: 'ok', ic: 'check', text: 'Calibrated for MacBook Pro Speakers · today' },
  okShort: { cls: 'ok', ic: 'check', text: 'Calibrated · today' },
  changed: { cls: 'changed', ic: 'caution', text: 'Output changed to AirPods. Calibrate again' },
  failed: { cls: '', ic: 'speaker', text: "Calibration didn't finish" },
};
const calPill = (s = 'none', open = false) => {
  const c = CAL[s];
  return `<button class="cal-pill ${c.cls} ${open ? 'is-open' : ''}" aria-haspopup="dialog" aria-expanded="${open}">${icon(c.ic, c.cls === 'ok' ? 'sm tick' : 'sm')}<span>${c.text}</span>${icon('chevD', 'chev')}</button>`;
};
const CAL_POP = {
  none: { t: 'Not calibrated', b: 'Tries count as practice until you calibrate. It takes about 20 seconds.', a: 'Calibrate' },
  ok: { t: 'Calibrated for MacBook Pro Speakers', b: 'Your setup adds 42 ms. We take it off every note, so early and late are fair.', a: 'Calibrate again' },
  changed: { t: 'Output changed', b: "You calibrated for MacBook Pro Speakers. Timing for AirPods isn't measured yet.", a: 'Calibrate again' },
  failed: { t: "Calibration didn't finish", b: 'We heard 3 of 10 ticks, not enough to time them. You can try again or keep practising.', a: 'Calibrate' },
};
const calPop = (s, extra = '') => `<div class="popover cal-pop" role="dialog" aria-label="Calibration"><p class="t-label" style="margin:0 0 4px">${CAL_POP[s].t}</p><p style="margin:0" class="t-small">${CAL_POP[s].b}</p>${extra}<div class="acts"><button class="btn btn-primary btn-compact">${CAL_POP[s].a}</button><button class="btn btn-quiet btn-compact">Settings</button></div></div>`;

// ---------------------------------------------------------------- Practice
function keyChip(name, key, on) {
  return `<button class="kchip ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}">${key ? `<span class="sig">${P.miniKey({ clef: 'bass', key, sp: 4.4, width: 64 })}</span>` : ''}<span>${name}</span>${on ? `<span class="ck">${icon('check')}</span>` : ''}</button>`;
}
// R4: the same right panel at higher difficulties. Keys become one button with a popover; time signatures show all
// when they fit (up to 7), else Any, the five most used and More; Length gets its own row when there is a choice.
const MAJ = [['C', 0, ''], ['G', 1, '#'], ['F', 1, 'b'], ['D', 2, '#'], ['B♭', 2, 'b'], ['A', 3, '#'], ['E♭', 3, 'b'], ['E', 4, '#'], ['A♭', 4, 'b'], ['B', 5, '#'], ['D♭', 5, 'b'], ['F♯', 6, '#'], ['G♭', 6, 'b'], ['C♯', 7, '#'], ['C♭', 7, 'b']];
const MIN = [['A', 0, ''], ['E', 1, '#'], ['D', 1, 'b'], ['B', 2, '#'], ['G', 2, 'b'], ['F♯', 3, '#'], ['C', 3, 'b'], ['C♯', 4, '#'], ['F', 4, 'b'], ['G♯', 5, '#'], ['B♭', 5, 'b'], ['D♯', 6, '#'], ['E♭', 6, 'b'], ['A♯', 7, '#'], ['A♭', 7, 'b']];
const LEVELS = {
  5: { desc: 'Syncopation, mixed sixteenths, 4 accidentals', maxAcc: 4, meters: ['4/4', '3/4', '2/4', '6/8', '2/2', '3/8', '3/2'], tempo: [72, 112], bars: [8, 9, 10], xp: 24 },
  10: { desc: 'Anything in range, free chromatic writing', maxAcc: 7, meters: ['4/4', '3/4', '2/4', '6/8', '2/2', '3/8', '3/2', '9/8', '12/8', '5/4', '5/8', '6/4', '7/8', '7/4', '11/8', '4/2', '4/8', '6/16', '9/16', '12/16'], tempo: [92, 176], bars: [8, 9, 10, 11, 12], xp: 24 },
};
const keyChipW = (name, k, on = false) => keyChip(name, k[1] ? { type: k[2], count: k[1] } : { count: 0 }, on).replace('class="kchip', 'class="kchip w');
function keyPopover(maxAcc) {
  const grp = (title, list, mode) => `<p class="t-label kp-h">${title}</p><div class="kp-grid">${list.filter((k) => k[1] <= maxAcc).map((k) => keyChipW(k[0], k, false).replace("class=\"kchip", `aria-label="${k[0]} ${mode}" class="kchip`)).join('')}</div>`;
  return `<div class="popover kpop" role="dialog" aria-label="Choose a key">${grp('Major', MAJ, 'major')}${grp('Minor', MIN, 'minor')}<div class="kp-foot"><button class="kchip any is-on">Any key<span class="ck">${icon('check')}</span></button><span class="t-small muted">Pick one key, or Any for more XP.</span></div></div>`;
}
function setPanelHigh(level, keyPop) {
  const L = LEVELS[level];
  const segs = Array.from({ length: 10 }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
  const nKeys = 2 * (2 * L.maxAcc + 1);
  const ts = (m) => { const [a, b] = m.split('/'); return `<button class="seg-btn">${P.timeSigGlyph(+a, +b, 6)}</button>`; };
  const meters = L.meters.length <= 7 ? L.meters.map(ts).join('') : L.meters.slice(0, 5).map(ts).join('') + `<button class="seg-btn more" aria-haspopup="dialog">More<small>${L.meters.length - 5}</small>${icon('chevD', 'sm')}</button>`;
  return `<section class="card p2-set" aria-label="Setup">
      <div class="frow"><p class="t-label">Difficulty</p><div>
        <div class="ctl"><div class="stepper"><button aria-label="Easier">${icon('minus')}</button><div class="val num">${level}&nbsp;<small>of 10</small></div><button aria-label="Harder">${icon('plus')}</button></div><div class="meter10" aria-hidden="true">${segs}</div></div>
        <p class="sub ink">${L.desc}.</p>
        <p class="sub"><span class="switch" style="color:var(--text)"><span class="switch-track"></span>Follow my progress</span></p>
      </div></div>
      <div class="frow"><p class="t-label">Key</p><div>
        <div class="ctl" style="position:relative"><button class="kchip any kbtn ${keyPop ? 'is-open' : ''}" aria-haspopup="dialog" aria-expanded="${keyPop}">Any key${icon('chevD', 'sm')}</button><span class="t-small muted">${nKeys} keys: major and minor, up to ${L.maxAcc} sharps or flats.</span>${keyPop ? keyPopover(L.maxAcc) : ''}</div>
      </div></div>
      <div class="frow"><p class="t-label">Time signature</p><div>
        <div class="ctl"><div class="seg tseg tseg-many" role="radiogroup" aria-label="Time signature"><button class="seg-btn is-on">Any</button>${meters}</div></div>
      </div></div>
      <div class="frow"><p class="t-label">Tempo</p><div>
        <div class="ctl"><div class="seg"><button class="seg-btn is-on">Any</button><button class="seg-btn">Set</button></div><span class="t-small muted">${T(L.tempo[0])} to ${L.tempo[1]}</span></div>
      </div></div>
      <div class="frow"><p class="t-label">Length</p><div>
        <div class="ctl"><div class="seg lseg" role="radiogroup" aria-label="Length"><button class="seg-btn is-on">Any</button>${L.bars.map((b) => `<button class="seg-btn">${b}</button>`).join('')}</div><span class="t-small muted">bars</span></div>
      </div></div>
      <div class="frow"><p class="t-label">Mode</p><div>
        <div class="ctl"><div class="seg" role="radiogroup" aria-label="Mode" style="display:flex;flex:1"><button class="seg-btn" style="flex:1;flex-direction:row;gap:6px" aria-disabled="true">${icon('caution', 'sm')}Ranked</button><button class="seg-btn is-on" style="flex:1">Practice</button></div></div>
        <p class="sub">Less XP, no time limit. Ranked needs calibration on this device. <button class="qlink">Calibrate</button></p>
      </div></div>
      <div class="p2-foot">
        <p class="p2-xp"><span>Choosing Any: <b>+${L.xp}% XP</b></span></p>
        <button class="btn btn-primary btn-hero btn-block">Start <span class="kbd">Space</span></button>
        <p class="last-try">${icon('history')}Last try: <span class="gl">B</span> 84, ${TITLE} · <button class="qlink">All tries</button></p>
      </div>
    </section>`;
}
function practiceDesktop({ cal = 'none', pop = false, level = 1, keyPop = false } = {}) {
  const segs = Array.from({ length: 10 }, (_, i) => `<i class="${i < 1 ? 'on' : ''}"></i>`).join('');
  return `<div class="only-desktop">
${P.appbar('practice')}
<main class="p2">
  <div class="p2-head">
    <h1 class="t-title">Practice</h1>
    <span class="p2-today">${icon('flame', 'sm')}Streak 1 day · 3 tries · 18 XP today</span>
    <span class="vrule"></span>
    <span class="p2-rank">${ringSvg(0.12)}<b>Novice</b> · 12% to Apprentice</span>
    <span class="vrule"></span>
    <span style="position:relative">${calPill(cal, pop)}${pop ? calPop(cal) : ''}</span>
  </div>
  <div class="p2-grid">
    <section class="card p2-inst" aria-label="Instrument">
      <div class="inst-head">
        <div class="inst-badge"><span class="music">${P.clefGlyph.bass}</span></div>
        <div style="flex:1"><h2 class="t-h2 nb">Baritone voice</h2><p class="t-small muted" style="margin:2px 0 0">Voice · bass clef</p></div>
        <button class="btn btn-secondary btn-compact">Change instrument</button>
      </div>
      <hr class="divider" style="margin:16px 0 10px">
      <div class="row-head" style="margin-bottom:0"><p class="t-label">Your range</p><button class="btn btn-tonal btn-compact">${icon('play', 'sm')}Play my range</button></div>
      ${rangeFigure2({ width: 420, sp: 10.5, level, served: { 1: null, 5: [43, 64], 10: [43, 67] }[level] })}
      <hr class="divider" style="margin:16px 0 14px">
      <button class="match-entry"><span class="ic">${icon('fork')}</span><span class="tx"><b>Match a note</b><span>Sing one note and see if you hit it. Not graded.</span></span>${icon('chevR')}</button>
    </section>

    ${level > 1 ? setPanelHigh(level, keyPop) : `<section class="card p2-set" aria-label="Setup">
      <div class="frow"><p class="t-label">Difficulty</p><div>
        <div class="ctl"><div class="stepper"><button aria-label="Easier">${icon('minus')}</button><div class="val num">1&nbsp;<small>of 10</small></div><button aria-label="Harder">${icon('plus')}</button></div><div class="meter10" aria-hidden="true">${segs}</div></div>
        <p class="sub ink">Steps and small leaps in quarters and halves. <span class="tag tag-caution" title="Few pieces here: some may repeat.">Few pieces</span></p>
        <p class="sub" style="justify-content:space-between"><span class="switch" style="color:var(--text)"><span class="switch-track"></span>Follow my progress</span><span>Simpler? <button class="qlink">Match a note first</button></span></p>
      </div></div>
      <div class="frow"><p class="t-label">Key</p><div>
        <div class="ctl kchips" role="radiogroup" aria-label="Key">${keyChip('Any key', null, true)}${keyChip('C major', { count: 0 }, false)}${keyChip('F major', FKEY, false)}${keyChip('G major', { type: '#', count: 1 }, false)}</div>
        <p class="sub">${icon('info')}<span style="flex:1">Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2.</span></p>
      </div></div>
      <div class="frow"><p class="t-label">Time signature</p><div>
        <div class="ctl"><div class="seg tseg" role="radiogroup" aria-label="Time signature"><button class="seg-btn is-on">Any</button><button class="seg-btn">${P.timeSigGlyph(4, 4, 6)}</button><button class="seg-btn" aria-label="3/4, few pieces" title="Few pieces">${P.timeSigGlyph(3, 4, 6)}<span class="few"></span></button></div><span class="t-small muted">No 2/4 at difficulty 1 yet.</span></div>
      </div></div>
      <div class="frow"><p class="t-label">Tempo</p><div>
        <div class="ctl"><div class="seg"><button class="seg-btn is-on">Any</button><button class="seg-btn">Set</button></div><span class="t-small muted">${T(60)} to 76</span><span style="flex:1"></span><span class="t-label">Length</span><span class="t-small">8 bars</span></div>
      </div></div>
      <div class="frow"><p class="t-label">Mode</p><div>
        <div class="ctl"><div class="seg" role="radiogroup" aria-label="Mode" style="display:flex;flex:1"><button class="seg-btn" style="flex:1;flex-direction:row;gap:6px" aria-disabled="true">${icon('caution', 'sm')}Ranked</button><button class="seg-btn is-on" style="flex:1">Practice</button></div></div>
        <p class="sub">Less XP, no time limit. Ranked needs calibration on this device. <button class="qlink">Calibrate</button></p>
      </div></div>
      <div class="p2-foot">
        <p class="p2-xp"><span>Choosing Any: <b>+16% XP</b></span></p>
        <button class="btn btn-primary btn-hero btn-block">Start <span class="kbd">Space</span></button>
        <p class="last-try">${icon('history')}Last try: <span class="gl">B</span> 84, ${TITLE} · <button class="qlink">All tries</button></p>
      </div>
    </section>`}
  </div>
</main>
</div>`;
}
function practicePhone({ cal = 'none' } = {}) {
  const chev = `<span class="schev">${icon('chevD', 'sm')}</span>`;
  const sc = (k, v, w) => `<button class="schip ${w}" aria-label="${k}: ${v}. Change"><span class="k">${k}</span><span class="v"><span>${v}</span>${chev}</span></button>`;
  const c = CAL[cal];
  return `<div class="only-phone">
${P.appbar('practice')}
<main class="pp">
  <div class="pp-top"><h1 class="t-title">Practice</h1><span class="p2-today">${icon('flame', 'sm')}Streak 1 day · 3 tries · 18 XP</span></div>
  <section class="card summary-card">
    <button class="sum-inst">
      <span class="inst-badge" style="width:44px;height:44px;border-radius:12px"><span class="music" style="font-size:26px">${P.clefGlyph.bass}</span></span>
      <span style="flex:1;text-align:left"><span class="t-h3" style="display:block">Baritone voice</span>
      <span class="t-caption muted" style="display:flex;align-items:center;gap:8px;margin-top:4px">${P.rulerBar({ full: [43, 67], served: [48, 60], width: 88, height: 16 })} C3 to C4 at difficulty 1</span></span>
      ${icon('chevR')}
    </button>
    <div class="sum-grid">${sc('Difficulty', '1', 'w2')}${sc('Key', 'Any', 'w2')}${sc('Time signature', 'Any', 'w2')}${sc('Tempo', 'Any', 'w3')}${sc('Length', '8 bars', 'w3')}</div>
    <button class="pp-cal ${c.cls}">${icon(c.ic, 'sm')}<span>${cal === 'ok' ? 'Calibrated for speakers · today' : c.text}</span><span class="go">${cal === 'ok' ? '' : 'Calibrate'}${icon('chevR', 'sm')}</span></button>
  </section>
  <div class="pp-mode">
    <div class="seg full"><button class="seg-btn" style="flex-direction:row;gap:6px">${icon('caution', 'sm')}Ranked</button><button class="seg-btn is-on">Practice</button></div>
    <p class="hint">Less XP, no time limit. Ranked needs calibration on this device.</p>
  </div>
  <button class="btn btn-primary btn-hero btn-block">Start</button>
  <p class="last-try">${icon('history')}Last try: <span class="gl">B</span> 84 · <button class="qlink">All tries</button></p>
  <button class="pp-match"><span class="ic">${icon('fork', 'sm')}</span><span style="flex:1;text-align:left">Warm up: match a note</span>${icon('chevR', 'sm')}</button>
</main>
${P.tabbar('practice')}
</div>`;
}
function practice() {
  return page({ title: 'Practice, round 2', cls: 'viewport-only', body: practiceDesktop() + practicePhone() });
}
const practiceHigh = (level, keyPop) => page({ title: `Practice at difficulty ${level}`, cls: 'viewport-only', body: sizes('desktop') + practiceDesktop({ level, keyPop }) });

// Calibration status board: every state, where it sits, and the popover.
function calStatus() {
  const st = (label, inner) => `<div class="cs-cell"><p class="state-label">${label}</p>${inner}</div>`;
  const head = (s, pop) => `<div class="cs-head"><span class="p2-today">${icon('flame', 'sm')}Streak 1 day · 3 tries · 18 XP today</span><span class="vrule"></span><span style="position:relative">${calPill(s, pop)}${pop ? calPop(s) : ''}</span></div>`;
  const body = `<main class="fb">
  <h1 class="t-title">Calibration status</h1>
  <p class="lead">One quiet line, always in the same place, from the same test that decides whether Ranked is open. It never pops up by itself. Caution colour only when the output changed since the last calibration.</p>
  <div class="cs-grid">
    ${st('Practice header · not calibrated', head('none'))}
    ${st('Practice header · calibrated', head('ok'))}
    ${st('Practice header · output changed (the only caution)', head('changed'))}
    ${st('Practice header · last run didn\'t finish', head('failed'))}
  </div>
  <div class="cs-grid" style="margin-top:28px;align-items:start">
    ${st('Pressed: popover (not calibrated)', `<div style="height:230px">${head('none', true)}</div>`)}
    ${st('Pressed: popover (output changed)', `<div style="height:230px">${head('changed', true)}</div>`)}
  </div>
  <div class="cs-grid" style="margin-top:8px;align-items:start">
    ${st('Read-through, under Start playing', `<div class="card" style="padding:16px;width:360px"><button class="btn btn-primary btn-hero btn-block">Start playing <span class="kbd">Space</span></button><p class="cal-line">${icon('speaker', 'sm')}Not calibrated<button class="qlink">Calibrate</button></p></div><p class="frame-note">Pressing Calibrate says: <b>We'll bring you back to this music after.</b></p>`)}
    ${st('Read-through, calibrated and changed', `<div class="card" style="padding:16px;width:360px"><p class="cal-line" style="margin:0 2px 10px">${icon('check', 'sm tick')}<span>Calibrated for MacBook Pro Speakers · today</span></p><p class="cal-line" style="margin:0 2px;color:var(--caution)">${icon('caution', 'sm')}<span>Output changed to AirPods ·</span><button class="qlink">Calibrate again</button></p></div><p class="frame-note">Phone read-through: the same line, centred under the meta line.</p>`)}
    ${st('Phone: last line of the summary card', `<div class="card" style="width:362px;padding:4px"><button class="pp-cal ok" style="border-top:0">${icon('check', 'sm tick')}<span>Calibrated for speakers · today</span><span class="go">${icon('chevR', 'sm')}</span></button></div><div class="card" style="width:362px;padding:4px;margin-top:10px"><button class="pp-cal" style="border-top:0">${icon('speaker', 'sm')}<span>Calibration didn't finish</span><span class="go">Calibrate${icon('chevR', 'sm')}</span></button></div>`)}
    ${st('Phone: not calibrated, output changed', `<div class="card" style="width:362px;padding:4px"><button class="pp-cal" style="border-top:0">${icon('speaker', 'sm')}<span>Not calibrated</span><span class="go">Calibrate${icon('chevR', 'sm')}</span></button></div><div class="card" style="width:362px;padding:4px;margin-top:10px"><button class="pp-cal changed" style="border-top:0;color:var(--caution)">${icon('caution', 'sm')}<span>Output changed to AirPods</span><span class="go">Calibrate again${icon('chevR', 'sm')}</span></button></div>`)}
  </div>
</main>
<style>
.cs-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 22px 28px; }
.cs-head .p2-today { font-size: 13px; }
.cs-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-radius: 16px; background: var(--bg); border: 1px dashed var(--border-strong); justify-content: flex-end; }
.cs-cell .popover { text-align: left; }
</style>`;
  return page({ title: 'Calibration status', body: sizes('desktop') + body });
}

// ---------------------------------------------------------------- Instrument picker with sound
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
  .ppanel .pfoot { display: flex; gap: 8px; margin-top: 12px; }
}
</style>`;
const VOICES = [['Soprano', 'treble', [57, 84], [62, 74]], ['Mezzo', 'treble', [55, 81], [60, 72]], ['Alto', 'treble', [52, 77], [57, 69]], ['Tenor', 'treble-8vb', [45, 69], [50, 62]], ['Baritone', 'bass', [43, 67], [48, 60]], ['Bass', 'bass', [40, 65], [45, 57]]];
const vcard = ([name, clef, full, served], w) => {
  const on = name === 'Baritone';
  return `<button class="pcard ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}"><span class="pic"><span class="music">${P.clefGlyph[clef]}</span></span><span class="nm">${name}</span><span class="rg">${P.midiName(full[0])} to ${P.midiName(full[1])}</span><span class="rb">${P.rulerBar({ full, served, width: w, height: 22 })}</span>${on ? `<span class="check">${icon('check')}</span>` : ''}</button>`;
};
const OTHERS = [['Woodwinds', [['Flute', 'flute', [60, 96], [65, 77]], ['Clarinet in B♭', 'clarinet', [50, 89], [53, 68]], ['Alto saxophone', 'sax', [49, 81], [53, 65]]]], ['Brass', [['Trumpet in B♭', 'trumpet', [52, 82], [58, 70]]]], ['Strings', [['Violin', 'violin', [55, 100], [62, 81]], ['Cello', 'cello', [40, 81], [43, 62]]]], ['Keyboard', [['Piano (right hand)', 'piano', [45, 96], [60, 72]]]]];
const icard = ([name, ic, full, served], w) => `<button class="pcard"><span class="pic">${icon(ic, 'lg')}</span><span class="nm">${name}</span><span class="rg">${P.midiName(full[0])} to ${P.midiName(full[1])}</span><span class="rb">${P.rulerBar({ full, served, width: w, height: 22 })}</span></button>`;
const SOUND_LINE = `<p class="snd-line">${icon('speaker')}<span><b>This is how it will sound.</b> The starting pitch, Listen and Match a note use this sung “ah” in baritone range. It's made by the app, not recorded.</span></p>`;
function pickerSound() {
  const playing = 1; // C3, second of four
  const desktop = `<div class="only-desktop"><div class="dialog pdlg" role="dialog" aria-label="Choose your instrument">
  <div class="dlg-head"><div><h2 class="t-title" style="font-size:30px">Choose your instrument</h2><p class="t-small muted" style="margin:4px 0 0">We choose music in your range. Pick a card, then press play to hear it.</p></div><button class="icon-btn" aria-label="Close">${icon('x')}</button></div>
  <div class="pbody">
    <div class="pgrid-pane">
      <section class="pick-group"><h3 class="t-label">Voice</h3><div class="pick-grid voices">${VOICES.map((v) => vcard(v, 200)).join('')}</div></section>
      <div style="display:grid;grid-template-columns:3fr 1fr;column-gap:10px">${OTHERS.slice(0, 2).map(([g, cs]) => `<section class="pick-group"><h3 class="t-label">${g}</h3><div class="pick-grid" style="grid-template-columns:repeat(${cs.length},minmax(0,1fr))">${cs.map((c) => icard(c, 150)).join('')}</div></section>`).join('')}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;column-gap:10px">${OTHERS.slice(2).map(([g, cs]) => `<section class="pick-group"><h3 class="t-label">${g}</h3><div class="pick-grid" style="grid-template-columns:repeat(${cs.length},minmax(0,1fr))">${cs.map((c) => icard(c, 150)).join('')}</div></section>`).join('')}</div>
    </div>
    <aside class="picked" aria-live="polite">
      <p class="t-eyebrow" style="margin:0 0 6px">Selected</p>
      <h3 class="t-h2">Baritone voice</h3>
      <p class="t-small muted" style="margin:4px 0 14px">Shown at difficulty 1.</p>
      <div class="snd-row"><button class="btn btn-secondary btn-compact btn-play is-playing">${icon('stop', 'sm')}Stop</button>${liveCap('Playing C3')}<span class="play-steps" aria-hidden="true"><i class="done"></i><i class="on"></i><i></i><i></i></span></div>
      <p class="t-caption muted" style="margin:0 0 4px">Lowest, your notes at difficulty 1, highest.</p>
      ${rangeFigure2({ width: 394, sp: 10.5, playIndex: playing })}
      ${SOUND_LINE}
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
  <section class="ppanel" aria-live="polite" aria-label="Selected instrument">
    <div class="ph"><h3 class="t-h3">Baritone voice</h3><button class="btn btn-secondary btn-compact btn-play is-playing">${icon('stop', 'sm')}Stop</button></div>
    <div style="display:flex;align-items:center;gap:10px">${liveCap('Playing C3')}<span class="t-caption muted" style="margin-left:auto">2 of 4</span></div>
    ${rangeFigure2({ width: 358, sp: 8.5, kb: false, playIndex: playing, voiceLine: false })}
    <p class="snd-line">${icon('speaker')}<span><b>This is how it will sound:</b> a sung “ah” made by the app, in baritone range.</span></p>
  </section>
</div>`;
  return page({ title: 'Instrument picker with sound', cls: 'viewport-only', body: PICK_CSS + desktop + phone });
}
// Idle state of the same panel: before anything plays.
function pickerIdle() {
  const panel = `<aside class="picked" style="width:452px;border:1px solid var(--border);border-radius:20px;padding:22px 28px;background:var(--surface)">
      <p class="t-eyebrow" style="margin:0 0 6px">Selected</p>
      <h3 class="t-h2">Baritone voice</h3>
      <p class="t-small muted" style="margin:4px 0 14px">Shown at difficulty 1.</p>
      <div class="snd-row"><button class="btn btn-secondary btn-compact btn-play">${icon('play', 'sm')}Play my range</button><span class="t-caption muted">or tap one note</span></div>
      <p class="t-caption muted" style="margin:0 0 4px">Lowest, your notes at difficulty 1, highest.</p>
      ${rangeFigure2({ width: 394, sp: 10.5 })}
      ${SOUND_LINE}
    </aside>`;
  const fallback = `<aside class="picked" style="width:452px;border:1px solid var(--border);border-radius:20px;padding:22px 28px;background:var(--surface)">
      <p class="t-eyebrow" style="margin:0 0 6px">Selected</p>
      <h3 class="t-h2">Euphonium</h3>
      <div class="snd-row" style="margin-top:14px"><button class="btn btn-secondary btn-compact btn-play">${icon('play', 'sm')}Play my range</button></div>
      <p class="snd-line">${icon('info')}<span>There's no euphonium sound yet. You'll hear a trombone.</span></p>
      <p class="snd-line warn">${icon('caution')}<span>That sound didn't play. Check your volume and try again.</span></p>
    </aside>`;
  const body = `<main class="fb"><h1 class="t-title">Picker panel states</h1><p class="lead">Nothing plays when a card is chosen. Sound starts only on a press. While a note sounds its chip, its notehead and its key are brass. Choosing another card, closing the picker or pressing Stop ends the sound at once.</p>
  <div style="display:flex;gap:28px;align-items:flex-start"><div><p class="state-label">Idle</p>${panel}</div><div><p class="state-label">Stand-in sound, and audio blocked</p>${fallback}</div></div></main>`;
  return page({ title: 'Picker panel states', body: sizes('desktop') + body });
}

// ---------------------------------------------------------------- Match a note
const MT_STAFF = (state = '', sp = 17) => P.engrave({ clef: 'bass', key: null, time: null, bars: [[{ p: 'E3', d: 'w' }]], perSystem: 1, noFinal: true, width: 10.5 * sp, sp, showLane: false, topPad: 3.2 * sp, bottomPad: 1.2 * sp, marks: state ? { b1n1: { state: state === 'hit' ? 'hit' : '', ring: state === 'hit' ? 'hit' : state === 'play' ? 'brass' : undefined } } : {} }).svg;
// R11: direction in words, with the chevron on the side the needle is on (low: left of the words, high: right).
// R10: the hit is possible for a baritone: E3 sung as E3. The octave line shows only for an octave inside his range.
const MSTATES = {
  idle: { st: `${icon('speaker')}Listen…`, quiet: true, you: '', pos: null, off: true, foot: 'The note plays for 1.5 seconds. The microphone opens after it.', staff: 'play', dots: 1 },
  listening: { st: 'Sing E3 and hold it.', quiet: true, you: '<span class="mt-mic">Mic <span class="mic"><span class="bars"><i class="on" style="height:5px"></i><i class="on" style="height:8px"></i><i style="height:12px"></i><i style="height:9px"></i></span></span></span>', pos: null, foot: 'The needle moves when we hear a steady note.', dots: 1 },
  flat: { st: `${icon('chevU')}A little low. Go up.`, you: 'You: <b>E3</b>, 34 cents low', pos: -34, foot: 'Lift it a little until the needle sits in the middle.', dots: 1 },
  sharp: { st: `A little high. Go down.${icon('chevD')}`, you: 'You: <b>E3</b>, 29 cents high', pos: 29, foot: 'Ease it down a little.', dots: 1 },
  hit: { st: `${icon('check')}You hit it: E3.`, hit: true, you: 'You: <b>E3</b>, 6 cents high', pos: 6, foot: 'Next note in 1.5 seconds.', staff: 'hit', dots: 1, hitNow: true },
  nosignal: { st: "We can't hear a steady note yet.", quiet: true, you: '', pos: null, off: true, foot: 'Move a little closer to the mic and hold one note.', dots: 1 },
  farUp: { st: `${icon('chevU')}Higher. Try E3.`, you: 'You: <b>B2</b>, 5 semitones low', pos: -50, pin: true, foot: 'Slide up slowly. The needle comes in when you are close.', dots: 1 },
  farDown: { st: `Lower. Try E3.${icon('chevD')}`, you: 'You: <b>A3</b>, 5 semitones high', pos: 50, pin: true, foot: 'Slide down slowly. The needle comes in when you are close.', dots: 1 },
  octave: { st: 'Right note, wrong octave.', inst: 'Cello', you: 'You: <b>E4</b>. Play E3, an octave lower.', pos: 4, noGreen: true, foot: 'Instruments match the octave. Voices do not need to.', dots: 1 },
  nomic: { st: 'Matching a note needs the microphone.', quiet: true, you: '', pos: null, off: true, foot: '', act: '<button class="btn btn-primary btn-compact">' + icon('mic', 'sm') + 'Allow microphone</button>', dots: 1 },
};
// pos: cents (-50..50) or null. band: ±25. pin: off the scale, needle held at the edge.
function meter(pos, { off = false, pin = false, noGreen = false } = {}) {
  const X = (c) => `${50 + c}%`;
  const inBand = pos !== null && Math.abs(pos) <= 25 && !noGreen;
  return `<div class="meter ${off ? 'off' : ''}" role="meter" aria-valuemin="-50" aria-valuemax="50" ${pos === null ? '' : `aria-valuenow="${pos}"`} aria-label="Pitch against the note">
  <div class="trk"></div><div class="band" style="left:${X(-25)};width:50%"></div>
  ${[-50, -25, 25, 50].map((c) => `<span class="tk" style="left:${X(c)}"></span>`).join('')}<span class="tk c" style="left:50%"></span>
  <span class="lbl l">Low</span><span class="lbl" style="left:50%">In tune</span><span class="lbl r">High</span>
  ${pos === null ? '' : `<span class="needle ${inBand ? 'in' : ''} ${pin ? 'pin' : ''}" style="left:${X(Math.max(-48, Math.min(48, pos)))}"></span>`}
</div>`;
}
const mDots = (s, n = 5) => [0, 1, 2, 3, 4].slice(0, n).map((i) => `<i class="${i < s.dots - 1 || (s.hitNow && i === s.dots - 1) ? 'hit' : i === s.dots - 1 ? 'now' : ''}"></i>`).join('');
function matchFull(state = 'flat', { onb = false } = {}) {
  const s = MSTATES[state];
  const dots = mDots(s);
  const right = onb ? `<span class="prog"><span class="only-desktop">Step 4 of 6</span><button class="btn btn-quiet btn-compact">Skip</button></span>` : `<span class="prog"><span class="only-desktop">Note ${s.dots} of 5</span><span class="mt-dots">${dots}</span></span>`;
  const stText = onb && s.hit ? `${icon('check')}We heard you clearly.` : s.st;
  const foot = onb && s.hit ? "You're ready. Continue when you like." : s.foot;
  const inner = (phone) => `<header class="mt-bar" style="position:relative"><button class="btn btn-quiet btn-compact">${icon('chevL')}${phone || onb ? '' : 'Practice'}</button><span class="ttl">${onb ? 'Sing one note' : 'Match a note'}</span>${right}</header>
<main class="mt">
  ${onb ? '<p class="mt-lead">A quick check that we hear you. Not graded.</p>' : ''}
  <div class="mt-target"><div class="paper">${MT_STAFF(s.staff, phone ? 13 : 17)}</div><div class="mt-name">E3<small>Listen, then sing it.</small></div></div>
  <p class="mt-state ${s.quiet ? 'quiet' : ''} ${s.hit ? 'hit' : ''}" aria-live="polite">${stText}</p>
  <p class="mt-you">${s.you}</p>
  ${meter(s.pos, s)}
  <p class="t-small muted" style="margin:6px 0 0;text-align:center">${foot}</p>
  ${onb
    ? `<div class="mt-acts">${s.hit ? `<button class="btn btn-secondary">${icon('play', 'sm')}Play it again</button><button class="btn btn-primary">Continue${icon('arrowR', 'sm')}</button>` : `<button class="btn btn-secondary">${icon('play', 'sm')}Play it again</button>`}</div>`
    : `<div class="mt-acts"><button class="btn btn-secondary">${icon('play', 'sm')}Play it again</button></div>
  <div class="mt-pick"><span>Or tap a note in your range:</span>${['C3', 'E3', 'G3', 'C4'].map((n) => `<button class="note-btn served ${n === 'E3' ? 'cur' : ''}" style="${n === 'E3' ? '' : 'background:var(--surface);color:var(--text);border-color:var(--border)'}">${n}</button>`).join('')}</div>`}
</main>`;
  return `<div class="only-desktop">${inner(false)}</div><div class="only-phone">${inner(true)}</div>`;
}
function match() {
  return page({ title: 'Match a note', cls: 'viewport-only', body: matchFull('flat') });
}
function matchHit() {
  return page({ title: 'Match a note: hit', cls: 'viewport-only', body: matchFull('hit') });
}
function matchOnboarding() {
  return page({ title: 'Onboarding: sing one note', cls: 'viewport-only', body: matchFull('hit', { onb: true }) });
}
function matchStates() {
  const panel = (k, label) => {
    const s = MSTATES[k];
    return `<section class="card mb"><p class="state-label">${label}</p>
    <div class="head"><div class="paper" style="padding:0 10px;border-radius:12px;box-shadow:none;border:1px solid var(--border)">${MT_STAFF(s.staff, 9)}</div><span class="nm">E3</span>${s.inst ? `<span class="t-small muted" style="margin-left:auto">${s.inst}</span>` : ''}</div>
    <p class="st ${s.quiet ? 'quiet' : ''} ${s.hit ? 'hit' : ''}">${s.st}</p>
    <p class="you">${s.you}</p>
    ${meter(s.pos, s)}
    <p class="foot">${s.foot}</p>${s.act ? `<div style="margin-top:4px">${s.act}</div>` : ''}</section>`;
  };
  const summary = `<section class="card mb"><p class="state-label">11 · Round summary, after note 5</p>
    <div class="head"><span class="mt-dots big"><i class="hit"></i><i class="hit"></i><i class="hit"></i><i class="hit"></i><i></i></span></div>
    <p class="st">4 of 5 hit.</p>
    <p class="you">On average you were 8 cents low.</p>
    <p class="foot" style="min-height:0">Nothing is graded or saved. Practice and History are unchanged.</p>
    <div class="mb-acts"><button class="btn btn-primary btn-compact">Five more</button><button class="btn btn-secondary btn-compact">Done</button></div></section>`;
  const onb = `<section class="card mb"><p class="state-label">12 · Onboarding step: one note, never moves on by itself</p>
    <p class="t-label" style="margin:2px 0 0">Sing one note</p><p class="t-small muted" style="margin:2px 0 0">A quick check that we hear you. Not graded.</p>
    <p class="st hit">${icon('check')}We heard you clearly.</p>
    <p class="you">You: <b>E3</b>, 6 cents high</p>
    <p class="foot" style="min-height:0">You're ready. Continue when you like.</p>
    <div class="mb-acts"><button class="btn btn-primary btn-compact">Continue</button><button class="btn btn-quiet btn-compact">Skip</button></div></section>`;
  const body = `<main class="fb"><h1 class="t-title">Match a note: states</h1>
  <p class="lead">One note, a needle you can read from across the room. The band is the in-tune window at difficulty 1 (voice ±25 cents). Low and high are said in words, with the chevron on the needle's side, never red: this is a warm-up, not a grade. A hit needs 0.8 s inside the band. In a round the next note comes 1.5 s after a hit; a note chosen from the range chips stays until another is chosen.</p>
  <div class="mb-grid">${panel('idle', '1 · Idle: the note is playing')}${panel('listening', '2 · Listening')}${panel('flat', '3 · Low')}${panel('sharp', '4 · High')}${panel('hit', '5 · In tune: hit')}${panel('nosignal', '6 · No signal after 6 s')}${panel('farUp', '7 · Too far low for 2 s')}${panel('farDown', '8 · Too far high for 2 s')}${panel('octave', '9 · Instruments: right note, wrong octave')}${panel('nomic', '10 · No microphone')}${summary}${onb}</div></main>
<style>@media (max-width:700px){ .mb-grid { grid-template-columns: 1fr; } .fb { padding: 18px 14px 40px; } }</style>`;
  return page({ title: 'Match a note: states', body });
}

// ---------------------------------------------------------------- Before playing: reference and count-in
const RANGE_FIRST = 'F3';
function cueRef(step) {
  // step: 0 card only, 1 chord, 2 first note, 3 gap
  const chord = step === 1 ? liveCap('Key chord: F major') : step > 1 ? `<span class="st done">${icon('check')}Key chord: F major</span>` : '<span class="st wait">Key chord</span>';
  const first = step === 2 ? liveCap('First note: F3') : step > 2 ? `<span class="st done">${icon('check')}First note: F3</span>` : '<span class="st wait">First note</span>';
  const next = step === 3 ? '<span class="st next">Count-in next</span>' : '';
  return `<div class="ref-card" role="status"><span class="ic">${icon('pitch')}</span><h2>Your starting pitch</h2><p class="why">So you know where to begin: the key chord, then your first note. You don't need to sing yet.</p><div class="ref-steps2">${chord}${first}${next}</div></div>`;
}
// bar: 1 or 2 (of 2); beat 1..4; 0 = before
function cueCount(bar, beat) {
  const cells = (b) => [1, 2, 3, 4].map((n) => {
    const st = b < bar || (b === bar && n < beat) ? 'done' : b === bar && n === beat ? 'now' : '';
    return `<span class="cell ${st}">${n}</span>`;
  }).join('');
  const last = bar === 2;
  const line = last ? `<p class="line last">Come in after 4 <span class="muted">Count-in bar 2 of 2 · ${T(60)}</span></p>` : `<p class="line">Count-in: listen to the beat <span class="muted">Count-in bar 1 of 2 · ${T(60)}</span></p>`;
  return `<div class="ctrack" aria-hidden="true">${line}<div class="cells"><span class="bar listen">${cells(1)}</span><span class="bsep"></span><span class="bar last">${cells(2)}</span><span class="entry ${last && beat === 4 ? 'next' : ''}">Sing</span></div></div>`;
}
function perfTop({ label, beat = 0, last = false, phone = false }) {
  const dots = [0, 1, 2, 3].map((i) => `<i class="${i === 0 ? 'down ' : ''}${i + 1 === beat ? 'on' : i + 1 < beat ? 'done' : ''}"></i>`).join('');
  const meterBars = [5, 9, 13, 16, 12, 7, 4].map((h, i) => `<i class="${i < 2 ? 'on' : ''}" style="height:${h}px"></i>`).join('');
  return `<header class="perfbar">
  <button class="btn btn-secondary btn-compact">${icon('stop', 'sm')}Stop</button>
  <div class="perf-mid">${beat ? `<span class="beats" aria-hidden="true">${dots}</span>` : ''}<span class="t-label">${label}</span><span class="muted t-small only-desktop">${T(60)}</span></div>
  ${last ? `<span class="mic">Mic <span class="bars">${meterBars}</span></span>` : '<span class="mic">Marks start at bar 1</span>'}
</header>`;
}
const takeD = (o) => score1({ width: 1150, sp: 16.5, perSystem: 4, systemGap: 8, ...o });
const takeP = (o) => score1({ width: 350, sp: 11, perSystem: 2, systemGap: 2, topPad: 3.4 * 11, bottomPad: 0.6 * 11, ...o });
function beforeScreen({ cue, marks = {}, highlightKey = false, label, beat = 0, dim = true, micOn = false }) {
  // R16: dimming is for the starting pitch only. From the first count-in click every system is at full ink.
  const op = dim ? [0.55, 0.3] : [1, 1];
  const d = takeD({ marks, highlightKey, systemOpacity: op });
  const p = takeP({ marks, highlightKey, systemOpacity: op });
  return `${perfTop({ label, beat, last: micOn })}
<main class="perf2"><div class="paper"><div class="cue">${cue}</div><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
}
function reference() {
  const body = beforeScreen({ cue: cueRef(1), highlightKey: true, label: 'Starting pitch' });
  return page({ title: 'Before playing: starting pitch', cls: 'viewport-only', body: PERF_CSS + body });
}
function countLast() {
  const marks = { b1n1: { ring: 'brass', label: 'Sing', labelScale: 1.0 } };
  const body = beforeScreen({ cue: cueCount(2, 4), marks, label: 'Count-in', beat: 0, dim: false, micOn: true });
  return page({ title: 'Count-in: the last beat', cls: 'viewport-only', body: PERF_CSS + body });
}
function framesBoard() {
  const sys1 = (o) => score1({ width: 600, sp: 9, perSystem: 4, topPad: 3.6 * 9, bars: D1.slice(0, 4), ...o }).svg;
  const frame = ({ id, t, cue, bar, sound, line, marks = {}, hk = false, dim = true, key = false, mic = 'Marks start at bar 1', beat = 0, body = '', lane = true }) => {
    const dots = [0, 1, 2, 3].map((i) => `<i class="${i === 0 ? 'down ' : ''}${i + 1 === beat ? 'on' : i + 1 < beat ? 'done' : ''}" style="width:8px;height:8px"></i>`).join('');
    return `<article class="frame ${key ? 'key' : ''}">
    <div class="fhead"><span class="fid">${id}</span><span class="t">${t}</span></div>
    <div class="fbar"><span class="stopb">${icon('stop', 'sm')}Stop</span><span class="mid">${beat ? `<span class="beats">${dots}</span>` : ''}${bar}</span><span class="muted">${mic}</span></div>
    <div class="fpaper"><div class="cue">${cue}</div><div style="opacity:${dim ? 0.55 : 1}">${sys1({ marks, highlightKey: hk, showLane: lane, bottomPad: lane ? 0.2 * 9 : 1.2 * 9 })}</div></div>
    <div class="fcap"><span class="snd">${sound}</span> · ${line}${body}</div></article>`;
  };
  const C = (b, n) => cueCount(b, n);
  const tline = (b, n) => {
    return sec(REF_T.countIn + ((b - 1) * 4 + (n - 1)) * REF_T.beat);
  };
  const counts = [];
  for (const b of [1, 2]) for (const n of [1, 2, 3, 4]) {
    const last = b === 2 && n === 4;
    counts.push(frame({
      id: `C${b}.${n} · count-in bar ${b}, beat ${n}`, t: tline(b, n), cue: C(b, n), bar: 'Count-in', beat: 0, dim: false, mic: 'Marks start at bar 1', key: last,
      marks: b === 2 ? { b1n1: { ring: 'brass', label: 'Sing' } } : {},
      sound: n === 1 ? 'Accented click' : 'Click',
      line: b === 1
        ? `Cell ${n} of bar 1 fills grey, number large. Line: <b>Count-in: listen to the beat</b>.${n === 1 ? ' The Sing cell is already in view, so the end is visible from the first click.' : ''}`
        : last
          ? '<b>The last beat.</b> Cell 4 is brass, the word Sing gets a brass underline, the first note keeps its ring and “Sing” label. Nothing else on screen moves. The Sing cell is a word, not a control: no glyph, no border, nothing to press.'
          : `Bar 2 is brass from its first click. Line changes to <b>Come in after 4</b>.${n === 1 ? ' The first note gets its brass ring and “Sing” label now, so eye and ear meet there.' : ''}`,
    }));
  }
  const body = `<main class="fb">
  <h1 class="t-title">Before you sing: frame by frame</h1>
  <p class="lead">Baritone, difficulty 1, ${T(60)}, 4/4, speakers. Times from pressing Start. The cue zone (232 px desktop, 196 px phone) sits above the first system, so the music never moves between frames. Every time on this board is computed by the build from <code>VOICE_REFERENCE</code> (<code>src/session/take-plan.ts</code>: chord tones ${VR.triadToneSec} s, gaps ${VR.gapSec} s, first note ${VR.firstNoteSec} s) and from <code>VOICE_REFERENCE_LEAD_SEC</code> (${VR.leadSec} s) and from the one-beat gap before the first click (<code>firstClickAt = ref.end + 60 / plan.bpm</code>, ${VR.afterSec} s at 60 bpm) in <code>practice-session.ts</code>. The build stops if it cannot read them. Count-in kept at 2 bars for difficulties 1 to 3 (see 04-design.md, disagreement 1). For a 1-bar count-in, drop the dashed group and frames C1.1 to C1.4.</p>
  <div class="fgrid">
    <h2 class="t-h3 fsec">Starting pitch (voice only; instruments skip to C1.1)</h2>
    ${frame({ id: 'R0 · card appears', t: '0 s', cue: cueRef(0), bar: 'Starting pitch', sound: `Silence, ${VR.leadSec * 1000} ms`, line: 'The card appears with the press of Start, so it is on screen before the first tone. Score dimmed to 55%. The microphone is open, but nothing heard before bar 1 is judged or drawn.' })}
    ${frame({ id: 'R1 · key chord', t: sec(REF_T.chord[0]), cue: cueRef(1), hk: true, bar: 'Starting pitch', sound: `F, A, C at ${REF_T.chord.map((x) => x.toFixed(2)).join(', ')} s, ${VR.triadToneSec} s each`, line: 'Brass band on the key signature. Live caption <b>Key chord: F major</b>. No other mark.' })}
    ${frame({ id: 'R2 · first note', t: sec(REF_T.first), cue: cueRef(2), marks: { b1n1: { ring: 'brass', label: 'F3' } }, bar: 'Starting pitch', sound: `F3, ${VR.firstNoteSec} s`, line: 'Key band goes; brass ring and name on the first note. Caption <b>First note: F3</b>.' })}
    ${frame({ id: 'R3 · short silence', t: sec(REF_T.end), cue: cueRef(3), marks: { b1n1: { ring: 'brass' } }, bar: 'Starting pitch', sound: `Silence, ${VR.afterSec * 1000} ms; the room tail of the tone is ignored`, line: 'Both steps ticked. <b>Count-in next</b>. The ring stays so the note is easy to find again.' })}
    <h2 class="t-h3 fsec">Count-in: two bars, the second one says “come in”</h2>
    ${counts.join('')}
    <h2 class="t-h3 fsec">The music starts</h2>
    ${frame({ id: 'M1 · bar 1, beat 1', t: sec(REF_T.countIn + 8 * REF_T.beat), cue: '', lane: true, bar: 'Bar 1 of 8', beat: 1, dim: false, mic: 'Mic', marks: { b1n1: { ring: 'brass', pulse: true } }, sound: 'Click (if “Click during the try” is on)', line: 'Track gone; the cue zone stays empty, so the score has not moved. The first note’s ring pulses once (300 ms) and fades. Status strip: <b>Bar 1 of 8</b>. From here, marks follow the live rules.' })}
    ${frame({ id: 'M2 · first note sung', t: sec(REF_T.countIn + 8 * REF_T.beat + 0.3), cue: '', lane: true, bar: 'Bar 1 of 8', beat: 1, dim: false, mic: 'Mic', marks: { b1n1: { lane: 'dot' } }, sound: 'Click', line: 'Green dot under the note once the app is sure of it. At difficulties 1 to 3 nothing violet and nothing grey is drawn during the try. Before this point no mark of any kind is drawn.' })}
  </div>
</main>`;
  return page({ title: 'Before you sing: frames', body: sizes('desktop') + body });
}

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
function scan2({ menu = false } = {}) {
  const s = score1({ width: 872, sp: 15, perSystem: 4, systemGap: 10, showLane: false, bottomPad: 2.4 * 15 });
  const ps = score1({ width: 342, sp: 9.5, perSystem: 2, systemGap: 0, showLane: false, topPad: 3.8 * 9.5, bottomPad: 1.4 * 9.5 });
  const desktop = `<div class="only-desktop">
${loopbar({ right: `${modeChip('', 0, true)}<button class="icon-btn" aria-label="More">${icon('more')}</button>` })}
<main class="scan-grid">
  <section>
    <div class="paper" style="padding:40px 48px 32px">${s.svg}</div>
    <p class="t-small muted" style="margin:12px 4px 14px">Read it through. Start when you are ready.</p>
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
${loopbar({ right: `${modeChip('', 0, true)}<button class="icon-btn ${menu ? 'is-open' : ''}" aria-label="More" style="${menu ? 'background:var(--surface-2)' : ''}">${icon('more')}</button>` })}
<main style="padding:10px 10px 300px">
  <p class="t-caption muted" style="margin:0 4px 2px;text-align:center">${SUM1}</p>
  <p class="cal-line ph">${icon('speaker', 'sm')}<span>Not calibrated ·</span><button class="qlink">Calibrate</button></p>
  <div class="paper" style="padding:12px 12px 8px;border-radius:16px">${ps.svg}</div>
  <p class="t-caption muted" style="margin:10px 6px 0">Read it through. Start when you are ready.</p>
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
${menu ? `<div class="menu" role="menu"><div class="mi">${icon('speaker')}<span>Not calibrated<small>Calibrate before this try. We'll bring you back here.</small></span></div><hr><div class="mi">${icon('skip')}<span>Skip this piece</span></div><div class="mi">${icon('settings')}<span>Settings</span></div></div>` : ''}
</div>`;
  return page({ title: 'Read-through, round 2', body: SCAN_CSS + desktop + phone });
}
const scan = () => scan2();
const scanMenu = () => page({ title: 'Read-through: phone menu', cls: 'viewport-only', body: sizes('phone') + SCAN_CSS + scan2({ menu: true }).split('<body class="">')[1].split('</body>')[0] });

// ---------------------------------------------------------------- Performance: calmer live marks
function liveMarks1() {
  const m = {};
  const played = ['b1n1', 'b1n2', 'b1n3', 'b1n4', 'b2n1', 'b2n2', 'b2n3', 'b3n1', 'b3n2', 'b3n3', 'b3n4', 'b4n1', 'b5n1', 'b5n2', 'b5n3', 'b5n4', 'b6n1'];
  for (const id of played) m[id] = { lane: 'dot', past: +id[1] <= 4 ? 0.7 : undefined };
  m.b2n2 = { state: 'error', lane: 'flat', past: 0.7 };
  // R23: a note the app is not sure of shows nothing live (b3n3, b5n3). It resolves on the results.
  delete m.b3n3;
  delete m.b5n3;
  return m;
}
function liveCalm() {
  const marks = liveMarks1();
  const d = takeD({ marks, playheadBar: 6 });
  const p = takeP({ marks, playheadBar: 6 });
  const meterBars = [5, 9, 13, 16, 12, 7, 4].map((h, i) => `<i class="${i < 5 ? 'on' : ''}" style="height:${h}px"></i>`).join('');
  const body = `<header class="perfbar"><button class="btn btn-secondary btn-compact">${icon('stop', 'sm')}Stop</button><div class="perf-mid"><span class="beats"><i class="down done"></i><i class="on"></i><i></i><i></i></span><span class="t-label">Bar 6 of 8</span><span class="muted t-small only-desktop">${T(60)}</span></div><span class="mic">Mic <span class="bars">${meterBars}</span></span></header>
<main class="perf-wrap"><div class="paper perf-paper"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
  return page({ title: 'Live marks at difficulty 1', body: PERF_CSS + body });
}
function marksBoard() {
  const one = (marks, o = {}) => P.engrave({ clef: 'bass', key: FKEY, time: null, bars: [D1[3], D1[4]], perSystem: 2, width: 420, sp: 12, marks, topPad: 3.2 * 12, bottomPad: 0.6 * 12, ...o }).svg;
  const bar = (label, svg, text) => `<div class="card" style="padding:16px 18px"><p class="state-label">${label}</p><div class="paper" style="padding:6px 14px;box-shadow:none;border:1px solid var(--border)">${svg}</div><p class="t-small" style="margin:10px 0 0">${text}</p></div>`;
  const before = one({ b1n1: { lane: 'dot' }, b1n2: { extra: { p: 'Eb3', acc: 'b', dx: 2.6 } }, b2n1: { state: 'error', lane: 'wrong', ghost: { p: 'A3', dx: 1.2 } }, b2n2: { lane: 'dot' } });
  const now = one({ b1n1: { lane: 'dot' }, b2n1: { lane: 'dot' } });
  const res = one({ b1n1: { lane: 'dot' }, b1n2: { extra: { p: 'F3', dx: 2.6, opacity: 0.5 } }, b2n1: { lane: 'dot' }, b2n2: { lane: 'dot' } });
  const leg = (svgInner, t, d) => `<div class="lg"><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">${svgInner}</svg><div><b>${t}</b><span>${d}</span></div></div>`;
  const body = `<main class="fb"><h1 class="t-title">Live marks when the app is unsure</h1>
  <p class="lead">Bars 4 and 5, the owner's trailing voice: the half note G3 falls away into the rest, and the next note is scooped from below.</p>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px">
    ${bar('Before (round 1, live)', before, 'The tail became a violet B♭ ghost with a “+” in the rest; the scoop flashed a red wrong note. The eye goes to the violet.')}
    ${bar('Now, difficulties 1 to 3 (live)', now, 'The tail is part of G3. No violet during the try. The scooped B♭3 is not sure yet, so it shows nothing; the mic meter already shows you are heard. Red only when sure.')}
    ${bar('Results of an Unsure try', res, 'Extras appear only after the try, and at 50% when the try is marked “We weren’t sure about many notes”, so the reliable marks lead.')}
  </div>
  <h2 class="t-h3" style="margin:28px 0 12px">Live vocabulary at difficulties 1 to 3</h2>
  <div class="lgrid">
    ${leg('<circle cx="14" cy="14" r="4.5" fill="var(--correct)"/>', 'Right', 'Green dot, as now.')}
    ${leg('', 'Not sure yet', 'Nothing. No grey or other unsure mark. It resolves on the results.')}
    ${leg('<path d="M5 8 L14 21 L23 8 Z" fill="var(--error)"/>', 'Wrong, early, late, out of tune, missed', 'Red, only when the follower is sure (frames agree, steady part reached).')}
    ${leg('<path d="M8 14H20M14 8V20" stroke="var(--ghost)" stroke-width="2.4" stroke-linecap="round" opacity="0.5"/>', 'Not live: played notes and extras', 'Violet waits for the results (“Show played notes live: from difficulty 4”).')}
  </div></main>
<style>.lgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.lg{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:14px;background:var(--surface);border:1px solid var(--border)}.lg div{display:grid;gap:2px;font-size:13.5px}.lg span{color:var(--text-muted)}</style>`;
  return page({ title: 'Live marks when unsure', body: sizes('desktop') + body });
}

// ---------------------------------------------------------------- Results
function reviewMarks1() {
  const m = {};
  m.b2n2 = { state: 'error', lane: 'flat', ghost: { p: 'Ab3', dx: 1.0, arrow: 'down' } };
  m.b5n2 = { state: 'error', lane: 'late', ghost: { p: 'Bb3', dx: 1.6 } };
  m.b7n4 = { state: 'missed', lane: 'missed' };
  return m;
}
const ACTIONS2 = `<button class="btn btn-primary btn-hero">Next piece${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero">Try again (practice)</button><button class="btn btn-quiet btn-hero">Change setup</button>`;
function gradeHead2() {
  return `<section class="grade-head">
  <div class="g-left"><span class="grade">B</span><div><div style="display:flex;align-items:baseline;gap:8px"><span class="t-display num">84</span><span class="muted t-small">of 100</span></div><div class="stars">${P.star(1)}${P.star(1)}${P.star(0)}</div><p style="margin:6px 0 0;font-weight:500">Solid. A few mistakes.</p></div></div>
  <div class="g-right">
    <div class="xp-line"><span class="badge">Practice</span><span class="t-h3 num">+4 XP</span><span class="t-small muted nb">Novice · 14% to Apprentice</span><span class="xpbar" style="width:120px"><i style="width:14%"></i></span></div>
    <p class="t-small reason muted">Not calibrated: timing marks may be a little off.</p>
    <div class="res-actions only-desktop">${ACTIONS2}</div>
    <p class="tries-line">${icon('history')}<button class="qlink">2 tries at this piece</button> · <button class="qlink">See all tries</button></p>
  </div>
</section>`;
}
// R25: "Show what we heard" sits in the toolbar. R26: Hear what we heard uses the playback glyph; its caption has its
// own reserved line under the toolbar, so no button moves when it starts.
const toolbar2 = ({ heard = false, playing = false, trace = false } = {}) => `<div class="score-tools">
  <div class="seg" role="radiogroup" aria-label="Show"><button class="seg-btn is-on" style="min-height:36px">My marks</button><button class="seg-btn" style="min-height:36px">Clean score</button></div>
  <span class="nav-slips mstep"><button class="btn btn-secondary btn-compact" aria-label="Previous mistake">${icon('chevL', 'sm')}</button><span class="t-small">Mistake 1 of 3</span><button class="btn btn-secondary btn-compact" aria-label="Next mistake">${icon('chevR', 'sm')}</button></span>
  <span style="flex:1"></span>
  <span class="switch ${trace ? 'is-on' : ''}"><span class="switch-track"></span>Show what we heard</span>
  <span class="switch only-desktop"><span class="switch-track"></span>Slower</span>
  <button class="btn btn-secondary btn-compact">${icon('listen', 'sm')}Listen</button>
  ${heard ? `<button class="btn btn-compact ${playing ? 'btn-secondary is-playing-btn' : 'btn-primary'}">${icon(playing ? 'stop' : 'play', 'sm')}${playing ? 'Stop' : 'Hear what we heard'}</button>` : ''}
</div>
${heard ? `<div class="heard-cap" aria-live="polite">${playing ? `${liveCap('What we heard, bar 3 of 8')}<span class="t-caption muted">The notes we detected, in your instrument's sound. Not a recording.</span>` : ''}</div>` : ''}
${trace ? `<p class="trace-key"><svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><polyline points="1,9 6,6 12,6 18,5 24,6 28,8 33,11" fill="none" stroke="var(--text-muted)" stroke-width="1.6" stroke-linecap="round"/></svg>The pitch we heard. A line that falls after a note is your voice trailing off: it is part of that note, not a new one.</p>` : ''}`;
const sureLine = (lv = 3, text = '<b>We heard you clearly.</b> 27 of 28 notes were steady and clear.') => `<p class="sure"><span class="lv" aria-hidden="true"><i style="height:6px"></i><i class="${lv < 2 ? 'off' : ''}" style="height:11px"></i><i class="${lv < 3 ? 'off' : ''}" style="height:16px"></i></span><span>${text}</span></p>`;
// 05 D3: no support address is configured yet, so the button reads "Save diagnostics" and no send line shows.
const diagRow = () => `<div class="diag-row"><span class="t-caption muted">Marks look wrong? Save what the app heard for the team.</span><button class="btn btn-quiet btn-compact" style="padding:0 6px">${icon('arrowR', 'sm')}Save diagnostics</button></div>`;
function comps2() {
  const c = (l, v, weak) => `<div class="comp"><span class="t-small" style="font-weight:600">${l}</span><span class="bar"><i class="${weak ? 'weak' : ''}" style="width:${v}%"></i></span><span class="v num">${v}</span></div>`;
  return `<section class="card card-pad"><h2 class="t-h3" style="margin-bottom:8px">How it went</h2>
  ${c('Notes', 93)}${c('In tune', 74, true)}${c('Rhythm', 86)}
  <p class="t-small muted counts" style="margin:12px 0 0">28 notes · 25 right · 1 late · 1 out of tune · 1 missed</p>
  ${sureLine()}
  ${diagRow()}
</section>`;
}
function tip2() {
  return `<section class="card card-pad tip-card"><div class="tip-head"><span class="tip-ic">${icon('lightbulb')}</span><h2 class="t-h2">One thing to try</h2></div>
  <p class="tip-text">The A in bar 2 sat low. Before you sing, hear the starting pitch and think the first three notes: F, G, A.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="btn btn-tonal btn-compact">${icon('listen', 'sm')}Hear bar 2</button></div></section>`;
}
function results() {
  const d = score1({ width: 1100, sp: 12.5, perSystem: 4, ghostStyle: 'review', systemGap: 12, marks: reviewMarks1() });
  const p = score1({ width: 314, sp: 9, perSystem: 2, ghostStyle: 'review', systemGap: 2, topPad: 3.4 * 9, bottomPad: 0.5 * 9, marks: reviewMarks1() });
  const body = `${loopbar({ text: SUM1 })}
<main class="res">
  ${gradeHead2()}
  <section class="card score-card">${toolbar2()}
    <div class="paper" style="padding:24px 28px 14px;box-shadow:none;border:1px solid var(--border)"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></section>
  <div class="res-cols">${tip2()}${comps2()}</div>
  <div class="res-actions res-end only-phone" style="margin-top:20px"><button class="btn btn-secondary btn-hero">Try again (practice)</button><button class="btn btn-quiet btn-hero">Change setup</button></div>
</main>
<div class="res-sticky"><button class="btn btn-primary btn-hero">Next piece${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero" aria-label="Try again (practice)">${icon('retry', 'sm')}Try again</button></div>`;
  return page({ title: 'Results, round 2', body: '<meta name="scroll-shot" content="phone:640">' + RES_CSS + body });
}
function sendDiag() {
  const d = score1({ width: 1100, sp: 12.5, perSystem: 4, ghostStyle: 'review', systemGap: 12, marks: reviewMarks1() });
  const dlg = `<div class="scrim"></div><div class="dlg2" role="dialog" aria-labelledby="sd-t">
  <h2 class="t-h2" id="sd-t">Save diagnostics</h2>
  <p style="margin:10px 0 0">A file of what the app heard in this try, for the Sightread team to look at. No recording of your voice.</p>
  <ul><li>Every note we heard: when, how long, what pitch, how sure</li><li>Every mark, and the ones that changed after the try</li><li>Your settings, calibration and device, no names</li></ul>
  <div class="optrow"><span class="switch"><span class="switch-track"></span></span><div><p class="t-label" style="margin:0">Keep the sound of my next tries for diagnostics</p><p class="t-small muted" style="margin:2px 0 0">Off. It stays on this device and is only in a file you send. This try has no sound.</p></div></div>
  <p class="t-caption muted" style="margin:16px 0 0">sightread-try-2026-11-19-1432.json · 64 KB</p>
  <p class="t-caption muted" style="margin:6px 0 0">Recent tries, all in one file: Settings › Data.</p>
  <div class="acts"><button class="btn btn-quiet">Cancel</button><button class="btn btn-secondary">Share…</button><button class="btn btn-primary">Save file</button></div>
</div>`;
  const body = `${loopbar({ text: SUM1 })}<main class="res">${gradeHead2()}<section class="card score-card">${toolbar2()}<div class="paper" style="padding:24px 28px 14px;box-shadow:none;border:1px solid var(--border)">${d.svg}</div></section></main>${dlg}`;
  return page({ title: 'Send diagnostics', cls: 'viewport-only', body: RES_CSS + body });
}

// ---------------------------------------------------------------- History and a previous try
const HROWS = [
  ['Today', [['B', 84, TITLE, 'Difficulty 1 · F major · 4/4 · ♩ = 60', '14:32 · Practice', true], ['C', 71, TITLE, 'Difficulty 1 · F major · 4/4 · ♩ = 60', '14:26 · Practice'], [null, null, 'Melody in C major', 'Difficulty 1 · C major · 3/4 · ♩ = 66', '14:20 · Practice']]],
  ['Yesterday', [['B', 80, 'Song in G major', 'Difficulty 1 · G major · 4/4 · ♩ = 72', '19:05 · Practice']]],
];
const hrow = ([g, s, t, sum, when, sel]) => `<div class="hrow ${sel ? 'is-sel' : ''}">${g ? `<span class="gr"><span class="g">${g}</span><span class="s num">${s}</span></span>` : '<span class="gr ng">Not graded</span>'}<div><div class="tt">${t}</div><div class="sm">${sum.replace(/♩ = (\d+)/, (m0, b) => T(b))}${g ? '' : ' · we couldn’t hear you'}</div><div class="sm only-phone">${when}</div></div><span class="when">${when}</span>${icon('chevR', 'sm')}</div>`;
function history() {
  const body = `${P.appbar('history')}
<main class="page" style="max-width:920px;padding-top:28px">
  <div class="page-head" style="margin-bottom:14px;align-items:center"><h1 class="t-title">History</h1><span class="t-small muted">4 tries on this device</span></div>
  <div class="fchips"><button class="fchip">Baritone voice${icon('chevD')}</button><button class="fchip">Ranked and practice${icon('chevD')}</button><button class="fchip is-on">This piece${icon('x')}</button></div>
  <p class="t-small muted" style="margin:10px 2px 0">Showing 2 of 4 tries: the ones at ${TITLE}. <button class="qlink">Show all tries</button></p>
  <p class="hgroup">Today · 3 tries, 2 at this piece</p><section class="card hl-list">${HROWS[0][1].slice(0, 2).map(hrow).join('')}</section>
</main>
${P.tabbar('history')}`;
  return page({ title: 'History filtered to this piece', body });
}
function historyAll() {
  const list = HROWS.map(([h, rows]) => `<p class="hgroup">${h} · ${rows.length} ${rows.length === 1 ? 'try' : 'tries'}</p><section class="card hl-list">${rows.map((r) => hrow([...r.slice(0, 5), false])).join('')}</section>`).join('');
  const body = `${P.appbar('history')}
<main class="page" style="max-width:920px;padding-top:28px">
  <div class="page-head" style="margin-bottom:14px;align-items:center"><h1 class="t-title">History</h1><span class="t-small muted">4 tries on this device</span></div>
  <div class="fchips"><button class="fchip">Baritone voice${icon('chevD')}</button><button class="fchip">Ranked and practice${icon('chevD')}</button></div>
  ${list}
</main>
${P.tabbar('history')}`;
  return page({ title: 'History', body });
}
// The owner's trailing voice as a pitch track: a fall after each half note, the flat A3 in bar 2, the late B♭3 in
// bar 5, nothing for the missed note in bar 7.
const TRACE1 = { b2n2: { dev: -0.9 }, b2n3: { tail: -1.6 }, b4n1: { tail: -1.6, tailLen: 3.2 }, b5n2: { delay: 0.35 }, b6n3: { tail: -1.2 }, b7n4: { skip: true }, b8n1: { tail: -1.8, tailLen: 1.2 } };
function tryDetail({ playing = false, trace = false } = {}) {
  const d = score1({ width: 1100, sp: 12.5, perSystem: 4, ghostStyle: 'review', systemGap: 12, marks: reviewMarks1(), playheadBar: playing ? 3 : undefined, trace: trace ? TRACE1 : undefined });
  const p = score1({ width: 314, sp: 9, perSystem: 2, ghostStyle: 'review', systemGap: 2, topPad: 3.4 * 9, bottomPad: 0.5 * 9, marks: reviewMarks1(), playheadBar: playing ? 3 : undefined, trace: trace ? TRACE1 : undefined });
  const body = `${loopbar({ home: 'History', text: '' })}
<main class="res">
  <div class="td-head">
    <div><h1 class="t-title">${TITLE}</h1><p class="t-small muted" style="margin:4px 0 0">${SUM1} · Today 14:32</p></div>
    <div class="trynav"><button class="btn btn-secondary btn-compact" aria-label="Previous try">${icon('chevL', 'sm')}</button><span class="t-small">Try 2 of 2 at this piece</span><button class="btn btn-secondary btn-compact" aria-label="Next try" disabled style="opacity:0.4">${icon('chevR', 'sm')}</button></div>
  </div>
  <div class="td-grade"><span class="grade" style="font-size:64px">B</span><span class="t-h2 num">84</span><span class="badge">Practice</span><span class="t-small muted">Not calibrated: timing marks may be a little off.</span></div>
  <section class="card score-card">${toolbar2({ heard: true, playing, trace })}
    <div class="paper" style="padding:24px 28px 14px;box-shadow:none;border:1px solid var(--border)"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div>
  </section>
  <div class="res-cols" style="grid-template-columns:1fr">${comps2()}</div>
</main>
<style>.td-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:14px}.td-grade{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:0 0 16px}.td-grade .grade{line-height:1}
@media (max-width:700px){.td-head{flex-direction:column;align-items:flex-start}.td-head .t-title{font-size:26px}.td-grade{gap:8px 12px}.score-tools .btn-primary,.score-tools .is-playing-btn{flex:1}}</style>`;
  return page({ title: playing ? 'Previous try: hearing what we heard' : 'Previous try', body: RES_CSS + body });
}

// ---------------------------------------------------------------- Error screens (R27, 01-ux §9)
// Only sound that did not start or a microphone that did not open stop a try. A clock-rate result never does.
function errorPage({ title, ic, heading, text }) {
  const body = `${P.appbar('practice')}
<main class="err2"><span class="err-ic">${icon(ic, 'lg')}</span><h1 class="t-title">${heading}</h1><p class="err-b">${text}</p>
<p class="err-k">${icon('info', 'sm')}<span>Your piece is kept. Try again starts it from the beginning.</span></p>
<div class="err-a"><button class="btn btn-primary btn-hero">${icon('retry', 'sm')}Try again</button><button class="btn btn-secondary btn-hero">Back to Practice</button></div>
<div class="diag-row" style="margin-top:22px"><span class="t-caption muted">Keeps happening? Save what the app saw for the team.</span><button class="btn btn-quiet btn-compact" style="padding:0 6px">${icon('arrowR', 'sm')}Save diagnostics</button></div>
</main>
<style>
.err2 { max-width: 560px; margin: 0 auto; padding: 96px 24px; }
.err-ic { width: 56px; height: 56px; border-radius: 16px; background: var(--surface-2); display: grid; place-items: center; margin-bottom: 22px; }
.err-b { font-size: 17px; line-height: 1.55; color: var(--text-muted); margin: 12px 0 14px; }
.err-k { display: flex; gap: 8px; align-items: center; font-size: 14px; color: var(--text-muted); margin: 0 0 26px; }
.err-k .icon { width: 16px; height: 16px; }
.err-a { display: flex; gap: 10px; flex-wrap: wrap; }
@media (max-width: 700px) { .err2 { padding: 40px 16px 120px; } .err-a .btn { width: 100%; } .err2 .diag-row { flex-direction: column; align-items: flex-start; gap: 4px; } }
</style>`;
  return page({ title, cls: 'viewport-only', body });
}
const errorSound = () => errorPage({ title: 'Error: the sound did not start', ic: 'speaker', heading: "The sound didn't start", text: "Your browser didn't let the sound start. Press Try again. If it happens again, reload the page." });
const errorMic = () => errorPage({ title: 'Error: the microphone did not open', ic: 'mic', heading: "The microphone didn't open", text: 'Another app may be using it. Close that app, then press Try again.' });

// ---------------------------------------------------------------- Settings > Data (R29, D4)
function settingsData() {
  const nav = ['Profile', 'Sound', 'Display', 'Practice', 'Accessibility', 'Data', 'About'].map((n) => `<a class="snav ${n === 'Data' ? 'is-on' : ''}">${n}</a>`).join('');
  const body = `${P.appbar('')}
<main class="page set-grid">
  <nav class="only-desktop set-nav"><h1 class="t-title" style="font-size:30px;margin:0 0 18px">Settings</h1>${nav}</nav>
  <div>
    <div class="only-phone" style="margin-bottom:6px"><button class="btn btn-quiet btn-compact" style="padding:0">${icon('chevL', 'sm')}Settings</button></div>
    <h2 class="t-h2" style="font-size:28px;margin:0 0 18px">Data</h2>
    <section class="card card-pad">
      <h3 class="t-h3" style="margin:0 0 4px">Diagnostics</h3>
      <p class="t-small muted" style="margin:0 0 4px">What the app heard in each try, so the team can see why a mark appeared. Kept on this device for your last 20 tries.</p>
      <div class="srow"><div><p class="t-label">Export diagnostics for recent tries</p><p class="t-small muted">One file with all 20 tries: notes, timings, marks and settings. No recording of your voice.</p><p class="t-caption muted" style="margin-top:6px">sightread-tries-2026-11-19-1440.json · about 1.2 MB</p></div><button class="btn btn-secondary btn-compact">${icon('arrowR', 'sm')}Export</button></div>
      <div class="srow"><div><p class="t-label">Keep the sound of my next tries for diagnostics</p><p class="t-small muted">Off. From the next try. The sound stays on this device and is only in a file you save.</p></div><span class="switch"><span class="switch-track"></span></span></div>
      <p class="note-line">${icon('info')}<span>“Show what the app hears” is in Display. It draws the pitch we heard on the results.</span></p>
    </section>
  </div>
</main>
<style>
.set-grid { display: grid; grid-template-columns: 220px minmax(0, 720px); gap: 48px; }
.snav { display: block; padding: 9px 14px; border-radius: 10px; color: var(--text-muted); font-weight: 500; }
.snav.is-on { background: var(--surface-2); color: var(--text); font-weight: 600; }
.srow { display: flex; align-items: center; gap: 20px; justify-content: space-between; padding: 16px 0; border-top: 1px solid var(--border); }
.srow p { margin: 0; } .srow .t-small { margin-top: 2px; }
.srow .btn, .srow .switch { flex: none; }
.note-line { display: flex; gap: 8px; align-items: center; margin: 4px 0 0; font-size: 13.5px; color: var(--text-muted); }
.note-line .icon { width: 16px; height: 16px; }
@media (max-width: 700px) { .set-grid { display: block; } .srow { align-items: flex-start; } }
</style>`;
  return page({ title: 'Settings: data', body });
}

// ---------------------------------------------------------------- Write
const files = {
  'practice.html': practice(),
  'practice-d5.html': practiceHigh(5, false),
  'practice-d10.html': practiceHigh(10, false),
  'practice-d10-keys.html': practiceHigh(10, true),
  'cal-status.html': calStatus(),
  'picker-sound.html': pickerSound(),
  'picker-states.html': pickerIdle(),
  'match.html': match(),
  'match-hit.html': matchHit(),
  'match-states.html': matchStates(),
  'match-onboarding.html': matchOnboarding(),
  'before-reference.html': reference(),
  'before-countin-last.html': countLast(),
  'before-frames.html': framesBoard(),
  'scan.html': scan(),
  'scan-menu.html': scanMenu(),
  'live-calm.html': liveCalm(),
  'live-marks.html': marksBoard(),
  'results.html': results(),
  'send-diagnostics.html': sendDiag(),
  'history.html': history(),
  'history-all.html': historyAll(),
  'try.html': tryDetail({ trace: true }),
  'try-heard.html': tryDetail({ playing: true }),
  'error-sound.html': errorSound(),
  'error-mic.html': errorMic(),
  'settings-data.html': settingsData(),
};
for (const [name, html] of Object.entries(files)) writeFileSync(join(OUT, name), html);
console.log('wrote', Object.keys(files).length, 'files to', OUT);
