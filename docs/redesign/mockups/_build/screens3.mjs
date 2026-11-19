// States and screens added after the UX critique (07-ux-critique.md). Change numbers in comments.
import * as P from './parts.mjs';
import {
  SUMMARY, sizes, loopbar, SCAN_CSS, scanDesktop, scanPhone, PERF_CSS, perfBar, takeDesktop, takePhone,
  RES_CSS, gradeHeader, scoreToolbar, resultsDesktop, resultsPhone, tipCard, components, ACTIONS, liveCap,
  SHEET_CSS, tempoRow, PICKER_CSS, INSTR, pcard, soundsGroup,
} from './screens2.mjs';
const { icon, T } = P;

// ---------------------------------------------------------------- Setup states (C6, C58, C57 in part)
const KEYS_D5_CLAR = {
  major: [['C major', { count: 0 }, 'B♭ major'], ['G major', { type: '#', count: 1 }, 'F major'], ['D major', { type: '#', count: 2 }, 'C major'], ['A major', { type: '#', count: 3 }, 'G major'], ['F major', { type: 'b', count: 1 }, 'E♭ major'], ['B♭ major', { type: 'b', count: 2 }, 'A♭ major'], ['E♭ major', { type: 'b', count: 3 }, 'D♭ major']],
  minor: [['A minor', { count: 0 }, 'G minor'], ['E minor', { type: '#', count: 1 }, 'D minor'], ['B minor', { type: '#', count: 2 }, 'A minor'], ['F♯ minor', { type: '#', count: 3 }, 'E minor'], ['D minor', { type: 'b', count: 1 }, 'C minor'], ['G minor', { type: 'b', count: 2 }, 'F minor'], ['C minor', { type: 'b', count: 3 }, 'B♭ minor']],
  anyHint: 'Up to 3 sharps or flats', foot: 'More keys from difficulty 6.',
};
function setupStates() {
  const fallbackKeys = { ...P.KEYS_D2 };
  const panel = (label, inner) => `<div><p class="state-label">${label}</p><section class="card card-pad">${inner}</section></div>`;
  const timeFew = panel('Time: 3/4 chosen, few pieces', `<div class="row-head"><p class="t-label">Time</p></div>${P.timeSeg('3/4')}`);
  const fallback = panel('Key: fallback after a difficulty change', `<div class="fallback" role="status">${icon('info', 'sm')}<span>Key set to Any: D major isn't used at difficulty 2.</span></div><div class="row-head"><p class="t-label">Key</p></div>${P.keyChips({ selected: 'Any key', keys: fallbackKeys })}`);
  const ranked = panel('Mode: Ranked unavailable', `<div class="row-head"><p class="t-label">Mode</p></div>
    <div class="seg full" role="radiogroup" aria-label="Mode"><button class="seg-btn is-unavail" aria-disabled="true" aria-describedby="rk-why"><span style="display:inline-flex;gap:6px;align-items:center">${icon('caution', 'sm')}Ranked</span></button><button class="seg-btn is-on">Practice</button></div>
    <p class="hint" id="rk-why" style="color:var(--text)">Ranked needs a calibrated setup on this device.</p>
    <button class="btn btn-secondary btn-compact" style="margin-top:12px">Calibrate now</button>
    <p class="hint">Less XP. No time limit. Listen first if you like.</p>`);
  const empty = panel('No excerpt fits', `<div class="empty-card"><span class="tip-ic" style="background:var(--surface-2);color:var(--text)">${icon('practice')}</span><div>
    <h3 class="t-h3">No excerpt fits these settings</h3>
    <p class="t-small muted" style="margin:4px 0 14px">Difficulty 2 has no unseen music in 3/4 for Baritone voice yet.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary btn-compact">Set time to Any</button><button class="btn btn-secondary btn-compact">Go to difficulty 3</button><button class="btn btn-quiet btn-compact">Practise a seen excerpt</button></div></div></div>`);
  const d5 = (cols) => panel('Key grid at difficulty 5, Clarinet in B♭ (transposing)', `<div class="row-head"><p class="t-label">Key</p><span class="t-caption muted">Written keys. Concert pitch under each.</span></div>${P.keyChips({ clef: 'treble', selected: 'A major', keys: KEYS_D5_CLAR, cols })}`);
  const css = `<style>
.st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: start; }
.st-grid > .wide { grid-column: 1 / -1; }
.fallback { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--brass-wash); font-size: 14px; margin-bottom: 14px; }
.fallback .icon { color: var(--brass-ink); margin-top: 2px; }
.empty-card { display: flex; gap: 14px; align-items: flex-start; }
.tip-ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; }
.seg-btn.is-unavail { opacity: 0.55; }
@media (max-width: 700px) { .st-grid { grid-template-columns: 1fr; gap: 20px; } .st-page { padding: 16px 8px 40px !important; } .st-page .card-pad { padding: 16px 8px; } }
</style>`;
  const body = `${P.appbar('practice')}
<main class="page st-page"><h1 class="t-title" style="margin-bottom:6px">Setup states</h1><p class="t-small muted" style="margin:0 0 24px">Practice screen, one row or card per state.</p>
<div class="st-grid">${timeFew}${ranked}<div class="wide">${fallback}</div>${empty}<div></div><div class="wide only-desktop">${d5(4)}</div><div class="wide only-phone">${d5(3)}</div></div></main>`;
  return P.page({ title: 'Setup states', body: css + body });
}

// ---------------------------------------------------------------- Setup sheet opened from the Key chip (C8)
function setupSheetKey() {
  const body = `<div class="scrim" style="background:transparent"></div><div class="sheet" style="margin-top:44px;min-height:calc(100vh - 44px)">
  <div class="grabber"></div>
  <div class="sheet-head"><h2 class="t-h2">Setup</h2><button class="btn btn-primary btn-compact">Done</button></div>
  <p class="t-caption muted" style="margin:0 16px 0">Scrolled to Key. Focus is on the chosen key.</p>
  <div style="padding:0 16px 40px">
    <div class="row" style="padding-top:14px"><div class="row-head"><p class="t-label">Key</p></div>${P.keyChips({ selected: 'G major', cols: 3, focus: 'G major' })}</div>
    <div class="row"><div class="row-head"><p class="t-label">Time</p></div>${P.timeSeg('4/4')}</div>
    ${tempoRow()}
  </div>
</div>`;
  return P.page({ title: 'Setup sheet, opened from the Key chip', cls: 'viewport-only', body: sizes('phone') + SHEET_CSS + body });
}

// ---------------------------------------------------------------- Read-through variants
function scanListen() {
  return P.page({ title: 'Read-through, practice: Listen first playing', body: SCAN_CSS + scanDesktop({ practice: true, playing: 'listen', popover: false }) + scanPhone({ practice: true, playing: 'listen' }) });
}
function scanInstrument() {
  return P.page({ title: 'Read-through, Clarinet in B♭: Hear the key', body: SCAN_CSS + scanDesktop({ inst: true, playing: 'key' }) + scanPhone({ inst: true, playing: 'key' }) });
}
function scanCoach() {
  return P.page({ title: 'Read-through: first-time coach mark', body: SCAN_CSS + scanDesktop({ playing: '', popover: false, coach: true }) + scanPhone({ playing: '', coach: true }) });
}

// ---------------------------------------------------------------- Voice: starting pitch before the count-in (C34)
function countInVoice() {
  const marks = { b1n1: { state: 'hl', label: 'G3' } };
  const d = takeDesktop({ marks, systemOpacity: [1, 0.5] });
  const p = takePhone({ marks, systemOpacity: [1, 0.5] });
  const band = `<div class="count-band ref-band"><div><p class="ref-title">Your starting pitch</p><div class="ref-steps"><span class="done">${icon('check', 'sm')}Key chord: G major</span>${liveCap('First note: G3')}</div></div></div>`;
  const css = `<style>
.ref-band { justify-content: flex-start; height: 140px; }
.ref-title { font-family: var(--font-display); font-weight: 600; font-size: 44px; line-height: 1.1; margin: 0 0 10px; }
.ref-steps { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; }
.ref-steps .done { display: inline-flex; gap: 6px; align-items: center; color: var(--text-muted); font-weight: 600; font-size: 14px; }
.ref-steps .live-cap { margin: 0; font-size: 16px; }
@media (max-width: 700px) { .ref-band { height: 110px; padding-top: 4px; } .ref-title { font-size: 28px; margin-bottom: 6px; } .ref-steps { gap: 4px 14px; } .ref-steps .live-cap { font-size: 14px; } }
</style>`;
  const body = `${perfBar({ beat: 0, label: 'Starting pitch' })}
<main class="perf-wrap"><div class="paper perf-paper">${band}<div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
  return P.page({ title: 'Voice: starting pitch before the count-in', body: PERF_CSS + css + body });
}

// ---------------------------------------------------------------- Results states (C42, C43, C48)
function resultsStates() {
  const marks = P.reviewMarks();
  const section = (label, inner) => `<p class="state-label" style="margin-top:36px">${label}</p>${inner}`;
  const scoreCard = (tb, d, p) => `<section class="card score-card">${tb}<div class="paper" style="padding:24px 28px 14px;box-shadow:none;border:1px solid var(--border)"><div class="only-desktop">${d}</div><div class="only-phone">${p}</div></div></section>`;
  const playing = section('Listen playing (bar 3)', scoreCard(scoreToolbar({ playing: true }), resultsDesktop({ marks, playheadBar: 3 }).svg, resultsPhone({ marks, playheadBar: 3 }).svg));
  const tapped = section('Bar 5 tapped: Listen will start there', scoreCard(scoreToolbar({ from: 5 }), resultsDesktop({ marks, selectedBar: 5 }).svg, resultsPhone({ marks, selectedBar: 5 }).svg));
  const practice = section('Practice after Listen first', gradeHeader({ badge: '<span class="badge">Practice</span>', xp: '+3 XP (practice earns 25% of the XP)', reason: 'You listened first, so this one is practice.' }));
  const voidS = section('Not graded (void)', `${gradeHeader({ badge: '<span class="badge">Not graded</span>', xp: '+0 XP', grade: '', score: null, stars: null, line: '', reason: "We couldn't hear you, so this take wasn't graded.", actions: '<button class="btn btn-primary btn-hero">Check microphone</button><button class="btn btn-secondary btn-hero">Try again</button>' })}
    ${scoreCard('<div class="score-tools"><span class="t-small muted">Clean score. Nothing is marked when a take is not graded.</span></div>', resultsDesktop({}).svg, resultsPhone({}).svg)}
    <div class="res-actions only-phone" style="margin-top:16px;flex-direction:column"><button class="btn btn-primary btn-hero" style="width:100%">Check microphone</button><button class="btn btn-secondary btn-hero" style="width:100%">Try again</button></div>`);
  const toast = section('Tips turned off from results (toast, 6 s or more)', `<div class="toast" role="status"><span style="flex:1">Tips turned off. Turn them on in Settings > Practice.</span><button class="btn btn-compact">Undo</button></div>`);
  const body = `${loopbar({ right: '' })}
<main class="res"><h1 class="t-title" style="margin:0">Results states</h1>${playing}${tapped}${practice}${voidS}${toast}</main>`;
  return P.page({ title: 'Results states', body: RES_CSS + '<style>.grade-head{margin-bottom:0}.res .state-label{margin-bottom:12px}</style>' + body });
}

// ---------------------------------------------------------------- Focus states (C59)
function focus() {
  const body = `${P.appbar('practice')}
<main class="page" style="max-width:980px"><h1 class="t-title" style="margin-bottom:6px">Keyboard focus</h1><p class="t-small muted" style="margin:0 0 24px">2 px focus ring, 2 px offset, on every control kind.</p>
<div class="fgrid">
  <section class="card card-pad"><p class="state-label">Key chip</p>${P.keyChips({ selected: 'G major', focus: 'C major', foot: '' })}</section>
  <section class="card card-pad"><p class="state-label">Time segment</p>${P.timeSeg('4/4', { focus: '3/4' })}</section>
  <section class="card card-pad"><p class="state-label">Range note</p>${P.rangeFigure({ width: 380, sp: 10, kb: false, focusNote: 'C3' })}</section>
  <section class="card card-pad"><p class="state-label">Info button</p><div style="max-width:380px">${soundsGroup({ playing: '', popover: false }).replace('class="info-btn ', 'class="info-btn focus-demo ')}</div></section>
  <section class="card card-pad"><p class="state-label">Instrument card</p><div class="pick-grid voices" style="grid-template-columns:repeat(2,minmax(0,1fr))">${pcard(INSTR.voice[3], 'Baritone', { focus: 'Tenor' })}${pcard(INSTR.voice[4], 'Baritone')}</div></section>
</div></main>
<style>.fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; } .pcard { grid-template-rows: auto auto 30px auto; } @media (max-width: 700px) { .fgrid { grid-template-columns: 1fr; } }</style>`;
  return P.page({ title: 'Focus states', body });
}

// ---------------------------------------------------------------- Welcome, cover, errors (C57 in part)
function welcome() {
  const phrase = P.engrave({ clef: 'treble', key: { type: '#', count: 1 }, time: [3, 4], bars: [[{ p: 'B4', d: 'h' }, { p: 'A4', d: 'q' }], [{ p: 'G4', d: 'q' }, { p: 'A4', d: 'q' }, { p: 'B4', d: 'q' }], [{ p: 'D5', d: 'h' }, { p: 'C5', d: 'q' }], [{ p: 'B4', d: 'h', dot: true }]], perSystem: 4, width: 640, sp: 11, showLane: false, bottomPad: 2 * 11 });
  const body = `<main class="wel">
  <div class="wordmark" style="font-size:24px">${P.wordmark(28)}<span>Sightread</span></div>
  <div class="paper wel-paper">${phrase.svg}</div>
  <h1 class="t-display wel-h">Read it. Play it. See how it went.</h1>
  <p class="wel-b">Real music, a few bars at a time. We listen while you play and show you every note.</p>
  <button class="btn btn-primary btn-hero focus-demo">Get started</button>
  <p class="t-caption muted" style="margin-top:20px">Nothing is recorded or uploaded.</p>
</main>
<style>
.wel { max-width: 720px; margin: 0 auto; padding: 64px 32px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.wel-paper { width: 100%; padding: 28px 36px 18px; margin: 44px 0 40px; }
.wel-h { font-size: 52px; max-width: 620px; }
.wel-b { font-size: 18px; color: var(--text-muted); max-width: 520px; margin: 16px 0 32px; line-height: 1.55; }
@media (max-width: 700px) { .wel { padding: 32px 16px; } .wel-paper { padding: 16px 12px 8px; margin: 28px 0; } .wel-h { font-size: 36px; } .wel-b { font-size: 16px; } .wel .btn { width: 100%; } }
</style>`;
  return P.page({ title: 'Welcome', body });
}
function cover() {
  const big = P.engrave({ clef: 'bass', key: P.KEY, time: [4, 4], bars: [[]], perSystem: 1, width: 300, sp: 26, showLane: false, topPad: 2 * 26, bottomPad: 2 * 26 });
  const body = `${loopbar({ summary: false, right: `<span class="mode-chip" style="padding-left:14px">Ranked</span>` })}
<main class="cov">
  <div class="cov-sig">${big.svg}</div>
  <p class="cov-sum">${SUMMARY}</p>
  <p class="cov-cover">Take a moment to read before you play. Keep your eyes ahead. Every mark waits for you after the take.</p>
  <p class="cov-rank">You'll have 30 seconds to read, then the count-in starts by itself. Want more time? Switch to Practice. <button class="btn btn-secondary btn-compact">Practice instead</button></p>
  <button class="btn btn-primary btn-hero">Show the music <span class="kbd">Space</span></button>
  <button class="btn btn-quiet" style="margin-top:8px">Skip</button>
  <p class="t-caption muted" style="margin:2px 0 0">Skip is free before you see the music.</p>
</main>
<style>
.cov { max-width: 640px; margin: 0 auto; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.cov-sig { width: 300px; } .cov-sig svg { width: 100%; height: auto; display: block; }
.cov-sum { font-size: 18px; font-weight: 600; margin: 20px 0 0; }
.cov-cover { font-size: 16px; color: var(--text-muted); margin: 18px 0 0; max-width: 460px; }
.cov-rank { margin: 22px 0 26px; font-size: 15px; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: center; }
@media (max-width: 700px) { .cov { padding: 28px 16px; } .cov-sig { width: 230px; } .cov-sum { font-size: 15px; } .cov .btn-hero { width: 100%; } }
</style>`;
  return P.page({ title: 'Cover', body });
}
function errorScreen({ title, file, heading, body: text, actions, iconName = 'caution' }) {
  const body = `${P.appbar('practice')}
<main class="err"><span class="err-ic">${icon(iconName, 'lg')}</span><h1 class="t-title">${heading}</h1><p class="err-b">${text}</p><div class="err-a">${actions}</div></main>
<style>
.err { max-width: 560px; margin: 0 auto; padding: 96px 24px; text-align: left; }
.err-ic { width: 56px; height: 56px; border-radius: 16px; background: var(--surface-2); display: grid; place-items: center; margin-bottom: 22px; color: var(--text); }
.err-b { font-size: 17px; line-height: 1.55; color: var(--text-muted); margin: 12px 0 28px; }
.err-a { display: flex; gap: 10px; flex-wrap: wrap; }
@media (max-width: 700px) { .err { padding: 48px 16px; } .err-a .btn { width: 100%; } }
</style>`;
  return [file, P.page({ title, body })];
}

export function screens3() {
  return Object.fromEntries([
    ['setup-states.html', setupStates()],
    ['setup-sheet-key.html', setupSheetKey()],
    ['scan-listen.html', scanListen()],
    ['scan-instrument.html', scanInstrument()],
    ['scan-coach.html', scanCoach()],
    ['count-in-voice.html', countInVoice()],
    ['results-states.html', resultsStates()],
    ['focus.html', focus()],
    ['welcome.html', welcome()],
    ['cover.html', cover()],
    errorScreen({ title: 'Audio timing problem', file: 'error-clock.html', heading: 'Audio timing problem', body: "Your device's audio clock is running at the wrong speed, so timing can't be measured. Close other apps that play sound, then try again.", actions: '<button class="btn btn-primary btn-hero">Try again</button><button class="btn btn-secondary btn-hero">Back to Practice</button>' }),
    errorScreen({ title: 'Page not found', file: 'not-found.html', heading: 'Page not found', body: "There's nothing at this address.", actions: '<button class="btn btn-primary btn-hero">Go to Practice</button>', iconName: 'home' }),
  ]);
}
