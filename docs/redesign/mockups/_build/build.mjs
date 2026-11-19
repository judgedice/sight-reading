// Builds the static mockups in docs/redesign/mockups/*.html. Run: node docs/redesign/mockups/_build/build.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './parts.mjs';
import { screens2 } from './screens2.mjs';
import { screens3 } from './screens3.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { icon } = P;

// ---------------------------------------------------------------- Home and setup
function home() {
  // Desktop: both cards fill the viewport height. The right card's rows scroll; its foot (Mode, XP line, Start)
  // is pinned outside the scroll area, so Start and Mode are always in view and no row ever sits under them (C1, C2).
  const desktop = `<div class="only-desktop">
${P.appbar('practice')}
<main class="page home-page">
  <div class="page-head">
    <h1 class="t-title">Practice</h1>
    <div class="today-inline">
      <span class="nb">${icon('flame', 'sm')} Streak 6 days</span><span class="dot">·</span><span class="nb">9 takes</span><span class="dot">·</span><span class="nb">214 XP today</span>
    </div>
  </div>
  <div class="home-grid">
    <section class="card inst-card" aria-label="Instrument">
      <div class="inst-head">
        <div class="inst-badge"><span class="music">${P.clefGlyph.bass}</span></div>
        <div style="flex:1">
          <h2 class="t-h2 nb">Baritone voice</h2>
          <p class="t-small muted" style="margin:2px 0 0">Voice · bass clef</p>
        </div>
        <button class="btn btn-secondary btn-compact">Change instrument</button>
      </div>
      <hr class="divider" style="margin:20px 0">
      <div class="row-head" style="margin-bottom:0"><p class="t-label">Your range</p><span class="t-caption muted">Tap a note to hear it</span></div>
      ${P.rangeFigure({ width: 420, sp: 12 })}
      <hr class="divider" style="margin:20px 0">
      <div class="rank-line">
        <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="none" stroke="var(--text)" stroke-width="1.5"/><circle cx="20" cy="20" r="11" fill="none" stroke="var(--text)" stroke-width="1.5"/><circle cx="20" cy="20" r="5" fill="var(--brass)"/></svg>
        <div style="flex:1">
          <div class="t-small"><b>Student</b> <span class="muted">· 79% to Section player</span></div>
          <div class="xpbar" style="margin-top:8px"><i style="width:79%"></i></div>
        </div>
      </div>
    </section>

    <section class="card setup-card" aria-label="Setup">
      <div class="setup-scroll">
        <div class="row">${P.difficultyRow()}</div>
        <div class="row">
          <div class="row-head"><p class="t-label">Key</p></div>
          ${P.keyChips({ selected: 'G major' })}
        </div>
        <div class="row">
          <div class="row-head"><p class="t-label">Time</p></div>
          ${P.timeSeg('4/4')}
        </div>
        <div class="row">
          <div class="row-head"><p class="t-label">Tempo</p><span class="switch is-on"><span class="switch-track"></span>Any tempo in range <span class="tag">+8% XP</span></span></div>
          <p class="t-small" style="margin:0">Any tempo from <b class="num">60</b> to <b class="num">84</b> <span class="muted">beats a minute</span></p>
        </div>
        <div class="row">
          <div class="row-head" style="margin-bottom:4px"><p class="t-label">Length</p></div>
          <p class="t-small" style="margin:0">8 bars <span class="muted">(the only length at difficulty 2)</span></p>
        </div>
      </div>
      <div class="setup-foot">
        <div class="mode-line">
          <p class="t-label" style="margin:0;flex:none">Mode</p>
          <div class="seg" role="radiogroup" aria-label="Mode" style="flex:1;display:flex"><button class="seg-btn is-on" style="flex:1">Ranked</button><button class="seg-btn" style="flex:1">Practice</button></div>
        </div>
        <p class="hint" style="margin:8px 0 14px 58px">Full XP. Fresh music and timed reading.</p>
        <div class="start-line">
          <p class="t-small muted nb" style="margin:0">Choosing Any: <b style="color:var(--text)">+8% XP</b></p>
          <button class="btn btn-primary btn-hero" style="flex:1">Start <span class="kbd">Space</span></button>
        </div>
      </div>
    </section>
  </div>
</main>
</div>`;

  const chev = `<span class="schev">${icon('chevD', 'sm')}</span>`;
  const sc = (k, v) => `<button class="schip" aria-label="${k}: ${v}. Change"><span><span class="k">${k}</span>${v}</span>${chev}</button>`;
  const phone = `<div class="only-phone">
${P.appbar('practice')}
<main class="page" style="padding-bottom:180px">
  <div class="today-strip">
    <span class="nb">${icon('flame', 'sm')} 6 days</span><span class="dot">·</span><span class="nb">9 takes</span><span class="dot">·</span><span class="nb">214 XP today</span>
  </div>
  <h1 class="t-title" style="margin:18px 0 16px">Practice</h1>
  <section class="card summary-card">
    <button class="sum-inst">
      <span class="inst-badge" style="width:44px;height:44px;border-radius:12px"><span class="music" style="font-size:26px">${P.clefGlyph.bass}</span></span>
      <span style="flex:1;text-align:left">
        <span class="t-h3" style="display:block">Baritone voice</span>
        <span class="t-caption muted" style="display:flex;align-items:center;gap:8px;margin-top:4px">${P.rulerBar({ full: [43, 67], served: [48, 60], width: 88, height: 16, ticks: true })} G2 to G4</span>
      </span>
      ${icon('chevR')}
    </button>
    <div class="sum-chips">
      ${sc('Difficulty', '2')}${sc('Key', 'G major')}${sc('Time', '4/4')}${sc('Tempo', 'Any')}${sc('Length', '8 bars')}
    </div>
    <p class="first-hint">${icon('info', 'sm')} Tap any setting to change it.</p>
  </section>
  <div style="margin-top:20px">
    <p class="t-label" style="margin-bottom:10px">Mode</p>
    <div class="seg full"><button class="seg-btn is-on">Ranked</button><button class="seg-btn">Practice</button></div>
    <p class="hint">Full XP. Fresh music and timed reading.</p>
  </div>
  <section class="card card-pad" style="margin-top:20px;padding:16px 18px">
    <div class="rank-line">
      <svg width="32" height="32" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="none" stroke="var(--text)" stroke-width="1.8"/><circle cx="20" cy="20" r="11" fill="none" stroke="var(--text)" stroke-width="1.8"/><circle cx="20" cy="20" r="5" fill="var(--brass)"/></svg>
      <div style="flex:1"><div class="t-small"><b>Student</b> <span class="muted">· 79% to Section player</span></div><div class="xpbar" style="margin-top:8px"><i style="width:79%"></i></div></div>
    </div>
  </section>
</main>
<div class="start-dock only-phone">
  <p class="t-caption muted" style="margin:0 0 8px;text-align:center">Choosing Any: <b style="color:var(--text)">+8% XP</b></p>
  <button class="btn btn-primary btn-hero btn-block">Start</button>
</div>
${P.tabbar('practice')}
</div>`;

  const css = `<style>
.home-page { padding-top: 24px; padding-bottom: 24px; }
.home-page .page-head { margin-bottom: 18px; align-items: center; }
.home-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 28px; height: calc(100vh - 64px - 24px - 58px - 24px); min-height: 560px; }
.inst-card { padding: 24px 28px; overflow: auto; }
.setup-card { display: flex; flex-direction: column; overflow: hidden; }
.setup-scroll { flex: 1; overflow: auto; padding: 24px 28px 8px; }
.setup-scroll .row:first-child { padding-top: 0; border-top: 0; }
.setup-foot { flex: none; border-top: 1px solid var(--border); padding: 16px 28px 20px; background: var(--surface); box-shadow: 0 -12px 24px -16px rgba(0,0,0,0.18); }
.mode-line { display: flex; align-items: center; gap: 16px; }
.start-line { display: flex; align-items: center; gap: 20px; }
.today-inline { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 14.5px; font-weight: 500; }
.today-inline .icon { vertical-align: -3px; color: var(--brass); }
.dot { color: var(--border-strong); }
.rank-line { display: flex; align-items: center; gap: 14px; }
.today-strip { display: flex; flex-wrap: wrap; gap: 6px; color: var(--text-muted); font-size: 13.5px; font-weight: 500; }
.today-strip .icon { vertical-align: -3px; color: var(--brass); }
.summary-card { padding: 6px; }
.sum-inst { display: flex; align-items: center; gap: 14px; width: 100%; border: 0; background: transparent; padding: 12px; border-radius: 14px; }
.sum-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 12px 12px; }
.schip { height: 52px; padding: 0 10px 0 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2); display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; line-height: 1.2; text-align: left; }
.schip > span:first-child { display: flex; flex-direction: column; }
.schip .k { font-size: 11.5px; font-weight: 500; color: var(--text-muted); }
.schev { color: var(--text-muted); display: grid; }
.first-hint { margin: 0 12px 10px; padding: 10px 12px; border-radius: 10px; background: var(--brass-wash); color: var(--text); font-size: 13.5px; display: flex; gap: 8px; align-items: center; }
.first-hint .icon { color: var(--brass-ink); }
.start-dock { position: fixed; left: 0; right: 0; bottom: 76px; padding: 12px 16px 12px; background: linear-gradient(to top, var(--bg) 70%, color-mix(in srgb, var(--bg) 0%, transparent)); z-index: 9; }
</style>`;
  return P.page({ title: 'Practice: home and setup', body: css + desktop + phone });
}

const files = { 'home.html': home(), ...screens2(), ...screens3() };
for (const [name, html] of Object.entries(files)) writeFileSync(join(OUT, name), html);
console.log('wrote', Object.keys(files).join(', '));
