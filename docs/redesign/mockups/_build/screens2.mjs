// Screens other than home. Revised after the UX critique (07-ux-critique.md); change numbers in comments.
import * as P from './parts.mjs';
const { icon, T } = P;

export const SUMMARY = `Difficulty 2 · G major · 4/4 · ${T(72)} · 8 bars`;
export const sizes = (s) => `<meta name="sizes" content="${s}">`;
export const scrollShot = (s) => `<meta name="scroll-shot" content="${s}">`;

export function loopbar({ right = '', summary = true, home = 'Home', text = SUMMARY } = {}) {
  return `<header class="loopbar">
  <button class="btn btn-quiet btn-compact">${icon('chevL')}${home}</button>
  ${summary ? `<p class="summary only-desktop">${text}</p>` : '<span style="margin-left:auto"></span>'}
  <span class="only-phone" style="margin-left:auto"></span>
  ${right}
</header>`;
}

// ---------------------------------------------------------------- Instrument picker
// [name, picture, text range, served (sounding), full (sounding), second line]
// Voices: the text is the sung range, the same frame as the bar (C13). Transposing instruments keep the written
// range in text and say that the bars show sounding pitch.
const BARS = 'bars show sounding pitch';
export const INSTR = {
  voice: [
    ['Soprano', 'treble', [57, 84], [62, 74], [57, 84]],
    ['Mezzo', 'treble', [55, 81], [60, 72], [55, 81]],
    ['Alto', 'treble', [52, 77], [57, 69], [52, 77]],
    ['Tenor', 'treble-8vb', [45, 69], [50, 62], [45, 69], 'Written an octave higher'],
    ['Baritone', 'bass', [43, 67], [48, 60], [43, 67]],
    ['Bass', 'bass', [40, 65], [45, 57], [40, 65]],
  ],
  woodwinds: [
    ['Flute', 'flute', [60, 96], [65, 77], [60, 96]],
    ['Clarinet in B♭', 'clarinet', [52, 91], [53, 68], [50, 89], `Sounds a major 2nd lower · ${BARS}`],
    ['Alto saxophone', 'sax', [58, 90], [53, 65], [49, 81], `Sounds a major 6th lower · ${BARS}`],
  ],
  brass: [['Trumpet in B♭', 'trumpet', [54, 84], [58, 70], [52, 82], `Sounds a major 2nd lower · ${BARS}`]],
  strings: [['Violin', 'violin', [55, 100], [62, 81], [55, 100]], ['Cello', 'cello', [40, 81], [43, 62], [40, 81]]],
  keyboard: [['Piano (right hand)', 'piano', [45, 96], [60, 72], [45, 96]]],
};
export function pcard([name, pic, text, servedSounding, sounding, tr], selected, { rulerW = 200, focus = '' } = {}) {
  const on = name === selected;
  const isClef = P.clefGlyph[pic];
  return `<button class="pcard ${on ? 'is-on' : ''} ${focus === name ? 'focus-demo' : ''}" role="radio" aria-checked="${on}" aria-label="${name}, range ${P.midiName(text[0])} to ${P.midiName(text[1])}">
  <span class="pic">${isClef ? `<span class="music">${isClef}</span>` : icon(pic, 'lg')}</span>
  <span class="nm">${name}</span>
  <span class="rg">${P.midiName(text[0])} to ${P.midiName(text[1])}</span>
  <span class="rb">${P.rulerBar({ full: sounding, served: servedSounding, width: rulerW, height: 22 })}</span>
  <span class="tr">${tr || ''}</span>
  ${on ? `<span class="check">${icon('check')}</span>` : ''}
</button>`;
}
export const AXIS = 'Bars show the sounding range on one scale, C1 to C8. The tall tick is middle C (C4). The bold part is what you get at your difficulty.';
export const PICKER_CSS = `<style>
body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); }
:root[data-theme="dark"] body { background: #050506; }
.pdlg { width: 1280px; max-width: calc(100vw - 48px); height: calc(100vh - 48px); margin: 24px auto; display: flex; flex-direction: column; overflow: hidden; }
.dlg-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 24px 24px 14px 32px; border-bottom: 1px solid var(--border); flex: none; }
.pbody { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 440px; }
.pgrid-pane { overflow: auto; padding: 4px 28px 24px 32px; }
.picked { border-left: 1px solid var(--border); background: var(--bg); padding: 24px 28px; overflow: auto; }
.dlg-foot { display: flex; align-items: center; gap: 8px; padding: 14px 32px 18px; border-top: 1px solid var(--border); flex: none; background: var(--surface); }
.axis { margin: 16px 0 0; display: flex; gap: 10px; align-items: flex-start; }
.axis .icon { width: 16px; height: 16px; margin-top: 1px; color: var(--text-muted); }
.grp-flow { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); column-gap: 10px; }
.pick-grid.c3 { grid-template-columns: repeat(3, minmax(0,1fr)); } .pick-grid.c2 { grid-template-columns: repeat(2, minmax(0,1fr)); } .pick-grid.c1 { grid-template-columns: 1fr; }
/* One shared skeleton per card, so names, ranges and bars line up across a row (C17). */
.pcard { grid-template-columns: 40px 1fr; grid-template-rows: auto auto 30px auto; align-items: start; align-content: start; height: 100%; }
.pcard .pic { grid-row: 1 / span 2; align-self: start; }
.pcard .nm { line-height: 1.3; padding-right: 22px; }
.pcard .rg { line-height: 1.35; }
.instr .pcard .nm { min-height: 2.6em; display: flex; align-items: flex-start; }
.pcard .rb { margin-top: 8px; align-self: center; }
.pcard .tr { min-height: 16px; line-height: 1.3; }
@media (max-width: 700px) {
  body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); }
  .psheet { margin-top: 12px; min-height: calc(100vh - 12px); padding-bottom: 300px; }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 4px; }
  .psheet .pick-grid.voices { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .psheet .voices .pcard { grid-template-columns: 1fr; grid-template-rows: auto auto auto 22px auto; padding: 12px 10px 10px; }
  .psheet .voices .pcard .pic { grid-row: auto; width: 34px; height: 34px; margin-bottom: 6px; }
  .psheet .voices .pcard .pic .music { font-size: 22px; }
  .psheet .voices .pcard .nm { font-size: 14px; padding-right: 0; }
  .psheet .voices .pcard .rg { font-size: 12.5px; }
  .psheet .voices .pcard .rb { margin-top: 6px; }
  .psheet .voices .pcard .tr { font-size: 11px; min-height: 0; }
  .psheet .voices .pcard .check { top: 8px; right: 8px; }
  /* Other instruments: one card a row, bar to the right, so no orphan cards (C18). */
  .psheet .pick-grid.list { grid-template-columns: 1fr; gap: 8px; }
  .psheet .list .pcard { grid-template-columns: 34px minmax(0,1fr) 112px; grid-template-rows: auto auto auto; column-gap: 12px; padding: 10px 12px; height: auto; }
  .psheet .list .pcard .pic { width: 34px; height: 34px; border-radius: 10px; grid-row: 1 / span 2; }
  .psheet .list .pcard .nm { font-size: 14px; min-height: 0; padding-right: 0; }
  .psheet .list .pcard .rg { grid-column: 2; font-size: 12.5px; }
  .psheet .list .pcard .rb { grid-column: 3; grid-row: 1 / span 2; margin: 0; align-self: center; }
  .psheet .list .pcard .tr { grid-column: 2 / -1; min-height: 0; font-size: 11.5px; }
  .psheet .list .pcard .tr:empty { display: none; }
  .psheet .list .pcard .check { top: 50%; right: auto; left: 30px; }
  .ppanel { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -16px 32px rgba(0,0,0,0.12); padding: 12px 16px 14px; }
  .ppanel .range-legend { margin-top: 6px; font-size: 13px; gap: 3px; }
  .ppanel .ph { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .ppanel .pfoot { display: flex; gap: 8px; margin-top: 10px; }
  .ppanel .pfoot .btn { flex: 1; }
}
</style>`;
function picker() {
  const grp = (title, key, cls, opts) => `<section class="pick-group"><h3 class="t-label">${title}</h3><div class="pick-grid ${cls}">${INSTR[key].map((c) => pcard(c, 'Baritone', opts)).join('')}</div></section>`;
  const axis = `<p class="axis t-caption muted">${icon('info')}<span>${AXIS}</span></p>`;
  const desktop = `<div class="only-desktop">
  <div class="dialog pdlg" role="dialog" aria-label="Choose your instrument">
    <div class="dlg-head"><div><h2 class="t-title" style="font-size:30px">Choose your instrument</h2><p class="t-small muted" style="margin:4px 0 0">We choose music in your range. Pick the card that fits you best.</p></div><button class="icon-btn" aria-label="Close">${icon('x')}</button></div>
    <div class="pbody">
      <div class="pgrid-pane">${axis}${grp('Voice', 'voice', 'voices')}
        <div class="grp-flow instr"><div style="grid-column:span 3">${grp('Woodwinds', 'woodwinds', 'c3', { rulerW: 160 })}</div><div>${grp('Brass', 'brass', 'c1', { rulerW: 160 })}</div><div style="grid-column:span 2">${grp('Strings', 'strings', 'c2', { rulerW: 160 })}</div><div>${grp('Keyboard', 'keyboard', 'c1', { rulerW: 160 })}</div></div>
      </div>
      <aside class="picked" aria-live="polite">
        <p class="t-eyebrow" style="margin:0 0 6px">Selected</p>
        <h3 class="t-h2">Baritone voice</h3>
        <p class="t-small muted" style="margin:4px 0 14px">Shown at difficulty 2, your current difficulty for this voice.</p>
        ${P.rangeFigure({ width: 384, sp: 11 })}
      </aside>
    </div>
    <div class="dlg-foot"><span class="switch"><span class="switch-track"></span>Show more instruments (less tested)</span><span style="flex:1"></span><button class="btn btn-quiet">Cancel</button><button class="btn btn-primary">Done</button></div>
  </div></div>`;
  const phone = `<div class="only-phone">
  <div class="sheet psheet">
    <div class="grabber"></div>
    <div class="sheet-head"><button class="btn btn-quiet btn-compact">Cancel</button><h2 class="t-h3">Choose your instrument</h2><button class="btn btn-primary btn-compact">Done</button></div>
    <div style="padding:0 16px 24px">
      ${axis}
      ${grp('Voice', 'voice', 'voices', { rulerW: 96 })}
      ${grp('Woodwinds', 'woodwinds', 'list', { rulerW: 112 })}${grp('Brass', 'brass', 'list', { rulerW: 112 })}${grp('Strings', 'strings', 'list', { rulerW: 112 })}${grp('Keyboard', 'keyboard', 'list', { rulerW: 112 })}
      <div style="margin-top:24px"><span class="switch"><span class="switch-track"></span>Show more instruments (less tested)</span></div>
    </div>
  </div>
  <section class="ppanel" aria-live="polite" aria-label="Selected instrument range">
    <div class="ph"><h3 class="t-h3">Baritone voice</h3><span class="t-caption muted">At difficulty 2</span></div>
    ${P.rangeFigure({ width: 358, sp: 8.5, kb: false, voiceLine: false })}
  </section>
</div>`;
  return P.page({ title: 'Instrument picker', cls: 'viewport-only', body: scrollShot('phone:560') + PICKER_CSS + desktop + phone });
}

// ---------------------------------------------------------------- Setup sheet (phone)
export const SHEET_CSS = `<style>
body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); }
:root[data-theme="dark"] body { background: #050506; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 6px; }
.sheet .row { padding: 20px 0; }
.tempo-set { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.sum-row { display:flex; align-items:center; gap:14px; width:100%; border:1px solid var(--border); background:var(--surface); padding:12px; border-radius:16px; }
</style>`;
export function tempoRow({ tag = true } = {}) {
  return `<div class="row">
      <div class="row-head"><p class="t-label">Tempo</p><span class="switch"><span class="switch-track"></span>Any tempo in range${tag ? ' <span class="tag">+8% XP</span>' : ''}</span></div>
      <div class="tempo-set"><span class="t-h3 nb" style="min-width:72px">${T(72)}</span><div class="slider"><div class="trk"></div><div class="fill" style="width:50%"></div><div class="thumb" style="left:50%"></div></div><span class="field num" style="width:60px">72</span></div>
      <button class="btn btn-tonal btn-compact" style="margin-top:14px">${icon('metronome', 'sm')}Hear the tempo</button>
    </div>`;
}
function setupSheet() {
  const body = `<div class="sheet" style="margin-top:12px">
  <div class="grabber"></div>
  <div class="sheet-head"><h2 class="t-h2">Setup</h2><button class="btn btn-primary btn-compact">Done</button></div>
  <div style="padding:6px 16px 40px">
    <button class="sum-row">
      <span class="inst-badge" style="width:44px;height:44px;border-radius:12px"><span class="music" style="font-size:26px">${P.clefGlyph.bass}</span></span>
      <span style="flex:1;text-align:left"><span class="t-h3" style="display:block">Baritone voice</span><span class="t-caption muted">Change instrument</span></span>${icon('chevR')}
    </button>
    <div style="margin-top:14px">${P.rangeFigure({ width: 340, sp: 10, compact: true })}</div>
    <div class="row" style="border-top:1px solid var(--border);margin-top:20px">${P.difficultyRow()}</div>
    <div class="row"><div class="row-head"><p class="t-label">Key</p></div>${P.keyChips({ selected: 'G major', cols: 3 })}</div>
    <div class="row"><div class="row-head"><p class="t-label">Time</p></div>${P.timeSeg('4/4')}</div>
    ${tempoRow()}
    <div class="row"><p class="t-label" style="margin-bottom:6px">Length</p><p class="t-small" style="margin:0">8 bars <span class="muted">(the only length at difficulty 2)</span></p></div>
  </div>
</div>`;
  return P.page({ title: 'Setup sheet', body: sizes('phone') + SHEET_CSS + body });
}

// ---------------------------------------------------------------- Read-through (scan)
// Voice and instrument variants of the sounds group. `playing`: 'pitch' | 'key' | 'listen' | 'tempo' | ''.
export function soundsGroup({ playing = 'pitch', popover = true, ranked = true, inst = false, hover = false } = {}) {
  const refName = inst ? 'Hear the key' : 'Hear starting pitch';
  const refCap = inst ? 'Plays the key chord, so you hear the key.' : 'Plays the key chord, then your first note.';
  const refInfo = inst
    ? 'The key chord is the home chord of this piece, at concert pitch. It gives away no notes, so you can use it in ranked takes too.'
    : "This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there. We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in.";
  const listening = playing === 'listen';
  return `<section class="card sounds-card" aria-label="Sounds">
  <div class="row-head" style="margin-bottom:10px"><h3 class="t-label">Sounds</h3><span class="t-caption muted">Nothing plays during the take</span></div>
  <button class="sound ${listening ? 'is-playing' : ''}"><span class="ic">${icon(listening ? 'stop' : 'listen')}</span><span class="lbl">${listening ? 'Stop' : 'Listen first'}</span><span class="cap">${ranked ? 'Makes this practice' : 'Hear how it goes before you play.'}</span></button>
  <button class="sound ${playing === 'tempo' ? 'is-playing' : ''}"><span class="ic">${icon('metronome')}</span><span class="lbl">Hear the tempo</span><span class="cap">One bar of clicks at ${T(72)}.</span></button>
  <div style="position:relative;margin-top:8px">
    <div class="sound ${playing === 'pitch' || playing === 'key' ? 'is-playing' : ''}" style="margin-top:0"><span class="ic">${icon(inst ? 'keychord' : 'pitch')}</span><span class="lbl">${refName}</span><span class="cap">${refCap}</span><span class="info"><button class="info-btn ${popover ? 'is-open' : ''}" aria-expanded="${popover}" aria-label="About ${refName}" title="${refCap}">${icon('info', 'sm')}</button></span></div>
    ${popover ? `<div class="popover ref-pop" role="note"><p class="t-label" style="margin:0 0 6px">${inst ? 'What is the key chord?' : 'What is the reference?'}</p><p style="margin:0">${refInfo}</p>${hover ? '<p class="t-caption muted" style="margin:10px 0 0">Opened by hovering. Click the (i) to keep it open.</p>' : ''}</div>` : ''}
  </div>
  ${inst ? `<button class="sound" style="margin-top:8px"><span class="ic">${icon('fork')}</span><span class="lbl">Check my tuning</span><span class="cap">Hold any note for 3 seconds. We'll allow for your tuning.</span></button>` : ''}
</section>`;
}
export function checklist({ inst = false } = {}) {
  const first = inst ? 'A major, three sharps: F♯, C♯, G♯. 4/4, felt in four.' : 'G major, one sharp: F♯. 4/4, felt in four.';
  const items = [['S', 'Signatures', first, true], ['T', 'Tempo', 'How one beat feels; hear the click.'], ['A', 'Accidentals', 'Find every accidental; note where the barline cancels it.'], ['R', 'Rhythms', 'Find the hardest bar; count it silently once.'], ['S', 'Signs and shape', 'Highest and lowest note, leaps, clef, dynamics, the ending.']];
  return `<section class="card card-pad" style="padding:22px 22px 10px">
  <div class="row-head" style="margin-bottom:2px"><h3 class="t-label">Before you play</h3><span class="t-eyebrow">Stars</span></div>
  <p class="t-caption muted" style="margin:0 0 6px">Optional. Tick as you check.</p>
  <ul class="checklist">${items.map(([l, t, p, on]) => `<li><span class="cbox ${on ? 'on' : ''}">${on ? icon('check', 'sm') : ''}</span><div><div class="ti"><span class="letter">${l}</span>${t}</div><div class="pr">${p}</div></div></li>`).join('')}</ul>
</section>`;
}
export const modeChip = (t = '0:24 to read', frac = 0.8, practice = false) => practice ? `<span class="mode-chip" style="padding-left:14px">Practice</span>` : `<span class="mode-chip">${P.ring(frac)}<span>Ranked · <span class="num">${t}</span></span></span>`;
export const liveCap = (txt) => `<p class="live-cap"><span class="eq"><i style="height:6px"></i><i style="height:14px"></i><i style="height:9px"></i></span>${txt}</p>`;

// Clarinet in B♭ version of the excerpt: written a major 9th above the baritone line, in A major (C24).
const UP9 = { G3: 'A4', A3: 'B4', B3: 'C#5', C4: 'D5', D3: 'E4', E3: 'F#4', 'F#3': 'G#4' };
export const CLAR = P.EXCERPT.map((bar) => bar.map((n) => ({ ...n, p: UP9[n.p], keyAcc: true })));
export function excerptScore(o, inst) {
  return inst ? P.engrave({ clef: 'treble', key: { type: '#', count: 3 }, time: [4, 4], bars: CLAR, barNumbers: true, ...o }) : P.score(o);
}
export const CLAR_SUMMARY = `Difficulty 2 · A major · 4/4 · ${T(72)} · 8 bars`;

export function scanDesktop({ confirm = false, practice = false, playing = 'pitch', popover = true, inst = false, coach = false, time = '0:24', hover = false } = {}) {
  const hlKey = playing === 'pitch' || playing === 'key';
  const s = excerptScore({ width: 872, sp: 15, perSystem: 4, highlightKey: hlKey, systemGap: 10, showLane: false, bottomPad: 2.4 * 15, playheadBar: playing === 'listen' ? 3 : undefined }, inst);
  const cap = playing === 'listen' ? 'Playing bar 3 of 8' : hlKey ? `Key chord: ${inst ? 'A major' : 'G major'}` : playing === 'tempo' ? `Tempo: ${T(72)}` : '';
  return `<div class="only-desktop">
${loopbar({ right: `${modeChip(`${time} to read`, 0.8, practice)}<button class="icon-btn" aria-label="More">${icon('more')}</button>`, text: inst ? CLAR_SUMMARY : SUMMARY })}
<main class="scan-grid">
  <section>
    <div class="paper" style="padding:40px 48px 32px">${s.svg}</div>
    <p class="t-small muted" style="margin:14px 4px 0">${practice ? 'Read it through. Start when you are ready.' : 'Read it through. The count-in starts by itself when the time runs out.'}</p>
  </section>
  <aside>
    <button class="btn btn-primary btn-hero btn-block">Start playing <span class="kbd">Space</span></button>
    ${coach ? `<div class="coach" role="note"><p style="margin:0">New: hear the tempo, the key and the music before you play.</p><button class="btn btn-secondary btn-compact">Got it</button><span class="coach-arrow"></span></div>` : `<div style="height:18px;margin:14px 2px 10px">${confirm || !cap ? '' : liveCap(cap)}</div>`}
    ${soundsGroup({ popover: popover && !confirm, playing: confirm ? '' : playing, ranked: !practice, inst, hover })}
    <div style="height:16px"></div>
    ${checklist({ inst })}
  </aside>
</main>
</div>`;
}
export function scanPhone({ explain = false, confirm = false, practice = false, playing = 'pitch', inst = false, coach = false, time = '0:24' } = {}) {
  const hlKey = !explain && !confirm && (playing === 'pitch' || playing === 'key');
  const s = excerptScore({ width: 342, sp: 9.5, perSystem: 2, highlightKey: hlKey, systemGap: 0, showLane: false, topPad: 3.8 * 9.5, bottomPad: 2.2 * 9.5, playheadBar: playing === 'listen' && !explain && !confirm ? 3 : undefined }, inst);
  const cap = explain || confirm ? '' : playing === 'listen' ? 'Playing bar 3 of 8' : hlKey ? `Key chord: ${inst ? 'A major' : 'G major'}` : '';
  const listening = playing === 'listen' && !explain && !confirm;
  return `<div class="only-phone">
${loopbar({ right: `${modeChip(time, 0.8, practice)}<button class="icon-btn" aria-label="More">${icon('more')}</button>`, summary: false })}
<main style="padding:10px 10px 330px">
  <p class="t-caption muted" style="margin:0 4px 8px;text-align:center">${inst ? CLAR_SUMMARY : SUMMARY}</p>
  <div class="paper" style="padding:12px 12px 8px;border-radius:16px">${s.svg}</div>
</main>
<div class="dock">
  <button class="peek"><span class="t-label">Before you play: 1 of 5</span>${icon('chevU', 'sm')}</button>
  <div class="dock-inner">
    ${coach ? `<div class="coach coach-phone" role="note"><p style="margin:0">New: hear the tempo, the key and the music before you play.</p><button class="btn btn-secondary btn-compact">Got it</button></div>` : `<div style="min-height:22px;margin:0 2px 8px">${cap ? liveCap(cap) : ''}</div>`}
    <div class="dock-row">
      <button class="dbtn ${listening ? 'is-playing' : ''}" aria-label="${listening ? 'Stop' : 'Listen first'}"><span class="ic">${icon(listening ? 'stop' : 'listen')}</span><span>${listening ? 'Stop' : 'Listen first'}</span>${practice ? '' : '<small>Makes this practice</small>'}</button>
      <button class="dbtn" aria-label="Hear the tempo"><span class="ic">${icon('metronome')}</span><span>Tempo</span></button>
      <button class="dbtn ${hlKey ? 'is-playing' : ''}" aria-label="${inst ? 'Hear the key' : 'Hear starting pitch'}"><span class="ic">${icon(inst ? 'keychord' : 'pitch')}</span><span>${inst ? 'Key' : 'Starting pitch'}</span></button>
      <button class="info-btn ${explain ? 'is-open' : ''}" style="width:44px;height:44px;align-self:center" aria-label="What do these do?">${icon('info')}</button>
    </div>
    <button class="btn btn-primary btn-hero btn-block" style="margin-top:12px">Start playing</button>
  </div>
</div>
</div>`;
}
export const SCAN_CSS = `<style>
.scan-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 32px; padding: 28px 40px 48px; max-width: 1440px; margin: 0 auto; align-items: start; }
.sounds-card { padding: 18px; }
.ref-pop { position: absolute; right: -6px; top: calc(100% + 12px); z-index: 5; width: 340px; }
.dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 8; }
.dock-inner { background: var(--surface); border-top: 1px solid var(--border); padding: 12px 14px 26px; box-shadow: 0 -10px 30px rgba(0,0,0,0.06); }
.peek { display: flex; align-items: center; justify-content: space-between; width: calc(100% - 24px); margin: 0 12px; height: 44px; padding: 0 16px; border-radius: 14px 14px 0 0; border: 1px solid var(--border); border-bottom: 0; background: var(--surface-2); }
.dock-row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; }
.dbtn { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; min-height: 72px; padding: 8px 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-weight: 600; font-size: 13px; line-height: 1.2; }
.dbtn .ic { color: var(--text); margin-bottom: 2px; }
.dbtn small { font-size: 10.5px; font-weight: 500; color: var(--text-muted); }
.dbtn.is-playing { border-color: var(--brass); box-shadow: 0 0 0 1px var(--brass) inset; background: var(--brass-wash); }
.dbtn.is-playing .ic { color: var(--brass-ink); }
.sound .ic .icon[viewBox] { }
.coach { position: relative; margin: 14px 0 14px; padding: 14px 16px; border-radius: 14px; background: var(--brass-wash); border: 1px solid color-mix(in srgb, var(--brass) 40%, transparent); display: flex; gap: 12px; align-items: center; font-size: 14.5px; font-weight: 500; }
.coach .btn { flex: none; }
.coach-arrow { position: absolute; left: 32px; bottom: -8px; width: 14px; height: 14px; background: color-mix(in srgb, var(--brass) 14%, var(--bg)); border-right: 1px solid color-mix(in srgb, var(--brass) 40%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--brass) 40%, transparent); transform: rotate(45deg); }
.coach-phone { margin: 0 0 10px; font-size: 13.5px; padding: 10px 12px; }
</style>`;
function scan() {
  return P.page({ title: 'Read-through', body: SCAN_CSS + scanDesktop() + scanPhone() });
}
function scanExplain() {
  // Same rows, names and strings as the desktop group; voice has three rows, no tuning check (C27 to C29).
  const item = (ic, t, c, extra = '') => `<div class="ex-item"><span class="ic">${icon(ic)}</span><div><p class="t-label" style="margin:0">${t}</p><p class="t-small muted" style="margin:2px 0 0">${c}</p>${extra}</div></div>`;
  const sheet = `<div class="scrim"></div>
<div class="sheet ex-sheet">
  <div class="grabber"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 20px 0"><h2 class="t-h2">What do these do?</h2><button class="icon-btn" aria-label="Close">${icon('x')}</button></div>
  <div style="padding:6px 20px 28px">
    ${item('listen', 'Listen first', 'Hear how it goes before you play.', '<p class="t-small" style="margin:4px 0 0">In a ranked take, this makes it practice. We ask first.</p>')}
    ${item('metronome', 'Hear the tempo', `One bar of clicks at ${T(72)}.`)}
    <div class="ex-ref">
      ${item('pitch', 'Hear starting pitch', 'Plays the key chord, then your first note.', `<p class="t-label" style="margin:12px 0 4px">What is the reference?</p><p class="t-small" style="margin:0">This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there. We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in.</p>`)}
    </div>
  </div>
</div>
<style>
.ex-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; }
.ex-item { display: grid; grid-template-columns: 44px 1fr; gap: 12px; padding: 14px 0; border-top: 1px solid var(--border); }
.ex-item:first-child { border-top: 0; }
.ex-item .ic { width: 44px; height: 44px; border-radius: 12px; background: var(--surface-2); display: grid; place-items: center; }
.ex-ref { margin: 4px -12px 0; padding: 0 12px 4px; border-radius: 16px; background: var(--brass-wash); }
.ex-ref .ex-item { border-top: 0; }
.ex-ref .ex-item .ic { background: var(--surface); }
</style>`;
  return P.page({ title: 'Read-through: what the sounds do', body: sizes('phone') + SCAN_CSS + scanPhone({ explain: true }) + sheet, cls: 'viewport-only' });
}
function scanConfirm() {
  // One timer: the chip and the dialog read the same value (C30).
  const dlg = (cls, grab) => `<div class="${cls}" role="dialog" aria-labelledby="lf-t">
  ${grab ? '<div class="grabber" style="margin:-14px auto 14px"></div>' : ''}
  <h2 class="t-h2" id="lf-t">Listen first?</h2>
  <p style="margin:10px 0 0">Hearing the music before you play makes this a practice take. It earns less XP and doesn't count toward your rank.</p>
  <p class="t-small muted" style="margin:10px 0 0">Your reading time keeps running: <span class="num">0:18</span> left.</p>
  <div class="cf-actions"><button class="btn btn-secondary">Listen, make it practice</button><button class="btn btn-primary focus-demo">Keep it ranked</button></div>
</div>`;
  const css = `<style>
.cf-dialog { position: fixed; z-index: 21; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 480px; background: var(--surface); border-radius: var(--r-xl); box-shadow: var(--shadow-3); padding: 28px; }
.cf-sheet { position: fixed; z-index: 21; left: 0; right: 0; bottom: 0; background: var(--surface); border-radius: var(--r-xl) var(--r-xl) 0 0; padding: 24px 20px 34px; box-shadow: var(--shadow-3); }
.cf-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
.cf-sheet .cf-actions { flex-direction: column-reverse; }
.cf-sheet .btn { width: 100%; height: 52px; }
</style>`;
  return P.page({ title: 'Listen first: ranked confirm', cls: 'viewport-only', body: SCAN_CSS + css + scanDesktop({ confirm: true, time: '0:18' }) + scanPhone({ confirm: true, time: '0:18' }) + `<div class="scrim"></div><div class="only-desktop">${dlg('cf-dialog')}</div><div class="only-phone">${dlg('cf-sheet', true)}</div>` });
}

// ---------------------------------------------------------------- Performance and count-in
export function perfBar({ beat = 2, label = 'Bar 5 of 8' } = {}) {
  const dots = [0, 1, 2, 3].map((i) => `<i class="${i === 0 ? 'down ' : ''}${i + 1 === beat ? 'on' : i + 1 < beat ? 'done' : ''}"></i>`).join('');
  const meter = [5, 9, 13, 16, 12, 7, 4].map((h, i) => `<i class="${i < 5 ? 'on' : ''}" style="height:${h}px"></i>`).join('');
  return `<header class="perfbar">
  <button class="btn btn-secondary btn-compact">${icon('stop', 'sm')}Stop</button>
  <div class="perf-mid"><span class="beats" aria-hidden="true">${dots}</span><span class="t-label">${label}</span><span class="muted t-small only-desktop">${T(72)}</span></div>
  <span class="mic">Mic <span class="bars">${meter}</span></span>
</header>`;
}
export const PERF_CSS = `<style>
.perfbar { height: 64px; display: flex; align-items: center; gap: 16px; padding: 0 24px; }
.perf-mid { margin: 0 auto; display: flex; align-items: center; gap: 16px; }
.perf-wrap { padding: 8px 32px 32px; }
.perf-paper { padding: 40px 72px 24px; border-radius: 24px; height: calc(100vh - 104px); display: flex; flex-direction: column; justify-content: center; }
@media (max-width: 700px) { .perfbar { padding: 0 12px; height: 56px; } .perf-mid { gap: 10px; } .perf-wrap { padding: 4px 8px 12px; } .perf-paper { padding: 22px 12px 12px; border-radius: 16px; height: calc(100vh - 72px); } }
/* Count-in: the number lives in the paper's top margin, above the first system, which stays at full ink (C32, C33). */
.count-band { position: absolute; left: 72px; right: 72px; top: 0; display: flex; align-items: center; justify-content: center; gap: 36px; }
.count-band .n { font-family: var(--font-display); font-weight: 600; font-size: 200px; line-height: 0.74; color: var(--brass-ink); font-variant-numeric: lining-nums; }
.count-band .side { display: grid; gap: 12px; }
.count-band .sub { font-size: 18px; font-weight: 600; margin: 0; }
.cdots { display: flex; gap: 14px; align-items: center; }
.cdots i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--text-muted); display: block; }
.cdots i.down { width: 20px; height: 20px; }
.cdots i.done { background: var(--text-muted); border-color: var(--text-muted); }
.cdots i.on { background: var(--brass); border-color: var(--brass); box-shadow: 0 0 0 6px var(--brass-wash); }
@media (max-width: 700px) { .count-band { left: 12px; right: 12px; gap: 20px; } .count-band .n { font-size: 132px; } .count-band .sub { font-size: 15px; } .cdots { gap: 10px; } }
</style>`;
// Take staff space on phones raised to 11 (C35): two bars a system, four systems on the page.
export const takeDesktop = (o = {}) => P.score({ width: 1150, sp: 16.5, perSystem: 4, systemGap: 8, ...o });
export const takePhone = (o = {}) => P.score({ width: 350, sp: 11, perSystem: 2, systemGap: 2, topPad: 3.4 * 11, bottomPad: 0.6 * 11, ...o });
function performance() {
  const d = takeDesktop({ marks: P.liveMarks(), playheadBar: 5 });
  const p = takePhone({ marks: P.liveMarks(), playheadBar: 5 });
  const body = `${perfBar()}
<main class="perf-wrap"><div class="paper perf-paper"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
  return P.page({ title: 'Take with live feedback', body: '<meta name="hc" content="1">' + PERF_CSS + body });
}
function countIn() {
  // Same score position as the take. First system full ink; later systems at 50%.
  const d = takeDesktop({ systemOpacity: [1, 0.5] });
  const p = takePhone({ systemOpacity: [1, 0.5] });
  const band = `<div class="count-band" aria-live="off"><div class="n num">3</div><div class="side"><div class="cdots"><i class="down done"></i><i class="done"></i><i class="on"></i><i></i></div><p class="sub">Bar 1 · ${T(72)}</p></div></div>`;
  const body = `${perfBar({ beat: 3, label: 'Count-in' })}
<main class="perf-wrap"><div class="paper perf-paper">${band}<div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
  return P.page({ title: 'Count-in', body: PERF_CSS + body });
}

// ---------------------------------------------------------------- Results and tips
export function tipCard({ expanded = false } = {}) {
  return `<section class="card card-pad tip-card">
  <div class="tip-head"><span class="tip-ic">${icon('lightbulb')}</span><h2 class="t-h2">One thing to try</h2></div>
  <p class="tip-text">Notes from the key signature were missed (for example F instead of F♯). Before you start, name the key and its altered notes out loud: “G major: F♯.”</p>
  <p class="t-small muted" style="margin:8px 0 0">Seen in bars 2 and 6.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="btn btn-tonal btn-compact">${icon('listen', 'sm')}Hear bar 2</button><button class="btn btn-tonal btn-compact">${icon('listen', 'sm')}Hear bar 6</button></div>
  ${expanded ? `<div class="more-tips">
    <button class="btn btn-quiet btn-compact" style="padding:0" aria-expanded="true">${icon('chevU', 'sm')}Hide tip</button>
    <div class="tip2"><p class="t-label" style="margin:0 0 4px">Rhythm</p><p style="margin:0">You fell behind the click. Keep your eyes at least one beat ahead, and keep moving when a note goes wrong: a wrong note on time beats a right note late.</p><p class="t-small muted" style="margin:6px 0 0">Seen in bars 3 to 8.</p>
    <div style="margin-top:12px"><button class="btn btn-tonal btn-compact" style="background:var(--surface)">${icon('listen', 'sm')}Hear bars 3 to 4</button></div></div>
    <div class="row-head" style="margin:18px 0 0;border-top:1px solid var(--border);padding-top:16px"><span class="t-small">Show a tip after each take</span><span class="switch is-on"><span class="switch-track"></span></span></div>
  </div>` : `<button class="btn btn-quiet btn-compact" style="padding:0;margin-top:14px" aria-expanded="false">${icon('chevD', 'sm')}Show 1 more tip</button>`}
</section>`;
}
// The weakest component is the one the first tip is about (C39).
export function components() {
  const c = (l, v, weak) => `<div class="comp"><span class="t-small" style="font-weight:600">${l}</span><span class="bar"><i class="${weak ? 'weak' : ''}" style="width:${v}%"></i></span><span class="v num">${v}</span></div>`;
  return `<section class="card card-pad">
  <h2 class="t-h3" style="margin-bottom:8px">How it went</h2>
  ${c('Notes', 76, true)}${c('In tune', 93)}${c('Rhythm', 85)}
  <p style="margin:12px 0 0"><b>Notes is the one to work on.</b> <span class="muted">You slowed down slightly by the end.</span></p>
  <p class="t-small muted counts" style="margin:14px 0 0"><span class="nb">29 notes</span> · <span class="nb">24 right</span> · <span class="nb">1 late</span> · <span class="nb">1 out of tune</span> · <span class="nb">2 wrong notes</span> · <span class="nb">1 missed</span></p>
</section>`;
}
export const ACTIONS = `<button class="btn btn-primary btn-hero">Next excerpt${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero">Try again (practice)</button><button class="btn btn-quiet btn-hero">Change setup</button>`;
export function gradeHeader({ badge = '<span class="badge ranked">Ranked</span>', xp = '+12 XP', reason = '', grade = 'B', score = '84', stars = 2, line = 'Solid. A few slips.', actions = ACTIONS } = {}) {
  return `<section class="grade-head">
  <div class="g-left">
    ${grade ? `<span class="grade">${grade}</span>` : ''}
    <div>
      ${score === null ? '<h1 class="t-display">Not graded</h1>' : `<div style="display:flex;align-items:baseline;gap:8px"><span class="t-display num">${score}</span><span class="muted t-small">of 100</span></div>`}
      ${stars === null ? '' : `<div class="stars" aria-label="${stars} of 3 stars">${P.star(stars > 0)}${P.star(stars > 1)}${P.star(stars > 2)}</div>`}
      ${line ? `<p style="margin:6px 0 0;font-weight:500">${line}</p>` : ''}
    </div>
  </div>
  <div class="g-right">
    <div class="xp-line">${badge}<span class="t-h3 num">${xp}</span><span class="t-small muted nb">Student · 81% to Section player</span><span class="xpbar" style="width:140px"><i style="width:81%"></i></span></div>
    ${reason ? `<p class="t-small reason">${reason}</p>` : ''}
    <div class="res-actions only-desktop">${actions}</div>
  </div>
</section>`;
}
export function scoreToolbar({ playing = false, from = 0 } = {}) {
  return `<div class="score-tools">
  <div class="seg" role="radiogroup" aria-label="Show"><button class="seg-btn is-on" style="min-height:36px">My take</button><button class="seg-btn" style="min-height:36px">Clean score</button></div>
  <span class="nav-slips"><button class="btn btn-secondary btn-compact">${icon('chevL', 'sm')}Previous slip</button><button class="btn btn-secondary btn-compact">Next slip${icon('chevR', 'sm')}</button></span>
  <span style="flex:1"></span>
  ${playing ? liveCap('Playing bar 3 of 8') : from ? `<span class="t-small muted nb">From bar ${from}</span>` : ''}
  <span class="switch"><span class="switch-track"></span>Slower</span>
  <button class="btn btn-primary btn-compact ${playing ? 'is-playing-btn' : ''}">${icon(playing ? 'stop' : 'listen', 'sm')}${playing ? 'Stop' : 'Listen'}</button>
</div>`;
}
export const RES_CSS = `<style>
.res { max-width: 1240px; margin: 0 auto; padding: 24px 40px 56px; }
.grade-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 20px; }
.g-left { display: flex; align-items: flex-end; gap: 24px; }
.g-right { display: flex; flex-direction: column; align-items: flex-end; gap: 14px; }
.xp-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.reason { margin: -6px 0 0; }
.score-card { padding: 18px; }
.score-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.nav-slips { display: inline-flex; gap: 8px; }
.res-cols { display: grid; grid-template-columns: 7fr 5fr; gap: 20px; margin-top: 20px; align-items: start; }
.tip-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.tip-ic { width: 40px; height: 40px; border-radius: 12px; background: var(--brass-wash); color: var(--brass-ink); display: grid; place-items: center; }
.tip-text { font-size: 17px; line-height: 1.55; margin: 0; }
.more-tips { margin-top: 14px; }
.tip2 { margin-top: 10px; padding: 16px; border-radius: 14px; background: var(--bg); }
.res-actions { display: flex; gap: 10px; }
.res-actions .btn-hero { --h: 52px; font-size: 16px; padding: 0 22px; }
.res-bar { display: none; }
.is-playing-btn { background: var(--surface); color: var(--text); border-color: var(--brass); box-shadow: 0 0 0 1px var(--brass) inset; }
@media (max-width: 700px) {
  .res { padding: 18px 14px 120px; }
  .grade-head { flex-direction: column; align-items: stretch; gap: 14px; }
  .g-left { gap: 16px; align-items: center; }
  .g-right { align-items: flex-start; }
  .xp-line { justify-content: flex-start; gap: 6px 12px; }
  .xp-line .xpbar { width: 100% !important; }
  .res-cols { grid-template-columns: 1fr; }
  .score-card { padding: 12px; }
  .score-card .paper { padding: 12px !important; }
  .score-tools { gap: 8px; }
  .score-tools .seg { width: 100%; } .score-tools .seg .seg-btn { flex: 1; }
  .nav-slips .btn { padding: 0 10px; }
  .res-end { flex-direction: column; }
  .res-end .btn { width: 100%; height: 52px; }
  .t-display { font-size: 40px; }
  /* Pinned once the header has scrolled away (C41). */
  .res-bar { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; padding: 10px 14px 24px; background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -10px 30px rgba(0,0,0,0.08); }
  .res-bar .btn { height: 52px; padding: 0 10px; font-size: 15px; }
}
</style>`;
export const resultsPhone = (o = {}) => P.score({ width: 314, sp: 9, perSystem: 2, ghostStyle: 'review', systemGap: 2, topPad: 3.4 * 9, bottomPad: 0.5 * 9, ...o });
export const resultsDesktop = (o = {}) => P.score({ width: 1100, sp: 12.5, perSystem: 4, ghostStyle: 'review', systemGap: 12, ...o });
function results() {
  const d = resultsDesktop({ marks: P.reviewMarks() });
  const p = resultsPhone({ marks: P.reviewMarks() });
  const body = `${loopbar({ right: '' })}
<main class="res">
  ${gradeHeader()}
  <section class="card score-card">
    ${scoreToolbar()}
    <div class="paper" style="padding:24px 28px 14px;box-shadow:none;border:1px solid var(--border)"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div>
  </section>
  <div class="res-cols">${tipCard()}${components()}</div>
  <div class="res-actions res-end only-phone" style="margin-top:20px">${ACTIONS}</div>
  <p class="t-caption muted" style="margin:28px 0 0">Melody in G major, composed for Sightread practice · bars 1 to 8 · CC0</p>
</main>
<div class="res-bar"><button class="btn btn-primary">Next excerpt${icon('arrowR', 'sm')}</button><button class="btn btn-secondary">Try again (practice)</button></div>`;
  return P.page({ title: 'Results', body: '<meta name="hc" content="1">' + scrollShot('phone:700') + RES_CSS + body });
}
function tips() {
  const body = `${loopbar({ right: '' })}
<main class="res" style="max-width:860px">
  <p class="t-small muted" style="margin:0 0 14px">Results, below the score</p>
  ${tipCard({ expanded: true })}
  <div style="height:20px"></div>
  ${components()}
</main>
<div class="res-bar"><button class="btn btn-primary">Next excerpt${icon('arrowR', 'sm')}</button><button class="btn btn-secondary">Try again (practice)</button></div>`;
  return P.page({ title: 'One thing to try (tips in results)', body: RES_CSS + body });
}

// ---------------------------------------------------------------- Calibration
function calibration() {
  const states = ['heard', 'heard', 'heard', 'missed', 'heard', 'heard', 'now', '', '', ''];
  const marks = states.map((s, i) => `<span class="cal-mark ${s}" role="img" aria-label="Click ${i + 1} of 10: ${s === 'heard' ? 'heard' : s === 'missed' ? 'missed' : 'waiting'}"></span>`).join('');
  const sel = (dis) => `<div class="cal-sel">
    <label><span class="t-label">Input device</span><span class="select ${dis ? 'is-disabled' : ''}" aria-disabled="${dis}">MacBook Pro Microphone ${icon('chevD', 'sm')}</span></label>
    <label><span class="t-label">Output</span><span class="select ${dis ? 'is-disabled' : ''}" aria-disabled="${dis}">Speakers ${icon('chevD', 'sm')}</span></label>
  </div>${dis ? '<p class="t-caption muted" style="margin:8px 0 0">Device choice is locked while we listen.</p>' : ''}`;
  // Listening: no "Hear the click" (it would be heard by the measurement), selects locked (C47, C51).
  const listening = `<p class="state-label">State: <b>listening</b></p><section class="card cal-card">
  <p class="t-small" style="margin:0;font-size:16px">Your speakers and mic add a small delay. We'll measure it so “late” really means late.</p>
  ${sel(true)}
  <div class="cal-stage">
    <p class="t-label" style="margin:0 0 4px">Listening…</p>
    <p class="t-small muted" style="margin:0 0 22px">Stay quiet for about 6 seconds while we time the clicks.</p>
    <div class="cal-marks">${marks}</div>
    <p class="cal-count num"><b>5</b> of 10 heard</p>
  </div>
  <div class="cal-foot"><span style="flex:1"></span><button class="btn btn-quiet">Skip</button></div>
  <p class="t-caption muted cal-skip">Without calibration, takes on this device are practice only. You can calibrate later from Practice or Settings.</p>
</section>`;
  const done = `<p class="state-label" style="margin-top:28px">State: <b>result</b></p><section class="card cal-card">
  ${sel(false)}
  <div class="cal-stage">
    <div class="cal-marks">${['heard', 'heard', 'heard', 'missed', 'heard', 'heard', 'heard', 'heard', 'heard', 'heard'].map((s) => `<span class="cal-mark ${s}"></span>`).join('')}</div>
    <p class="cal-count num"><b>9</b> of 10 heard</p>
    <p style="margin:10px 0 0;font-size:17px;font-weight:600">Your setup adds <span class="num">42</span> ms. We'll correct for it.</p>
  </div>
  <div class="cal-foot"><button class="btn btn-tonal">${icon('metronome', 'sm')}Hear the click</button><span style="flex:1"></span><button class="btn btn-primary">Continue</button></div>
</section>`;
  const body = `${P.appbar('practice')}
<main class="page" style="max-width:720px">
  <h1 class="t-title" style="margin-bottom:6px">Calibrate</h1>
  <p class="t-small muted" style="margin:0 0 24px">About 20 seconds. Using the Classic metronome sound.</p>
  ${listening}
  ${done}
</main>
<style>
.cal-card { padding: 32px; }
.cal-sel { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 22px; }
.cal-card > .cal-sel:first-child { margin-top: 0; }
.cal-sel label { display: grid; gap: 8px; }
.select.is-disabled { opacity: 0.4; }
.cal-stage { margin-top: 22px; padding: 28px; border-radius: 18px; background: var(--bg); }
.cal-count { margin: 22px 0 0; font-size: 17px; }
.cal-foot { display: flex; align-items: center; gap: 8px; margin-top: 24px; }
.cal-skip { margin: 10px 0 0; text-align: left; }
.cal-marks { flex-wrap: nowrap; }
@media (max-width: 700px) { .cal-card { padding: 20px; } .cal-sel { grid-template-columns: 1fr; } .cal-stage { padding: 20px 16px; } .cal-marks { gap: 7px; } .cal-mark { width: 22px; height: 22px; } .cal-mark.now { box-shadow: 0 0 0 4px var(--brass-wash); } }
</style>`;
  return P.page({ title: 'Calibrate', body });
}

// ---------------------------------------------------------------- Settings: sound
function wave(kind) {
  const beats = [0, 1, 2, 3];
  const W = 120, H = 36;
  let d = '';
  beats.forEach((b) => {
    const x = 8 + b * 30;
    const a = b === 0 ? 1 : 0.62;
    const h = (H / 2 - 2) * a;
    const m = H / 2;
    if (kind === 'classic') d += `M${x} ${m} L${x + 0.8} ${m - h} C${x + 2} ${m - h * 0.35} ${x + 4} ${m - h * 0.12} ${x + 9} ${m} C${x + 4} ${m + h * 0.12} ${x + 2} ${m + h * 0.35} ${x + 0.8} ${m + h} Z `;
    if (kind === 'woodblock') d += `M${x} ${m} C${x + 1} ${m - h * 0.9} ${x + 4} ${m - h * 0.75} ${x + 7} ${m - h * 0.4} C${x + 10} ${m - h * 0.1} ${x + 12} ${m} ${x + 14} ${m} C${x + 12} ${m} ${x + 10} ${m + h * 0.1} ${x + 7} ${m + h * 0.4} C${x + 4} ${m + h * 0.75} ${x + 1} ${m + h * 0.9} ${x} ${m} Z `;
    if (kind === 'beep') d += `M${x} ${m - h * 0.7} h9 v${h * 1.4} h-9 z `;
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="M2 ${H / 2} H${W - 2}" stroke="var(--border)" stroke-width="1"/><path d="${d}" fill="currentColor" fill-opacity="0.85" stroke="currentColor" stroke-width="0.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function settings() {
  // Classic selected; Woodblock previewing. Only one option can be playing (C54).
  const opt = (id, name, hint, on, playing) => `<div class="mopt ${on ? 'is-on' : ''} ${playing ? 'is-playing' : ''}" role="radio" aria-checked="${on}">
  <span class="radio">${on ? '<i></i>' : ''}</span>
  <div class="mtext"><p class="t-label" style="margin:0">${name}</p><p class="t-small muted" style="margin:2px 0 0">${hint}</p></div>
  <span class="mwave only-desktop">${wave(id)}</span>
  <button class="btn btn-tonal btn-compact" aria-label="${playing ? 'Stop' : `Play a bar of ${name}`}">${icon(playing ? 'stop' : 'play', 'sm')}<span class="only-desktop">${playing ? 'Stop' : 'Play a bar'}</span></button>
</div>`;
  const nav = ['Profile', 'Sound', 'Display', 'Practice', 'Accessibility', 'Data', 'About'].map((n) => `<a class="snav ${n === 'Sound' ? 'is-on' : ''}">${n}</a>`).join('');
  const body = `${P.appbar('')}
<main class="page set-grid">
  <nav class="only-desktop set-nav"><h1 class="t-title" style="font-size:30px;margin:0 0 18px">Settings</h1>${nav}</nav>
  <div>
    <div class="only-phone" style="margin-bottom:6px"><button class="btn btn-quiet btn-compact" style="padding:0">${icon('chevL', 'sm')}Settings</button></div>
    <h2 class="t-h2" style="font-size:28px;margin:0 0 18px">Sound</h2>
    <section class="card card-pad">
      <div class="row" style="padding-top:0;border:0">
        <div class="row-head"><p class="t-label">Metronome sound</p>${liveCap('Playing: Woodblock')}</div>
        <div role="radiogroup" aria-label="Metronome sound" class="mopts">
          ${opt('classic', 'Classic', 'A mechanical metronome: a firm, woody click.', true, false)}
          ${opt('woodblock', 'Woodblock', 'Rounder and softer.', false, true)}
          ${opt('beep', 'Beep', 'A short electronic beep. Cuts through in a loud room.', false, false)}
        </div>
        <p class="note-line">${icon('info')}<span>Changing the sound keeps your calibration.</span></p>
      </div>
      <div class="row"><div class="row-head" style="margin:0"><div><p class="t-label">Accent the first beat</p><p class="t-small muted" style="margin:2px 0 0">Beat one is higher and a little louder.</p></div><span class="switch is-on"><span class="switch-track"></span></span></div></div>
      <div class="row"><p class="t-label" style="margin-bottom:12px">Click volume</p><div style="display:flex;align-items:center;gap:14px">${icon('speaker', 'sm')}<div class="slider"><div class="trk"></div><div class="fill" style="width:70%"></div><div class="thumb" style="left:70%"></div></div><span class="num t-small" style="width:40px;text-align:right">70%</span></div><p class="hint">Plays one click when you let go.</p></div>
      <div class="row"><p class="t-label" style="margin-bottom:12px">Click during the take</p><div class="seg"><button class="seg-btn is-on">On</button><button class="seg-btn">Count-in only</button></div></div>
    </section>
    <section class="card card-pad" style="margin-top:18px">
      <div class="row" style="padding-top:0;border:0"><div class="row-head" style="margin:0"><div><p class="t-label">Calibration</p><p class="t-small muted" style="margin:2px 0 0">Calibrated today on Speakers. Your setup adds <span class="num">42</span> ms.</p></div><button class="btn btn-secondary btn-compact">Recalibrate</button></div></div>
      <div class="row"><p class="t-label" style="margin-bottom:10px">Input device</p><span class="select" style="max-width:360px">MacBook Pro Microphone ${icon('chevD', 'sm')}</span></div>
      <div class="row"><p class="t-label" style="margin-bottom:10px">Output</p><span class="select" style="max-width:360px">Speakers ${icon('chevD', 'sm')}</span></div>
      <div class="row"><div class="row-head" style="margin:0"><div><p class="t-label">Tuning pitch</p><p class="t-small muted" style="margin:2px 0 0">The A above middle C. Most groups tune to 440 Hz.</p></div><span class="field num">440 Hz</span></div></div>
    </section>
  </div>
</main>
<style>
.set-grid { display: grid; grid-template-columns: 220px minmax(0, 720px); gap: 48px; }
.snav { display: block; padding: 9px 14px; border-radius: 10px; color: var(--text-muted); font-weight: 500; }
.snav.is-on { background: var(--surface-2); color: var(--text); font-weight: 600; }
.mopts { display: grid; gap: 8px; }
.mopt { display: flex; align-items: center; gap: 14px; padding: 14px 14px 14px 16px; border-radius: 16px; border: 1px solid var(--border); color: var(--text); }
.mopt.is-on { background: var(--selected); border-color: var(--text); box-shadow: 0 0 0 1px var(--text) inset; }
.mopt.is-playing { border-color: var(--brass); box-shadow: 0 0 0 1px var(--brass) inset; }
.mopt.is-playing .mwave { color: var(--brass-ink); }
.mopt.is-playing .btn { background: var(--brass-wash); color: var(--brass-ink); }
.mtext { flex: 1; min-width: 0; }
.radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border-strong); display: grid; place-items: center; flex: none; }
.mopt.is-on .radio { border-color: var(--text); }
.radio i { width: 10px; height: 10px; border-radius: 50%; background: var(--text); }
@media (max-width: 700px) { .set-grid { display: block; } .mopt .btn { width: 44px; height: 44px; padding: 0; } }
</style>`;
  return P.page({ title: 'Settings: sound', body });
}

export function screens2() {
  return {
    'picker.html': picker(),
    'setup-sheet.html': setupSheet(),
    'scan.html': scan(),
    'scan-explain.html': scanExplain(),
    'scan-confirm.html': scanConfirm(),
    'performance.html': performance(),
    'count-in.html': countIn(),
    'results.html': results(),
    'tips.html': tips(),
    'calibration.html': calibration(),
    'settings.html': settings(),
  };
}
