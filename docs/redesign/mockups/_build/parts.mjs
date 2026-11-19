// Shared data and fragments for the mockups.
import { engrave, rangePicture, miniKey, timeSigGlyph, rulerBar, keyboard, midiName } from './engrave.mjs';
import { icon, wordmark } from './icons.mjs';

export const BARI = { id: 'voice-baritone', name: 'Baritone voice', short: 'Baritone', clef: 'bass', full: [43, 67], served: [48, 60] };

// G major, 4/4, eight bars, inside C3 to C4 (difficulty 2, tier A for baritone).
export const EXCERPT = [
  [{ p: 'G3', d: 'q' }, { p: 'B3', d: 'q' }, { p: 'A3', d: 'q' }, { p: 'G3', d: 'q' }],
  [{ p: 'A3', d: 'e' }, { p: 'G3', d: 'e' }, { p: 'F#3', d: 'q' }, { p: 'E3', d: 'q' }, { p: 'D3', d: 'q' }],
  [{ p: 'G3', d: 'q' }, { p: 'A3', d: 'q' }, { p: 'B3', d: 'h' }],
  [{ p: 'C4', d: 'q' }, { p: 'B3', d: 'e' }, { p: 'A3', d: 'e' }, { p: 'G3', d: 'h' }],
  [{ p: 'E3', d: 'q' }, { p: 'F#3', d: 'q' }, { p: 'G3', d: 'q' }, { p: 'A3', d: 'q' }],
  [{ p: 'B3', d: 'q' }, { p: 'A3', d: 'e' }, { p: 'G3', d: 'e' }, { p: 'F#3', d: 'h' }],
  [{ p: 'E3', d: 'q' }, { p: 'G3', d: 'q' }, { p: 'F#3', d: 'q' }, { p: 'A3', d: 'q' }],
  [{ p: 'G3', d: 'w' }],
];
// The key signature already carries F sharp; strip the written accidental.
for (const bar of EXCERPT) for (const n of bar) if (n.p === 'F#3') n.keyAcc = true;

export const KEY = { type: '#', count: 1 };

export function score(o) {
  return engrave({ clef: 'bass', key: KEY, time: [4, 4], bars: EXCERPT, barNumbers: true, ...o });
}

// Live marks during the take, playhead in bar 5 (two notes played).
export function liveMarks(past = 0.7) {
  const m = {};
  const played = ['b1n1', 'b1n2', 'b1n3', 'b1n4', 'b2n1', 'b2n2', 'b2n3', 'b2n4', 'b2n5', 'b3n1', 'b3n2', 'b3n3', 'b4n1', 'b4n2', 'b4n3', 'b4n4', 'b5n1', 'b5n2'];
  for (const id of played) m[id] = { lane: 'dot', past: +id[1] < 4 ? past : undefined };
  m.b1n3 = { state: 'error', lane: 'sharp', ghost: { p: 'A3', dx: 1.1, arrow: 'up' }, past };
  m.b2n3 = { state: 'error', lane: 'wrong', ghost: { p: 'F3', dx: 0.85, acc: 'n' }, past };
  m.b3n3 = { state: 'error', lane: 'late', ghost: { p: 'B3', dx: 1.7 }, past };
  m.b4n3 = { state: 'missed', lane: 'missed' };
  return m;
}
export function reviewMarks() {
  const m = {};
  m.b1n3 = { state: 'error', lane: 'sharp', ghost: { p: 'A3', dx: 1.1, arrow: 'up' } };
  m.b2n3 = { state: 'error', lane: 'wrong', ghost: { p: 'F3', dx: 0.85, acc: 'n' } };
  m.b3n3 = { state: 'error', lane: 'late', ghost: { p: 'B3', dx: 1.6 } };
  m.b4n3 = { state: 'missed', lane: 'missed' };
  m.b6n4 = { state: 'error', lane: 'wrong', ghost: { p: 'F3', dx: 0.85, acc: 'n' } };
  return m;
}

export function page({ title, body, cls = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="mockup.css">
<script>if (/dark/.test(location.search)) document.documentElement.dataset.theme = 'dark';</script>
</head>
<body class="${cls}">
${body}
</body>
</html>
`;
}

export function appbar(active = 'practice') {
  const t = (id, label) => `<a class="tab ${active === id ? 'is-on' : ''}">${label}</a>`;
  return `<header class="appbar">
  <div class="wordmark">${wordmark(24)}<span>Sightread</span></div>
  <nav class="tabs">${t('practice', 'Practice')}${t('progress', 'Progress')}${t('history', 'History')}</nav>
  <button class="icon-btn only-desktop" aria-label="Settings">${icon('settings')}</button>
  <button class="icon-btn only-phone" style="margin-left:auto" aria-label="Settings">${icon('settings')}</button>
</header>`;
}
export function tabbar(active = 'practice') {
  const t = (id, ic, label) => `<a class="${active === id ? 'is-on' : ''}">${icon(ic, 'lg')}<span>${label}</span></a>`;
  return `<nav class="tabbar only-phone">${t('practice', 'practice', 'Practice')}${t('progress', 'progress', 'Progress')}${t('history', 'history', 'History')}</nav>`;
}

export const clefGlyph = { bass: '', treble: '', 'treble-8vb': '' };

export function rangeFigure({ inst = BARI, width = 400, sp = 10, kb = true, compact = false, level = 2 }) {
  const rp = rangePicture({ clef: inst.clef, full: inst.full, served: inst.served, width, sp });
  const labels = rp.labels.map((l) => `<button class="note-btn ${l.kind}" style="left:${((l.x / width) * 100).toFixed(2)}%" aria-label="Hear ${l.name}">${icon('play')}${l.name}</button>`).join('');
  return `<figure class="range-figure">
  <div class="range-stage">${rp.svg}<div class="range-labels">${labels}</div></div>
  ${kb ? keyboard({ loM: 36, hiM: 72, full: inst.full, served: inst.served, width: 400, height: compact ? 34 : 40 }) : ''}
  <figcaption class="range-legend">
    <div><span class="sw full"></span><span>Full range: <b>${midiName(inst.full[0])} to ${midiName(inst.full[1])}</b></span></div>
    <div><span class="sw served"></span><span>At difficulty ${level}: <b>${midiName(inst.served[0])} to ${midiName(inst.served[1])}</b></span></div>
    ${inst.clef && inst.id.startsWith('voice') ? `<div class="muted" style="padding-left:28px">Sing in any octave that suits you. Pitch is marked relative to your starting note.</div>` : ''}
  </figcaption>
</figure>`;
}

export function keyChips({ clef = 'bass', selected = 'G major', cols } = {}) {
  const chip = (name, key) => {
    const on = selected === name;
    return `<button class="chip ${on ? 'is-on' : ''}" role="radio" aria-checked="${on}">${miniKey({ clef, key, sp: 6.2, width: 78 })}<span class="name">${name}</span>${on ? `<span class="check">${icon('check')}</span>` : ''}</button>`;
  };
  const anyOn = selected === 'Any key';
  return `<div class="chip-grid" role="radiogroup" aria-label="Key" style="grid-template-columns:repeat(${cols || 3},minmax(0,1fr))">
  <button class="chip chip-any ${anyOn ? 'is-on' : ''}" role="radio" aria-checked="${anyOn}"><span class="name">Any key</span><span class="t-caption muted">Up to 1 sharp or flat</span><span class="tag">+8% XP</span>${anyOn ? `<span class="check">${icon('check')}</span>` : ''}</button>
  <p class="chip-group-label">Major</p>
  ${chip('C major', { count: 0 })}${chip('G major', { type: '#', count: 1 })}${chip('F major', { type: 'b', count: 1 })}
  <p class="chip-group-label">Minor</p>
  ${chip('A minor', { count: 0 })}${chip('E minor', { type: '#', count: 1 })}${chip('D minor', { type: 'b', count: 1 })}
</div>
<p class="note-line">${icon('info')}<span>More keys from difficulty 3.</span></p>`;
}

export function timeSeg(selected = '4/4') {
  const b = (v, inner, sub = '') => `<button class="seg-btn ${selected === v ? 'is-on' : ''}" role="radio" aria-checked="${selected === v}">${inner}${sub}</button>`;
  return `<div class="seg seg-time" role="radiogroup" aria-label="Time">
  ${b('any', '<span>Any</span>', '<span class="tag" style="margin-top:4px">+8% XP</span>')}
  ${b('4/4', timeSigGlyph(4, 4, 7.5))}
  ${b('3/4', timeSigGlyph(3, 4, 7.5), '<span class="sub">few pieces</span>')}
</div>
<p class="note-line">${icon('info')}<span>No 2/4 music for Baritone voice at difficulty 2 yet.</span></p>`;
}

export function difficultyRow({ level = 2 } = {}) {
  const segs = Array.from({ length: 10 }, (_, i) => `<i class="${i < level ? 'on' : i === 6 || i === 7 ? 'none' : ''}"></i>`).join('');
  return `<div class="row-head"><p class="t-label">Difficulty</p><span class="switch"><span class="switch-track"></span>Follow my progress</span></div>
  <div class="diff-line">
    <div class="stepper"><button aria-label="Easier">${icon('minus')}</button><div class="val num">${level}&nbsp;<small>of 10</small></div><button aria-label="Harder">${icon('plus')}</button></div>
    <div class="meter10" aria-hidden="true">${segs}</div>
  </div>
  <p class="hint" style="color:var(--text)">Adds eighths, minor keys and one-beat pickups.</p>
  <p class="hint" style="margin-top:4px">At difficulty ${level}: C3 to C4</p>
  <p class="note-line">${icon('info')}<span>No music yet for Baritone voice at difficulty 7 to 8.</span></p>`;
}

export function star(filled) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3L2.9 9.4l6.4-.7z" fill="${filled ? 'var(--brass)' : 'none'}" stroke="${filled ? 'var(--brass)' : 'var(--border-strong)'}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

export function ring(frac, size = 26) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="3"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--brass)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

export { engrave, rangePicture, miniKey, timeSigGlyph, rulerBar, keyboard, midiName, icon, wordmark };
