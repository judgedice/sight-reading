// Screens other than home.
import * as P from './parts.mjs';
const { icon } = P;

const SUMMARY = 'Difficulty 2 · G major · 4/4 · <span class="nb">♩ = 72</span> · 8 bars';
const sizes = (s) => `<meta name="sizes" content="${s}">`;

function loopbar({ right = '', summary = true, home = 'Home' } = {}) {
  return `<header class="loopbar">
  <button class="btn btn-quiet btn-compact">${icon('chevL')}${home}</button>
  ${summary ? `<p class="summary only-desktop">${SUMMARY}</p>` : '<span style="margin-left:auto"></span>'}
  <span class="only-phone" style="margin-left:auto"></span>
  ${right}
</header>`;
}

// ---------------------------------------------------------------- Instrument picker
const INSTR = {
  voice: [
    ['Soprano', 'treble', [57, 84], [62, 74], [57, 84]],
    ['Mezzo', 'treble', [55, 81], [60, 72], [55, 81]],
    ['Alto', 'treble', [52, 77], [57, 69], [52, 77]],
    ['Tenor', 'treble-8vb', [57, 81], [50, 62], [45, 69], 'Sounds an octave lower'],
    ['Baritone', 'bass', [43, 67], [48, 60], [43, 67]],
    ['Bass', 'bass', [40, 65], [45, 57], [40, 65]],
  ],
  woodwinds: [
    ['Flute', 'flute', [60, 96], [65, 77], [60, 96]],
    ['Clarinet in B♭', 'clarinet', [52, 91], [53, 68], [50, 89], 'Sounds a major 2nd lower'],
    ['Alto saxophone', 'sax', [58, 90], [53, 65], [49, 81], 'Sounds a major 6th lower'],
  ],
  brass: [['Trumpet in B♭', 'trumpet', [54, 84], [58, 70], [52, 82], 'Sounds a major 2nd lower']],
  strings: [['Violin', 'violin', [55, 100], [62, 81], [55, 100]], ['Cello', 'cello', [40, 81], [43, 62], [40, 81]]],
  keyboard: [['Piano (right hand)', 'piano', [45, 96], [60, 72], [45, 96]]],
};
function pcard([name, pic, written, servedSounding, sounding, tr], selected, rulerW = 200) {
  const on = name === selected;
  const isClef = P.clefGlyph[pic];
  return `<button class="pcard ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}">
  <span class="pic">${isClef ? `<span class="music">${isClef}</span>` : icon(pic, 'lg')}</span>
  <span class="nm">${name}</span>
  <span class="rg">${P.midiName(written[0])} to ${P.midiName(written[1])}</span>
  <span class="rb">${P.rulerBar({ full: sounding, served: servedSounding, width: rulerW, height: 22 })}</span>
  ${tr ? `<span class="tr">${tr}</span>` : ''}
  ${on ? `<span class="check">${icon('check')}</span>` : ''}
</button>`;
}
function pickerBody(compact) {
  const grp = (title, key, cls = '') => `<section class="pick-group"><h3 class="t-label">${title}</h3><div class="pick-grid ${cls}">${INSTR[key].map((c) => pcard(c, 'Baritone', compact ? 150 : 200)).join('')}</div></section>`;
  return { grp };
}
function picker() {
  const { grp } = pickerBody(false);
  const axis = `<div class="axis"><span class="t-caption muted">Bars show sounding range on one scale, C1 to C8. Dark is what you get at your difficulty.</span></div>`;
  const big = `<section class="picked">
    <div><p class="t-eyebrow" style="margin:0 0 6px">Selected</p><h3 class="t-h2">Baritone voice</h3>
    <p class="t-small muted" style="margin:6px 0 0">Shown at difficulty 2, your current difficulty for this voice.</p></div>
    <div>${P.rangeFigure({ width: 400, sp: 11 })}</div>
  </section>`;
  const desktop = `<div class="only-desktop picker-desk">
  <div class="dialog" role="dialog" aria-label="Choose your instrument" style="width:920px;margin:40px auto">
    <div class="dlg-head"><h2 class="t-title" style="font-size:30px">Choose your instrument</h2><button class="icon-btn" aria-label="Close">${icon('x')}</button></div>
    <p class="t-small muted" style="margin:6px 32px 0">We choose music in your range. Pick the card that fits you best.</p>
    <div class="dlg-body">${axis}${grp('Voice', 'voice', 'voices')}
      <div class="grp-flow"><div style="grid-column:span 3">${grp('Woodwinds', 'woodwinds', 'c3')}</div><div>${grp('Brass', 'brass', 'c1')}</div><div style="grid-column:span 2">${grp('Strings', 'strings', 'c2')}</div><div>${grp('Keyboard', 'keyboard', 'c1')}</div></div></div>
    ${big}
    <div class="dlg-foot"><span class="switch"><span class="switch-track"></span>Show more instruments (less tested)</span><span style="flex:1"></span><button class="btn btn-quiet">Cancel</button><button class="btn btn-primary">Done</button></div>
  </div></div>`;
  const ph = pickerBody(true);
  const phone = `<div class="only-phone">
  <div class="sheet" style="margin-top:12px;min-height:820px">
    <div class="grabber"></div>
    <div class="sheet-head"><button class="btn btn-quiet btn-compact">Cancel</button><h2 class="t-h3">Choose your instrument</h2><button class="btn btn-primary btn-compact">Done</button></div>
    <div style="padding:0 16px 32px">
      ${ph.grp('Voice', 'voice', 'voices')}
      <section class="picked-phone card" style="margin-top:16px;padding:18px">
        <h3 class="t-h3">Baritone voice</h3><p class="t-caption muted" style="margin:2px 0 8px">At difficulty 2</p>
        ${P.rangeFigure({ width: 320, sp: 9.5, compact: true })}
      </section>
      ${ph.grp('Woodwinds', 'woodwinds')}${ph.grp('Brass', 'brass')}${ph.grp('Strings', 'strings')}${ph.grp('Keyboard', 'keyboard')}
      <div style="margin-top:24px"><span class="switch"><span class="switch-track"></span>Show more instruments (less tested)</span></div>
    </div>
  </div></div>`;
  const css = `<style>
body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); }
:root[data-theme="dark"] body { background: #050506; }
.dlg-head { display: flex; align-items: center; justify-content: space-between; padding: 28px 24px 0 32px; }
.dlg-body { padding: 4px 32px 8px; }
.axis { margin-top: 14px; }
.grp-flow { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); column-gap: 10px; }
.pick-grid.c3 { grid-template-columns: repeat(3, minmax(0,1fr)); } .pick-grid.c2 { grid-template-columns: repeat(2, minmax(0,1fr)); } .pick-grid.c1 { grid-template-columns: 1fr; }
.picked { margin: 20px 32px 0; padding: 24px; border-radius: 20px; background: var(--bg); display: grid; grid-template-columns: 1fr 400px; gap: 32px; align-items: start; }
.dlg-foot { display: flex; align-items: center; gap: 8px; padding: 20px 32px 24px; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 4px; }
.only-phone .pick-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
.only-phone .pick-grid.voices { grid-template-columns: repeat(3, minmax(0,1fr)); }
.only-phone .voices .pcard { grid-template-columns: 1fr; padding: 12px 10px 10px; }
.only-phone .voices .pcard .pic { grid-row: auto; width: 34px; height: 34px; margin-bottom: 6px; }
.only-phone .voices .pcard .pic .music { font-size: 22px; }
.only-phone .voices .pcard .rb { margin-top: 6px; }
.only-phone .voices .pcard .tr { display: none; }
.only-phone .pcard { grid-template-columns: 34px 1fr; column-gap: 10px; padding: 12px; }
.only-phone .pcard .pic { width: 34px; height: 34px; border-radius: 10px; }
.only-phone .pcard .nm { font-size: 14px; }
@media (max-width: 700px) { body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); } }
</style>`;
  return P.page({ title: 'Instrument picker', body: css + desktop + phone });
}

// ---------------------------------------------------------------- Setup sheet (phone)
function setupSheet() {
  const body = `<style>
body { background: color-mix(in srgb, var(--bg) 70%, #000 30%); }
:root[data-theme="dark"] body { background: #050506; }
.sheet-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 6px; }
.sheet .row { padding: 20px 0; }
.tempo-set { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
</style>
<div class="sheet" style="margin-top:12px">
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
    <div class="row">
      <div class="row-head"><p class="t-label">Tempo</p><span class="switch"><span class="switch-track"></span>Any tempo in range</span></div>
      <div class="tempo-set"><span class="t-h3 num nb" style="min-width:64px">♩ = 72</span><div class="slider"><div class="trk"></div><div class="fill" style="width:50%"></div><div class="thumb" style="left:50%"></div></div><span class="field num" style="width:60px">72</span></div>
      <button class="btn btn-tonal btn-compact" style="margin-top:14px">${icon('metronome', 'sm')}Hear the tempo</button>
    </div>
    <div class="row"><p class="t-label" style="margin-bottom:6px">Length</p><p class="t-small" style="margin:0">8 bars <span class="muted">(the only length at difficulty 2)</span></p></div>
  </div>
</div>
<style>.sum-row { display:flex; align-items:center; gap:14px; width:100%; border:1px solid var(--border); background:var(--surface); padding:12px; border-radius:16px; }</style>`;
  return P.page({ title: 'Setup sheet', body: sizes('phone') + body });
}

// ---------------------------------------------------------------- Read-through (scan)
function soundsGroup({ playing = 'pitch', popover = true, ranked = true } = {}) {
  return `<section class="card sounds-card" aria-label="Sounds">
  <div class="row-head" style="margin-bottom:10px"><h3 class="t-label">Sounds</h3><span class="t-caption muted">Nothing plays during the take</span></div>
  <button class="sound"><span class="ic">${icon('listen')}</span><span class="lbl">Listen first</span><span class="cap">${ranked ? 'Makes this practice' : 'Hear how it goes before you play.'}</span></button>
  <button class="sound"><span class="ic">${icon('metronome')}</span><span class="lbl">Hear the tempo</span><span class="cap">One bar of clicks at <span class="nb">♩ = 72</span>.</span></button>
  <div style="position:relative;margin-top:8px">
    <div class="sound ${playing === 'pitch' ? 'is-playing' : ''}" style="margin-top:0"><span class="ic">${icon('chord')}</span><span class="lbl">Hear starting pitch</span><span class="cap">Plays the key chord, then your first note.</span><span class="info"><button class="info-btn ${popover ? 'is-open' : ''}" aria-expanded="${popover}" aria-label="About Hear starting pitch">${icon('info', 'sm')}</button></span></div>
    ${popover ? `<div class="popover ref-pop" role="note"><p class="t-label" style="margin:0 0 6px">What is the reference?</p><p style="margin:0">This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there.</p><p class="muted" style="margin:8px 0 0">We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in.</p></div>` : ''}
  </div>
</section>`;
}
function checklist(compact) {
  const items = [['S', 'Signatures', 'G major, one sharp: F♯. 4/4, felt in four.', true], ['T', 'Tempo', 'How one beat feels; hear the click.'], ['A', 'Accidentals', 'Find every accidental; note where the barline cancels it.'], ['R', 'Rhythms', 'Find the hardest bar; count it silently once.'], ['S', 'Signs and shape', 'Highest and lowest note, leaps, clef, dynamics, the ending.']];
  return `<section class="card card-pad" style="padding:22px 22px 10px">
  <div class="row-head" style="margin-bottom:2px"><h3 class="t-label">Before you play</h3><span class="t-eyebrow">Stars</span></div>
  <p class="t-caption muted" style="margin:0 0 6px">Optional. Tick as you check.</p>
  <ul class="checklist">${items.map(([l, t, p, on]) => `<li><span class="cbox ${on ? 'on' : ''}">${on ? icon('check', 'sm') : ''}</span><div><div class="ti"><span class="letter">${l}</span>${t}</div><div class="pr">${p}</div></div></li>`).join('')}</ul>
</section>`;
}
const modeChip = (t = '0:24 to read', frac = 0.8) => `<span class="mode-chip">${P.ring(frac)}<span>Ranked · <span class="num">${t}</span></span></span>`;
const liveCap = (txt) => `<p class="live-cap"><span class="eq"><i style="height:6px"></i><i style="height:14px"></i><i style="height:9px"></i></span>${txt}</p>`;

function scanDesktop({ confirm = false } = {}) {
  const s = P.score({ width: 860, sp: 13.5, perSystem: 4, highlightKey: !confirm, systemGap: 8, showLane: false, bottomPad: 2.4 * 13.5 });
  return `<div class="only-desktop">
${loopbar({ right: `${modeChip()}<button class="icon-btn" aria-label="More">${icon('more')}</button>` })}
<main class="scan-grid">
  <section>
    <div class="paper" style="padding:44px 48px 36px">${s.svg}</div>
    <p class="t-small muted" style="margin:14px 4px 0">Read it through. The count-in starts by itself when the time runs out.</p>
  </section>
  <aside>
    <button class="btn btn-primary btn-hero btn-block">Start playing <span class="kbd">Space</span></button>
    <div style="height:18px;margin:14px 2px 10px">${confirm ? '' : liveCap('Key chord: G major')}</div>
    ${soundsGroup({ popover: !confirm, playing: confirm ? '' : 'pitch' })}
    <div style="height:16px"></div>
    ${checklist()}
  </aside>
</main>
</div>`;
}
function scanPhone({ explain = false, confirm = false } = {}) {
  const s = P.score({ width: 330, sp: 8.5, perSystem: 2, highlightKey: !explain && !confirm, systemGap: 0, showLane: false, topPad: 3.8 * 8.5, bottomPad: 2.2 * 8.5 });
  return `<div class="only-phone">
${loopbar({ right: `${modeChip('0:24')}<button class="icon-btn" aria-label="More">${icon('more')}</button>`, summary: false })}
<main style="padding:12px 12px 300px">
  <p class="t-caption muted" style="margin:0 4px 10px;text-align:center">${SUMMARY}</p>
  <div class="paper" style="padding:14px 18px 10px;border-radius:16px">${s.svg}</div>
</main>
<div class="dock">
  <button class="peek"><span class="t-label">Before you play: 1 of 5</span>${icon('chevD', 'sm')}</button>
  <div class="dock-inner">
    <div style="min-height:22px;margin:0 2px 8px">${explain || confirm ? '' : liveCap('Key chord: G major')}</div>
    <div class="dock-row">
      <button class="dbtn"><span class="ic">${icon('listen')}</span><span>Listen first</span><small>Makes this practice</small></button>
      <button class="dbtn"><span class="ic">${icon('metronome')}</span><span>Tempo</span></button>
      <button class="dbtn ${explain || confirm ? '' : 'is-playing'}"><span class="ic">${icon('chord')}</span><span>Starting pitch</span></button>
      <button class="info-btn ${explain ? 'is-open' : ''}" style="width:44px;height:44px;align-self:center" aria-label="What do these do?">${icon('info')}</button>
    </div>
    <button class="btn btn-primary btn-hero btn-block" style="margin-top:12px">Start playing</button>
  </div>
</div>
</div>`;
}
const SCAN_CSS = `<style>
.scan-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 32px; padding: 32px 40px 48px; max-width: 1440px; margin: 0 auto; align-items: start; }
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
</style>`;
function scan() {
  return P.page({ title: 'Read-through', body: SCAN_CSS + scanDesktop() + scanPhone() });
}
function scanExplain() {
  const item = (ic, t, c) => `<div class="ex-item"><span class="ic">${icon(ic)}</span><div><p class="t-label" style="margin:0">${t}</p><p class="t-small muted" style="margin:2px 0 0">${c}</p></div></div>`;
  const sheet = `<div class="scrim"></div>
<div class="sheet ex-sheet">
  <div class="grabber"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 20px 0"><h2 class="t-h2">What do these do?</h2><button class="icon-btn" aria-label="Close">${icon('x')}</button></div>
  <div style="padding:6px 20px 28px">
    ${item('listen', 'Listen first', 'Hear how the music goes before you play. In a ranked take this makes it practice, and we ask first.')}
    ${item('metronome', 'Tempo', 'One bar of clicks at ♩ = 72, so you feel the beat.')}
    <div class="ex-ref">
      ${item('chord', 'Starting pitch: your reference', 'The reference is the key of the piece. You hear its home chord, then the first note you\'ll sing. Find your pitch from there.')}
      <p class="t-small" style="margin:10px 0 0 56px">We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in.</p>
    </div>
    ${item('fork', 'Check my tuning', 'In "Before you play". Hold any note for 3 seconds and we allow for your tuning.')}
  </div>
</div>
<style>
.ex-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; }
.ex-item { display: grid; grid-template-columns: 44px 1fr; gap: 12px; padding: 14px 0; border-top: 1px solid var(--border); }
.ex-item:first-child { border-top: 0; }
.ex-item .ic { width: 44px; height: 44px; border-radius: 12px; background: var(--surface-2); display: grid; place-items: center; }
.ex-ref { margin: 4px -12px; padding: 0 12px 14px; border-radius: 16px; background: var(--brass-wash); }
.ex-ref .ex-item { border-top: 0; }
</style>`;
  return P.page({ title: 'Read-through: what the sounds do', body: sizes('phone') + SCAN_CSS + scanPhone({ explain: true }) + sheet, cls: 'viewport-only' });
}
function scanConfirm() {
  const dlg = (cls) => `<div class="${cls}" role="dialog" aria-labelledby="lf-t">
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
  return P.page({ title: 'Listen first: ranked confirm', cls: 'viewport-only', body: SCAN_CSS + css + scanDesktop({ confirm: true }) + scanPhone({ confirm: true }) + `<div class="scrim"></div><div class="only-desktop">${dlg('cf-dialog')}</div><div class="only-phone">${dlg('cf-sheet')}</div>` });
}

// ---------------------------------------------------------------- Performance and count-in
function perfBar({ beat = 2, countIn = false } = {}) {
  const dots = [0, 1, 2, 3].map((i) => `<i class="${i === 0 ? 'down ' : ''}${i + 1 === beat ? 'on' : i + 1 < beat ? 'done' : ''}"></i>`).join('');
  const meter = [5, 9, 13, 16, 12, 7, 4].map((h, i) => `<i class="${i < 5 ? 'on' : ''}" style="height:${h}px"></i>`).join('');
  return `<header class="perfbar">
  <button class="btn btn-secondary btn-compact">${icon('stop', 'sm')}Stop</button>
  <div class="perf-mid"><span class="beats" aria-hidden="true">${dots}</span><span class="t-label">${countIn ? 'Count-in' : 'Bar 5 of 8'}</span><span class="muted t-small nb only-desktop">♩ = 72</span></div>
  <span class="mic">Mic <span class="bars">${meter}</span></span>
</header>`;
}
const PERF_CSS = `<style>
.perfbar { height: 64px; display: flex; align-items: center; gap: 16px; padding: 0 24px; }
.perf-mid { margin: 0 auto; display: flex; align-items: center; gap: 16px; }
.perf-wrap { padding: 8px 32px 32px; }
.perf-paper { padding: 40px 72px 24px; border-radius: 24px; min-height: calc(100vh - 100px); display: flex; flex-direction: column; justify-content: center; }
@media (max-width: 700px) { .perfbar { padding: 0 12px; height: 56px; } .perf-mid { gap: 10px; } .perf-wrap { padding: 4px 10px 24px; } .perf-paper { padding: 22px 18px 12px; border-radius: 16px; } }
.countin { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--paper) 78%, transparent); border-radius: inherit; }
.countin > div { background: var(--surface); border: 1px solid var(--border); border-radius: 36px; box-shadow: var(--shadow-3); padding: 28px 64px 30px; text-align: center; }
@media (max-width: 700px) { .countin > div { padding: 18px 40px 22px; border-radius: 28px; } }
.countin .n { font-family: var(--font-display); font-weight: 600; font-size: 200px; line-height: 1; color: var(--brass-ink); font-variant-numeric: lining-nums; }
.countin .sub { font-size: 18px; font-weight: 600; text-align: center; margin-top: 8px; }
.countin .cdots { display: flex; gap: 14px; justify-content: center; margin-top: 18px; align-items: center; }
.countin .cdots i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--text-muted); display: block; }
.countin .cdots i.down { width: 20px; height: 20px; }
.countin .cdots i.done { background: var(--text-muted); border-color: var(--text-muted); }
.countin .cdots i.on { background: var(--brass); border-color: var(--brass); box-shadow: 0 0 0 6px var(--brass-wash); }
@media (max-width: 700px) { .countin .n { font-size: 132px; } .countin .sub { font-size: 16px; } }
</style>`;
function performance() {
  const d = P.score({ width: 1150, sp: 16.5, perSystem: 4, marks: P.liveMarks(), playheadBar: 5, systemGap: 8 });
  const p = P.score({ width: 350, sp: 8.6, perSystem: 2, marks: P.liveMarks(), playheadBar: 5, systemGap: 4, topPad: 3.4 * 8.6, bottomPad: 1 * 8.6 });
  const body = `${perfBar()}
<main class="perf-wrap"><div class="paper perf-paper"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div></main>`;
  return P.page({ title: 'Take with live feedback', body: PERF_CSS + body });
}
function countIn() {
  const d = P.score({ width: 1150, sp: 16.5, perSystem: 4, systemGap: 8 });
  const p = P.score({ width: 350, sp: 8.6, perSystem: 2, systemGap: 4, topPad: 3.4 * 8.6, bottomPad: 1 * 8.6 });
  const overlay = `<div class="countin"><div><div class="n num">3</div><div class="cdots"><i class="down done"></i><i class="done"></i><i class="on"></i><i></i></div><p class="sub">Bar 1 · <span class="nb">♩ = 72</span></p></div></div>`;
  const body = `${perfBar({ beat: 3, countIn: true })}
<main class="perf-wrap"><div class="paper perf-paper"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div>${overlay}</div></main>`;
  return P.page({ title: 'Count-in', body: PERF_CSS + body });
}

// ---------------------------------------------------------------- Results and tips
function tipCard({ expanded = false } = {}) {
  return `<section class="card card-pad tip-card">
  <div class="tip-head"><span class="tip-ic">${icon('lightbulb')}</span><h2 class="t-h2">One thing to try</h2></div>
  <p class="tip-text">Notes from the key signature were missed (for example F instead of F♯). Before you start, name the key and its altered notes out loud: “G major: F♯.”</p>
  <p class="t-small muted" style="margin:8px 0 0">Seen in bars 2 and 6.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="btn btn-tonal btn-compact">${icon('listen', 'sm')}Hear bar 2</button><button class="btn btn-tonal btn-compact">${icon('listen', 'sm')}Hear bar 6</button></div>
  ${expanded ? `<div class="more-tips">
    <button class="btn btn-quiet btn-compact" style="padding:0">${icon('chevD', 'sm')}Hide 1 more tip</button>
    <div class="tip2"><p class="t-label" style="margin:0 0 4px">Rhythm</p><p style="margin:0">You fell behind the click. Keep your eyes at least one beat ahead, and keep moving when a note goes wrong: a wrong note on time beats a right note late.</p><p class="t-small muted" style="margin:6px 0 0">Seen in bars 3 to 8.</p></div>
    <div class="row-head" style="margin:18px 0 0;border-top:1px solid var(--border);padding-top:16px"><span class="t-small">Show a tip after each take</span><span class="switch is-on"><span class="switch-track"></span></span></div>
  </div>` : `<button class="btn btn-quiet btn-compact" style="padding:0;margin-top:14px">${icon('chevR', 'sm')}1 more tip</button>`}
</section>`;
}
function components() {
  const c = (l, v, weak) => `<div class="comp"><span class="t-small" style="font-weight:600">${l}</span><span class="bar"><i class="${weak ? 'weak' : ''}" style="width:${v}%"></i></span><span class="v num">${v}</span></div>`;
  return `<section class="card card-pad">
  <h2 class="t-h3" style="margin-bottom:8px">How it went</h2>
  ${c('Notes', 86)}${c('In tune', 93)}${c('Rhythm', 78, true)}
  <p style="margin:12px 0 0"><b>Rhythm is the one to work on.</b> <span class="muted">You slowed down slightly by the end.</span></p>
  <p class="t-small muted counts" style="margin:14px 0 0"><span class="nb">29 notes</span> · <span class="nb">24 right</span> · <span class="nb">1 late</span> · <span class="nb">1 out of tune</span> · <span class="nb">2 wrong notes</span> · <span class="nb">1 missed</span></p>
</section>`;
}
function gradeHeader() {
  return `<section class="grade-head">
  <div class="g-left">
    <span class="grade">B</span>
    <div>
      <div style="display:flex;align-items:baseline;gap:8px"><span class="t-display num">84</span><span class="muted t-small">of 100</span></div>
      <div class="stars" aria-label="2 of 3 stars">${P.star(true)}${P.star(true)}${P.star(false)}</div>
      <p style="margin:6px 0 0;font-weight:500">Solid. A few slips.</p>
    </div>
  </div>
  <div class="g-right">
    <span class="badge ranked">Ranked</span>
    <p class="t-h3 num" style="margin:12px 0 2px">+12 XP</p>
    <p class="t-small muted" style="margin:0 0 8px">Student · 81% to Section player</p>
    <div class="xpbar" style="width:220px"><i style="width:81%"></i></div>
  </div>
</section>`;
}
function scoreToolbar() {
  return `<div class="score-tools">
  <div class="seg" role="radiogroup" aria-label="Show"><button class="seg-btn is-on" style="min-height:36px">My take</button><button class="seg-btn" style="min-height:36px">Clean score</button></div>
  <span class="nav-slips"><button class="btn btn-secondary btn-compact">${icon('chevL', 'sm')}Previous slip</button><button class="btn btn-secondary btn-compact">Next slip${icon('chevR', 'sm')}</button></span>
  <span style="flex:1"></span>
  <span class="switch"><span class="switch-track"></span>Slower</span>
  <button class="btn btn-primary btn-compact">${icon('listen', 'sm')}Listen</button>
</div>`;
}
const RES_CSS = `<style>
.res { max-width: 1240px; margin: 0 auto; padding: 28px 40px 56px; }
.grade-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 24px; }
.g-left { display: flex; align-items: flex-end; gap: 24px; }
.g-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; }
.score-card { padding: 18px; }
.score-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.nav-slips { display: inline-flex; gap: 8px; }
.res-cols { display: grid; grid-template-columns: 7fr 5fr; gap: 20px; margin-top: 20px; align-items: start; }
.tip-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.tip-ic { width: 40px; height: 40px; border-radius: 12px; background: var(--brass-wash); color: var(--brass-ink); display: grid; place-items: center; }
.tip-text { font-size: 17px; line-height: 1.55; margin: 0; }
.more-tips { margin-top: 14px; }
.tip2 { margin-top: 10px; padding: 16px; border-radius: 14px; background: var(--bg); }
.res-actions { display: flex; gap: 10px; margin-top: 24px; }
@media (max-width: 700px) {
  .res { padding: 18px 14px 40px; }
  .grade-head { flex-direction: column; align-items: stretch; gap: 14px; }
  .g-left { gap: 16px; align-items: center; }
  .g-right { text-align: left; align-items: flex-start; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  .g-right p { margin: 0 !important; }
  .g-right .xpbar { width: 100% !important; }
  .res-cols { grid-template-columns: 1fr; }
  .score-card { padding: 12px; }
  .score-tools { gap: 8px; }
  .score-tools .seg { width: 100%; } .score-tools .seg .seg-btn { flex: 1; }
  .nav-slips .btn { padding: 0 10px; }
  .res-actions { flex-direction: column; }
  .res-actions .btn { width: 100%; height: 52px; }
  .t-display { font-size: 40px; }
}
</style>`;
function results() {
  const d = P.score({ width: 1100, sp: 12.5, perSystem: 4, marks: P.reviewMarks(), ghostStyle: 'review', systemGap: 12 });
  const p = P.score({ width: 330, sp: 8, perSystem: 2, marks: P.reviewMarks(), ghostStyle: 'review', systemGap: 2, topPad: 3.4 * 8, bottomPad: 0.5 * 8 });
  const body = `${loopbar({ right: '' })}
<main class="res">
  ${gradeHeader()}
  <section class="card score-card">
    ${scoreToolbar()}
    <div class="paper" style="padding:28px 32px 18px;box-shadow:none;border:1px solid var(--border)"><div class="only-desktop">${d.svg}</div><div class="only-phone">${p.svg}</div></div>
  </section>
  <div class="res-cols">${tipCard()}${components()}</div>
  <div class="res-actions"><button class="btn btn-primary btn-hero">Next excerpt${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero">Try again (practice)</button><button class="btn btn-quiet btn-hero">Change setup</button></div>
  <p class="t-caption muted" style="margin:28px 0 0">Melody in G major, composed for Sightread practice · bars 1 to 8 · CC0</p>
</main>`;
  return P.page({ title: 'Results', body: RES_CSS + body });
}
function tips() {
  const body = `${loopbar({ right: '' })}
<main class="res" style="max-width:860px">
  <p class="t-small muted" style="margin:0 0 14px">Results, below the score</p>
  ${tipCard({ expanded: true })}
  <div style="height:20px"></div>
  ${components()}
  <div class="res-actions"><button class="btn btn-primary btn-hero">Next excerpt${icon('arrowR', 'sm')}</button><button class="btn btn-secondary btn-hero">Try again (practice)</button><button class="btn btn-quiet btn-hero">Change setup</button></div>
</main>`;
  return P.page({ title: 'One thing to try (tips in results)', body: RES_CSS + body });
}

// ---------------------------------------------------------------- Calibration
function calibration() {
  const states = ['heard', 'heard', 'heard', 'missed', 'heard', 'heard', 'now', '', '', ''];
  const marks = states.map((s, i) => `<span class="cal-mark ${s}" role="img" aria-label="Click ${i + 1} of 10: ${s === 'heard' ? 'heard' : s === 'missed' ? 'missed' : 'waiting'}"></span>`).join('');
  const card = `<section class="card cal-card">
  <p class="t-small" style="margin:0;font-size:16px">Your speakers and mic add a small delay. We'll measure it so “late” really means late.</p>
  <div class="cal-sel">
    <label><span class="t-label">Input device</span><span class="select">MacBook Pro Microphone ${icon('chevD', 'sm')}</span></label>
    <label><span class="t-label">Output</span><span class="select">Speakers ${icon('chevD', 'sm')}</span></label>
  </div>
  <div class="cal-stage">
    <p class="t-label" style="margin:0 0 4px">Listening…</p>
    <p class="t-small muted" style="margin:0 0 22px">Stay quiet for about 6 seconds while we time the clicks.</p>
    <div class="cal-marks">${marks}</div>
    <p class="cal-count num"><b>5</b> of 10 heard</p>
  </div>
  <div class="cal-foot">
    <button class="btn btn-tonal">${icon('metronome', 'sm')}Hear the click</button>
    <span style="flex:1"></span>
    <button class="btn btn-quiet">Skip</button>
  </div>
  <p class="t-caption muted" style="margin:10px 0 0;text-align:right">Without calibration, takes on this device are practice only. You can calibrate later from Practice or Settings.</p>
</section>`;
  const body = `${P.appbar('practice')}
<main class="page" style="max-width:720px">
  <h1 class="t-title" style="margin-bottom:6px">Calibrate</h1>
  <p class="t-small muted" style="margin:0 0 24px">About 20 seconds. Using the Classic metronome sound.</p>
  ${card}
</main>
<style>
.cal-card { padding: 32px; }
.cal-sel { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 22px; }
.cal-sel label { display: grid; gap: 8px; }
.cal-stage { margin-top: 26px; padding: 28px; border-radius: 18px; background: var(--bg); }
.cal-count { margin: 22px 0 0; font-size: 17px; }
.cal-foot { display: flex; align-items: center; gap: 8px; margin-top: 24px; }
@media (max-width: 700px) { .cal-card { padding: 20px; } .cal-sel { grid-template-columns: 1fr; } .cal-stage { padding: 20px; } .cal-marks { gap: 10px; } .cal-mark { width: 24px; height: 24px; } .cal-mark.now { box-shadow: 0 0 0 4px var(--brass-wash); } }
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
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="M2 ${H / 2} H${W - 2}" stroke="var(--border)" stroke-width="1"/><path d="${d}" fill="var(--text)" fill-opacity="0.85" stroke="var(--text)" stroke-width="0.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function settings() {
  const opt = (id, name, hint, on) => `<div class="mopt ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}">
  <span class="radio">${on ? '<i></i>' : ''}</span>
  <div class="mtext"><p class="t-label" style="margin:0">${name}</p><p class="t-small muted" style="margin:2px 0 0">${hint}</p></div>
  <span class="mwave only-desktop">${wave(id)}</span>
  <button class="btn btn-tonal btn-compact" aria-label="Play a bar of ${name}">${icon('play', 'sm')}<span class="only-desktop">Play a bar</span></button>
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
        <div class="row-head"><p class="t-label">Metronome sound</p></div>
        <div role="radiogroup" aria-label="Metronome sound" class="mopts">
          ${opt('classic', 'Classic', 'A mechanical metronome: a firm, woody click.', true)}
          ${opt('woodblock', 'Woodblock', 'Rounder and softer.', false)}
          ${opt('beep', 'Beep', 'A short electronic beep. Cuts through in a loud room.', false)}
        </div>
      </div>
      <div class="row"><div class="row-head" style="margin:0"><div><p class="t-label">Accent the first beat</p><p class="t-small muted" style="margin:2px 0 0">Beat one is higher and a little louder.</p></div><span class="switch is-on"><span class="switch-track"></span></span></div></div>
      <div class="row"><p class="t-label" style="margin-bottom:12px">Click volume</p><div style="display:flex;align-items:center;gap:14px">${icon('speaker', 'sm')}<div class="slider"><div class="trk"></div><div class="fill" style="width:70%"></div><div class="thumb" style="left:70%"></div></div><span class="num t-small" style="width:40px;text-align:right">70%</span></div></div>
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
.mopt { display: flex; align-items: center; gap: 14px; padding: 14px 14px 14px 16px; border-radius: 16px; border: 1px solid var(--border); }
.mopt.is-on { background: var(--selected); border-color: var(--text); box-shadow: 0 0 0 1px var(--text) inset; }
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
