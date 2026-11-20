// Minimal engraver for the mockups: emits SVG with Bravura glyphs (SMuFL code points).
// Colours come from CSS custom properties, so one SVG serves light and dark.
// Not production code: the app engraves with VexFlow. This only has to look right.

const LETTERS = 'CDEFGAB';
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function parsePitch(p) {
  const m = /^([A-G])(#|b|n)?(-?\d)$/.exec(p);
  if (!m) throw new Error('bad pitch ' + p);
  const [, L, acc, o] = m;
  const oct = +o;
  return { L, acc: acc || '', oct, dn: LETTERS.indexOf(L) + 7 * oct, midi: 12 * (oct + 1) + SEMI[L] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) };
}
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const NAMES_P = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const midiName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
export const midiPitch = (m) => NAMES_P[m % 12] + (Math.floor(m / 12) - 1);

export const CLEF = {
  treble: { ref: 30, glyph: '', step: 2 },
  bass: { ref: 18, glyph: '', step: 6 },
  'treble-8vb': { ref: 23, glyph: '', step: 2 },
};
const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4];
const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];
export function keySteps(clef, key) {
  const off = clef === 'bass' ? -2 : 0;
  if (!key || !key.count) return [];
  const arr = key.type === '#' ? SHARP_STEPS : FLAT_STEPS;
  return arr.slice(0, key.count).map((s) => s + off);
}
const G = {
  black: '', half: '', whole: '', sharp: '', flat: '', natural: '',
  flagUp: '', flagDown: '', dot: '', restQ: '', restH: '', restW: '', restE: '',
  ts: (n) => String(n).split('').map((d) => String.fromCodePoint(0xe080 + +d)).join(''),
};
const HEAD_W = { black: 1.18, half: 1.18, whole: 1.69 };
const f = (n) => Math.round(n * 100) / 100;
const txt = (x, y, sp, g, attrs = '') => `<text x="${f(x)}" y="${f(y)}" font-size="${f(sp * 4)}" ${attrs}>${g}</text>`;

const WEIGHT = { e: 1, q: 1.45, h: 2.1, w: 2.9 };
function noteWeight(n) {
  let w = WEIGHT[n.d] || 1.4;
  if (n.dot) w *= 1.25;
  return w;
}

/**
 * opts: { clef, key:{type,count}, time:[4,4], bars:[[{p,d,dot?,id?}|{r,d}]], perSystem, width, sp,
 *         marginX, systemGap, marks: { [id]: {...} }, playheadBar, highlightKey, firstNoteHighlight, ghostStyle:'live'|'review',
 *         barNumbers:true, showLane:true, selectedBar }
 * Returns { svg, height }
 */
export function engrave(o) {
  const sp = o.sp;
  const clef = CLEF[o.clef];
  const ks = keySteps(o.clef, o.key);
  const marginX = o.marginX ?? 0;
  const lane = o.showLane === false ? 0 : 3.2 * sp;
  const top = o.topPad ?? 4 * sp;
  const sysH = 4 * sp + top + lane + (o.bottomPad ?? 3 * sp);
  const systems = [];
  for (let i = 0; i < o.bars.length; i += o.perSystem) systems.push(o.bars.slice(i, i + o.perSystem));
  const height = systems.length * sysH + (systems.length - 1) * (o.systemGap ?? 0);
  const parts = [];
  const over = [];
  const under = [];
  const ink = 'var(--ink)';
  let barIndex = 0;
  const noteList = [];
  systems.forEach((bars, si) => {
    const y0 = si * (sysH + (o.systemGap ?? 0)) + top; // top staff line
    const sysOp = o.systemOpacity ? o.systemOpacity[si] ?? o.systemOpacity[o.systemOpacity.length - 1] : 1;
    if (sysOp !== 1) parts.push(`<g opacity="${sysOp}">`);
    const yb = y0 + 4 * sp; // bottom line
    const yOf = (step) => yb - (step * sp) / 2;
    const x0 = marginX;
    const x1 = o.width - marginX;
    // staff
    const lines = [];
    for (let l = 0; l < 5; l++) lines.push(`<line x1="${f(x0)}" x2="${f(x1)}" y1="${f(y0 + l * sp)}" y2="${f(y0 + l * sp)}"/>`);
    parts.push(`<g class="staff" stroke="var(--staff-line)" stroke-width="${f(Math.max(1, sp * 0.09))}">${lines.join('')}</g>`);
    let x = x0 + 0.7 * sp;
    const clefG = `<g class="clef">${txt(x, yOf(clef.step), sp, clef.glyph)}</g>`;
    x += 3.4 * sp;
    const ksX = x;
    const ksParts = ks.map((s, i) => txt(x + i * 1.05 * sp, yOf(s), sp, o.key.type === '#' ? G.sharp : G.flat));
    x += ks.length ? ks.length * 1.05 * sp + 0.8 * sp : 0.2 * sp;
    if (o.highlightKey && ks.length && !(o.hlFirstOnly && si > 0)) {
      under.push(`<rect class="hl" x="${f(ksX - 0.5 * sp)}" y="${f(y0 - 1.6 * sp)}" width="${f(ks.length * 1.05 * sp + 0.9 * sp)}" height="${f(7.2 * sp)}" rx="${f(0.6 * sp)}" fill="var(--brass)" fill-opacity="0.16"/>`);
    }
    parts.push(`<g class="keysig" ${o.highlightKey && !(o.hlFirstOnly && si > 0) ? 'fill="var(--brass-ink)"' : ''}>${ksParts.join('')}</g>`);
    parts.push(clefG);
    if (si === 0 && o.time) {
      parts.push(`<g class="timesig">${txt(x, yOf(6), sp, G.ts(o.time[0]))}${txt(x, yOf(2), sp, G.ts(o.time[1]))}</g>`);
      x += 2.6 * sp;
    }
    const usable = x1 - x;
    const weights = bars.map((b) => b.reduce((a, n) => a + noteWeight(n), 0) + 1.6);
    const total = weights.reduce((a, b) => a + b, 0);
    let bx = x;
    bars.forEach((bar, bi) => {
      const bw = (weights[bi] / total) * usable;
      const unit = bw / weights[bi];
      const barNo = barIndex + 1;
      if (o.playheadBar === barNo) {
        under.push(`<rect class="playhead" x="${f(bx + 0.15 * sp)}" y="${f(y0 - 1.8 * sp)}" width="${f(bw - 0.3 * sp)}" height="${f(4 * sp + 3.6 * sp + lane * 0.7)}" rx="${f(0.5 * sp)}" fill="var(--playhead)"/>`);
      }
      if (o.selectedBar === barNo) {
        under.push(`<rect class="selbar" x="${f(bx + 0.15 * sp)}" y="${f(y0 - 1.8 * sp)}" width="${f(bw - 0.3 * sp)}" height="${f(4 * sp + 3.6 * sp + lane * 0.7)}" rx="${f(0.5 * sp)}" fill="var(--playhead)"/>`);
      }
      if (o.dimBefore && barNo < o.dimBefore) {
        // nothing: past marks are drawn at reduced opacity by marks themselves
      }
      if (o.barNumbers && bi === 0 && si > 0) {
        parts.push(`<text class="barno" x="${f(bx - 0.1 * sp)}" y="${f(y0 - 1.0 * sp)}" font-size="${f(Math.max(10, sp * 0.95))}" fill="var(--staff-line)" font-family="var(--font-text)" font-style="italic">${barNo}</text>`);
      }
      let nx = bx + 1.1 * sp;
      const placed = [];
      bar.forEach((n, ni) => {
        const w = noteWeight(n) * unit;
        placed.push({ n, x: nx, ni });
        nx += w;
      });
      // beams: consecutive eighths in pairs
      const beamGroups = [];
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i];
        const b = placed[i + 1];
        if (a.n.d === 'e' && !a.n.r && b && b.n.d === 'e' && !b.n.r && a.n.beam !== false) {
          beamGroups.push([a, b]);
          a.beamed = b.beamed = true;
          i++;
        }
      }
      for (const pn of placed) {
        const n = pn.n;
        const id = n.id || `b${barNo}n${pn.ni + 1}`;
        const m = (o.marks && o.marks[id]) || {};
        if (n.r) {
          const rg = { q: G.restQ, h: G.restH, w: G.restW, e: G.restE }[n.d];
          const ry = n.d === 'w' ? yOf(6) : n.d === 'h' ? yOf(4) : yOf(4);
          parts.push(`<g class="rest">${txt(pn.x, ry, sp, rg)}</g>`);
          // Round 2: an extra heard in a rest. Ghost head at the heard pitch, and a "+" in the lane.
          const xm = (o.marks && o.marks[n.id || `b${barNo}n${pn.ni + 1}`]) || {};
          if (xm.extra) {
            const XP = parsePitch(xm.extra.p);
            const xs = XP.dn - clef.ref;
            const gx2 = pn.x + (xm.extra.dx ?? 1.6) * sp;
            const xo = xm.extra.opacity ?? 1;
            const ly = yb + 2.2 * sp;
            const gs2 = sp * 0.62;
            over.push(`<g class="extra" opacity="${xo}">${xm.extra.acc ? txt(gx2 - 1.2 * sp, yOf(xs), sp, xm.extra.acc === 'b' ? G.flat : G.sharp, 'fill="var(--ghost)"') : ''}${txt(gx2, yOf(xs), sp, G.black, `fill="var(--ghost)" fill-opacity="0.55" stroke="var(--ghost)" stroke-width="${f(Math.max(1.25, sp * 0.1))}"`)}<path d="M${f(gx2 + 0.6 * sp - gs2)} ${f(ly)} H${f(gx2 + 0.6 * sp + gs2)} M${f(gx2 + 0.6 * sp)} ${f(ly - gs2)} V${f(ly + gs2)}" stroke="var(--ghost)" stroke-width="${f(Math.max(1.75, sp * 0.16))}" stroke-linecap="round"/></g>`);
          }
          continue;
        }
        const P = parsePitch(n.p);
        const step = P.dn - clef.ref;
        const y = yOf(step);
        const head = n.d === 'w' ? 'whole' : n.d === 'h' ? 'half' : 'black';
        const hw = HEAD_W[head] * sp;
        pn.y = y; pn.step = step; pn.hw = hw;
        const up = n.stem ? n.stem === 'up' : step < 4;
        pn.up = up;
        const col = m.state === 'error' || m.state === 'missed' ? 'var(--error)' : m.state === 'hl' ? 'var(--brass-ink)' : m.state === 'hit' ? 'var(--correct)' : m.state === 'dim' ? 'var(--staff-line)' : ink;
        const g = [];
        // ledger lines
        const led = [];
        for (let s = -2; s >= step; s -= 2) led.push(s);
        for (let s = 10; s <= step; s += 2) led.push(s);
        for (const s of led) g.push(`<line x1="${f(pn.x - 0.4 * sp)}" x2="${f(pn.x + hw + 0.4 * sp)}" y1="${f(yOf(s))}" y2="${f(yOf(s))}" stroke="var(--ink)" stroke-width="${f(Math.max(1, sp * 0.13))}"/>`);
        if (n.acc) g.push(txt(pn.x - 1.25 * sp, y, sp, n.acc === '#' ? G.sharp : n.acc === 'b' ? G.flat : G.natural));
        if (m.state === 'missed') {
          g.push(txt(pn.x, y, sp, G[head], `fill="var(--error)"`)); // keep the written head (C38)
          over.push(`<ellipse cx="${f(pn.x + hw / 2)}" cy="${f(y)}" rx="${f(hw * 0.95)}" ry="${f(sp * 0.95)}" fill="none" stroke="var(--error)" stroke-width="${f(Math.max(1.5, sp * 0.14))}"/>`);
        } else {
          // Note-colour proposal: o.headFill(note) colours the notehead only (stem, beam and ledger lines stay ink).
          // A judged note keeps its feedback colour, so a wrong note still turns red.
          const hf = o.headFill && !['error', 'missed', 'hit', 'hl'].includes(m.state) ? o.headFill(n) : null;
          g.push(hf ? txt(pn.x, y, sp, G[head], `fill="${hf}"`) : txt(pn.x, y, sp, G[head]));
        }
        if (n.dot) g.push(txt(pn.x + hw + 0.35 * sp, step % 2 === 0 ? y - sp / 2 : y, sp, G.dot));
        // stem
        if (head !== 'whole') {
          const st = Math.max(1, sp * 0.12);
          let sy1, sy2, sx;
          if (up) { sx = pn.x + hw - st / 2; sy1 = y - 0.15 * sp; sy2 = Math.min(y - 3.5 * sp, yOf(4)); }
          else { sx = pn.x + st / 2; sy1 = y + 0.15 * sp; sy2 = Math.max(y + 3.5 * sp, yOf(4)); }
          pn.sx = sx; pn.sy2 = sy2;
          if (!pn.beamed) {
            g.push(`<line x1="${f(sx)}" x2="${f(sx)}" y1="${f(sy1)}" y2="${f(sy2)}" stroke="currentColor" stroke-width="${f(st)}"/>`);
            if (n.d === 'e') g.push(txt(sx - st / 2, sy2, sp, up ? G.flagUp : G.flagDown));
          } else {
            pn.sy1 = sy1; pn.st = st;
          }
        }
        pn.g = g; pn.col = col; pn.id = id; pn.m = m;
      }
      // beams
      for (const [a, b] of beamGroups) {
        const up = (a.step + b.step) / 2 < 4;
        for (const pn of [a, b]) {
          pn.up = up;
          const st = pn.st;
          pn.sx = up ? pn.x + pn.hw - st / 2 : pn.x + st / 2;
          pn.sy1 = up ? pn.y - 0.15 * sp : pn.y + 0.15 * sp;
        }
        const slope = Math.max(-0.5 * sp, Math.min(0.5 * sp, ((b.y - a.y) / 2)));
        const ext = up ? Math.min(a.y, b.y - slope) - 3.4 * sp : Math.max(a.y, b.y - slope) + 3.4 * sp;
        const ya = ext, yb2 = ext + slope;
        a.sy2 = ya; b.sy2 = yb2;
        const th = 0.5 * sp * (up ? 1 : -1);
        for (const pn of [a, b]) pn.g.push(`<line x1="${f(pn.sx)}" x2="${f(pn.sx)}" y1="${f(pn.sy1)}" y2="${f(pn.sy2)}" stroke="currentColor" stroke-width="${f(pn.st)}"/>`);
        const beamCol = a.col === b.col ? '' : '';
        parts.push(`<polygon class="beam" points="${f(a.sx - a.st / 2)},${f(ya)} ${f(b.sx + b.st / 2)},${f(yb2)} ${f(b.sx + b.st / 2)},${f(yb2 + th)} ${f(a.sx - a.st / 2)},${f(ya + th)}" fill="${a.col === b.col ? a.col : ink}" ${beamCol}/>`);
      }
      for (const pn of placed) {
        if (!pn.g) continue;
        const m = pn.m;
        const cls = ['note'];
        if (m.state) cls.push('is-' + m.state);
        const op = m.past && (m.state === 'error' || m.state === 'missed') ? ` opacity="${m.past}"` : '';
        parts.push(`<g class="${cls.join(' ')}" id="${pn.id}" fill="${pn.col}" color="${pn.col}"${op}>${pn.g.join('')}</g>`);
        const laneY = Math.max(yb + 2.2 * sp, pn.y + 2.2 * sp);
        noteList.push({ id: pn.id, n: pn.n, x: pn.x, hw: pn.hw, y: pn.y, si, yb, barNo });
        const gx = pn.x + pn.hw / 2;
        const gs = sp * 0.62; // glyph half-size
        const mcol = m.state === 'ok' ? 'var(--correct)' : 'var(--error)';
        const lo = m.past ? ` opacity="${m.past}"` : '';
        if (o.showLane !== false && m.lane) {
          const L = m.lane;
          let s = '';
          if (L === 'dot') s = `<circle cx="${f(gx)}" cy="${f(laneY)}" r="${f(Math.max(2, sp * 0.2))}" fill="var(--correct)"/>`;
          if (L === 'check') s = `<path d="M${f(gx - gs)} ${f(laneY)} l${f(gs * 0.7)} ${f(gs * 0.7)} l${f(gs * 1.3)} ${f(-gs * 1.4)}" fill="none" stroke="var(--correct)" stroke-width="${f(Math.max(1.5, sp * 0.16))}" stroke-linecap="round" stroke-linejoin="round"/>`;
          if (L === 'wrong') s = `<path d="M${f(gx - gs)} ${f(laneY - gs)} L${f(gx + gs)} ${f(laneY + gs)} M${f(gx + gs)} ${f(laneY - gs)} L${f(gx - gs)} ${f(laneY + gs)}" stroke="${mcol}" stroke-width="${f(Math.max(1.75, sp * 0.18))}" stroke-linecap="round"/>`;
          if (L === 'late') s = `<path d="M${f(gx - gs * 0.8)} ${f(laneY - gs)} L${f(gx + gs)} ${f(laneY)} L${f(gx - gs * 0.8)} ${f(laneY + gs)} Z" fill="${mcol}"/>`;
          if (L === 'early') s = `<path d="M${f(gx + gs * 0.8)} ${f(laneY - gs)} L${f(gx - gs)} ${f(laneY)} L${f(gx + gs * 0.8)} ${f(laneY + gs)} Z" fill="${mcol}"/>`;
          if (L === 'sharp') s = `<path d="M${f(gx - gs)} ${f(laneY + gs * 0.8)} L${f(gx)} ${f(laneY - gs)} L${f(gx + gs)} ${f(laneY + gs * 0.8)} Z" fill="${mcol}"/>`;
          if (L === 'flat') s = `<path d="M${f(gx - gs)} ${f(laneY - gs * 0.8)} L${f(gx)} ${f(laneY + gs)} L${f(gx + gs)} ${f(laneY - gs * 0.8)} Z" fill="${mcol}"/>`;
          if (L === 'unsure') s = `<circle cx="${f(gx)}" cy="${f(laneY)}" r="${f(Math.max(3, sp * 0.3))}" fill="none" stroke="var(--text-muted)" stroke-width="${f(Math.max(1.25, sp * 0.1))}"/>`;
          if (L === 'missed') s = `<circle cx="${f(gx)}" cy="${f(laneY)}" r="${f(gs * 0.85)}" fill="none" stroke="${mcol}" stroke-width="${f(Math.max(1.75, sp * 0.18))}"/>`;
          over.push(`<g class="lane"${lo}>${s}</g>`);
        }
        if (m.ghost) {
          const gh = m.ghost; // {p, dx (in head widths), acc, arrow}
          const GP = parsePitch(gh.p);
          const gstep = GP.dn - clef.ref;
          const gy = yOf(gstep);
          // A ghost that carries an accidental sits further right, with the accidental between the written
          // note and the ghost, so it never reaches back into the previous note (C37).
          // Such a ghost and its accidental are drawn at cue size (75%), so both fit before the next note
          // without moving the music during a take.
          const cue = gh.acc ? 0.75 : 1;
          const gxp = gh.acc ? pn.x + pn.hw + 0.95 * sp : pn.x + (gh.dx || 0) * pn.hw;
          const gg = [];
          const ghead = o.ghostStyle === 'review' && pn.n.d !== 'q' && pn.n.d !== 'e' ? (pn.n.d === 'w' ? G.whole : G.half) : G.black;
          for (let s = -2; s >= gstep; s -= 2) gg.push(`<line x1="${f(gxp - 0.4 * sp)}" x2="${f(gxp + pn.hw + 0.4 * sp)}" y1="${f(yOf(s))}" y2="${f(yOf(s))}" stroke="var(--ghost)" stroke-dasharray="2 2" stroke-width="1"/>`);
          for (let s = 10; s <= gstep; s += 2) gg.push(`<line x1="${f(gxp - 0.4 * sp)}" x2="${f(gxp + pn.hw + 0.4 * sp)}" y1="${f(yOf(s))}" y2="${f(yOf(s))}" stroke="var(--ghost)" stroke-dasharray="2 2" stroke-width="1"/>`);
          if (gh.acc) gg.push(txt(pn.x + pn.hw + 0.2 * sp, gy, sp * cue, gh.acc === '#' ? G.sharp : gh.acc === 'b' ? G.flat : G.natural, 'fill="var(--ghost)"'));
          gg.push(txt(gxp, gy, sp * cue, ghead, `fill="var(--ghost)" fill-opacity="${o.ghostStyle === 'review' ? 0.55 : 0.4}" stroke="var(--ghost)" stroke-width="${f(Math.max(1.25, sp * 0.1))}"`));
          if (o.ghostStyle === 'review') {
            const st = Math.max(1, sp * 0.12);
            const up = gstep < 4;
            const sx = up ? gxp + pn.hw - st / 2 : gxp + st / 2;
            gg.push(`<line x1="${f(sx)}" x2="${f(sx)}" y1="${f(gy + (up ? -0.15 : 0.15) * sp)}" y2="${f(gy + (up ? -3.2 : 3.2) * sp)}" stroke="var(--ghost)" stroke-opacity="0.75" stroke-width="${f(st)}"/>`);
          }
          if (gh.arrow) {
            const ax = gxp + pn.hw / 2;
            const up = gh.arrow === 'up';
            const y1 = up ? gy - 1.0 * sp : gy + 1.0 * sp;
            const y2 = up ? gy - 2.6 * sp : gy + 2.6 * sp;
            const k = up ? 1 : -1;
            gg.push(`<path d="M${f(ax)} ${f(y1)} L${f(ax)} ${f(y2)} M${f(ax - 0.5 * sp)} ${f(y2 + k * 0.55 * sp)} L${f(ax)} ${f(y2)} L${f(ax + 0.5 * sp)} ${f(y2 + k * 0.55 * sp)}" fill="none" stroke="var(--ghost)" stroke-width="${f(Math.max(1.5, sp * 0.13))}" stroke-linecap="round" stroke-linejoin="round"/>`);
          }
          over.push(`<g class="ghost"${lo}>${gg.join('')}</g>`);
        }
        if (m.label) {
          over.push(`<text x="${f(gx)}" y="${f(pn.y - 2.0 * sp)}" text-anchor="middle" font-family="var(--font-text)" font-weight="600" font-size="${f(Math.max(11, sp * (m.labelScale || 1.05)))}" fill="${m.labelColor || 'var(--brass-ink)'}">${m.label}</text>`);
        }
        if (m.ring) {
          const rc = m.ring === 'hit' ? 'var(--correct)' : 'var(--brass)';
          under.push(`<circle cx="${f(gx)}" cy="${f(pn.y)}" r="${f(sp * 1.7)}" fill="${rc}" fill-opacity="0.14" stroke="${rc}" stroke-width="${f(Math.max(1.5, sp * 0.14))}"/>`);
          if (m.pulse) under.push(`<circle cx="${f(gx)}" cy="${f(pn.y)}" r="${f(sp * 2.5)}" fill="none" stroke="${rc}" stroke-opacity="0.45" stroke-width="${f(Math.max(1.5, sp * 0.12))}"/>`);
        }
        if (m.state === 'hl') {
          under.push(`<circle cx="${f(gx)}" cy="${f(pn.y)}" r="${f(sp * 1.5)}" fill="var(--brass)" fill-opacity="0.18"/>`);
        }
      }
      // Round 2 (05 R25): "Show what we heard". The pitch track as a thin grey line over the staff: a short scoop into
      // each note, the held pitch with a little wobble, and a tail that falls away past the note's end.
      // o.trace: { [id]: { dev (semitones), delay (fraction of the note), tail (semitones), tailLen (spaces), skip } }.
      if (o.trace) {
        const seg = [];
        const semiDy = (s) => ((s * 7) / 12) * (sp / 2);
        placed.forEach((pn, i) => {
          if (pn.n.r || pn.y === undefined) return;
          const id = pn.n.id || `b${barNo}n${pn.ni + 1}`;
          const t = o.trace[id] || {};
          if (t.skip) return;
          const nextX = i + 1 < placed.length ? placed[i + 1].x : bx + bw;
          const xs0 = pn.x + pn.hw * 0.2;
          const span = nextX - xs0 - 0.5 * sp;
          const xs = xs0 + (t.delay || 0) * span;
          const xe = xs0 + span * (pn.n.d === 'w' || pn.n.d === 'h' ? 0.92 : 0.85);
          const yc = pn.y - semiDy(t.dev || 0);
          const pts = [[xs, yc + semiDy(t.scoop ?? 0.7)], [xs + 0.7 * sp, yc + semiDy(0.1)]];
          const n = Math.max(2, Math.round((xe - xs) / (0.9 * sp)));
          for (let k = 1; k <= n; k++) pts.push([xs + 0.7 * sp + ((xe - xs - 0.7 * sp) * k) / n, yc + (k % 2 ? -1 : 1) * semiDy(0.08)]);
          if (t.tail) {
            const tl = (t.tailLen || 2.4) * sp;
            pts.push([xe + tl * 0.4, yc - semiDy(t.tail * 0.35)], [xe + tl, yc - semiDy(t.tail)]);
          }
          seg.push(`<polyline points="${pts.map(([a, b]) => `${f(a)},${f(b)}`).join(' ')}" fill="none" stroke="var(--text-muted)" stroke-opacity="0.85" stroke-width="${f(Math.max(1.25, sp * 0.11))}" stroke-linecap="round" stroke-linejoin="round"/>`);
        });
        over.push(`<g class="trace">${seg.join('')}</g>`);
      }
      bx += bw;
      barIndex++;
      // barline
      const last = barIndex === o.bars.length && !o.noFinal;
      if (last) {
        parts.push(`<rect x="${f(bx - 0.75 * sp)}" y="${f(y0)}" width="${f(Math.max(1, sp * 0.16))}" height="${f(4 * sp)}" fill="var(--ink)"/><rect x="${f(bx - 0.5 * sp)}" y="${f(y0)}" width="${f(0.5 * sp)}" height="${f(4 * sp)}" fill="var(--ink)"/>`);
      } else if (!(o.noFinal && barIndex === o.bars.length)) {
        parts.push(`<rect x="${f(bx - Math.max(1, sp * 0.16))}" y="${f(y0)}" width="${f(Math.max(1, sp * 0.16))}" height="${f(4 * sp)}" fill="var(--ink)"/>`);
      }
    });
    if (sysOp !== 1) parts.push('</g>');
  });
  // Note-colour proposal: o.overlay(notes, { sp }) adds SVG over the music (the coloured letter band).
  if (o.overlay) over.push(o.overlay(noteList, { sp, width: o.width }));
  const svg = `<svg class="score-svg" viewBox="0 0 ${f(o.width)} ${f(height)}" width="${f(o.width)}" height="${f(height)}" xmlns="http://www.w3.org/2000/svg" font-family="Bravura" aria-hidden="true"><g class="under">${under.join('')}</g><g fill="var(--ink)" color="var(--ink)">${parts.join('')}</g><g class="over">${over.join('')}</g></svg>`;
  return { svg, height, notes: noteList };
}

/** Large range picture: staff, four whole notes, served band, note names. */
export function rangePicture({ clef, full, served, width = 320, sp = 9, names = true, interactive = true, playIndex = -1 }) {
  const C = CLEF[clef];
  const top = 4.6 * sp;
  const yb = top + 4 * sp;
  const yOf = (s) => yb - (s * sp) / 2;
  const notes = [
    { m: full[0], kind: 'full' }, { m: served[0], kind: 'served' }, { m: served[1], kind: 'served' }, { m: full[1], kind: 'full' },
  ];
  const x0 = 0, x1 = width;
  const parts = [];
  const startX = x0 + 4.4 * sp;
  const span = x1 - startX - 2 * sp;
  const xs = [0.08, 0.36, 0.64, 0.92].map((t) => startX + t * span - 0.85 * sp);
  // served band
  const bandX = xs[1] - 0.6 * sp, bandW = xs[2] - xs[1] + 2.9 * sp;
  parts.push(`<rect class="band" x="${f(bandX)}" y="${f(top - 2.2 * sp)}" width="${f(bandW)}" height="${f(8.4 * sp)}" rx="${f(0.8 * sp)}" fill="var(--band)"/>`);
  for (let l = 0; l < 5; l++) parts.push(`<line x1="${x0}" x2="${x1}" y1="${f(top + l * sp)}" y2="${f(top + l * sp)}" stroke="var(--staff-line)" stroke-width="1"/>`);
  parts.push(txt(x0 + 0.6 * sp, yOf(C.step), sp, C.glyph, 'fill="var(--ink)"'));
  const labels = [];
  notes.forEach((n, i) => {
    const name = midiPitch(n.m);
    const P = parsePitch(name);
    const step = P.dn - C.ref;
    const y = yOf(step);
    const x = xs[i];
    const hw = 1.69 * sp;
    const col = i === playIndex ? 'var(--brass)' : n.kind === 'full' ? 'var(--range-full)' : 'var(--ink)';
    const g = [];
    if (i === playIndex) g.push(`<circle cx="${f(x + hw / 2)}" cy="${f(y)}" r="${f(sp * 1.9)}" fill="var(--brass)" fill-opacity="0.16"/>`);
    for (let s = -2; s >= step; s -= 2) g.push(`<line x1="${f(x - 0.45 * sp)}" x2="${f(x + hw + 0.45 * sp)}" y1="${f(yOf(s))}" y2="${f(yOf(s))}" stroke="${col}" stroke-width="1.2"/>`);
    for (let s = 10; s <= step; s += 2) g.push(`<line x1="${f(x - 0.45 * sp)}" x2="${f(x + hw + 0.45 * sp)}" y1="${f(yOf(s))}" y2="${f(yOf(s))}" stroke="${col}" stroke-width="1.2"/>`);
    if (P.acc) g.push(txt(x - 1.3 * sp, y, sp, P.acc === '#' ? G.sharp : G.flat, `fill="${col}"`));
    g.push(txt(x, y, sp, G.whole, `fill="${col}"`));
    parts.push(`<g class="rn rn-${n.kind}">${g.join('')}</g>`);
    labels.push({ x: x + hw / 2, name: midiName(n.m), kind: n.kind });
  });
  const h = top + 4 * sp + 4.6 * sp;
  const svg = `<svg class="range-svg" viewBox="0 0 ${width} ${f(h)}" width="${width}" height="${f(h)}" font-family="Bravura" aria-hidden="true">${parts.join('')}</svg>`;
  return { svg, labels, height: h, width };
}

/** Mini key-signature staff for key chips. */
export function miniKey({ clef, key, sp = 6.5, width = 420 }) {
  // Drawn at its true staff space; lines run long and the chip clips them, so the staff fills the chip (C3).
  const C = CLEF[clef];
  const top = (clef === 'bass' ? 1.6 : 2.4) * sp; // the treble clef and its sharps reach higher
  const yb = top + 4 * sp;
  const yOf = (s) => yb - (s * sp) / 2;
  const ks = keySteps(clef, key);
  const parts = [];
  for (let l = 0; l < 5; l++) parts.push(`<line x1="0" x2="${width}" y1="${f(top + l * sp)}" y2="${f(top + l * sp)}" stroke="currentColor" stroke-opacity="0.55" stroke-width="1"/>`);
  parts.push(txt(1.5, yOf(C.step), sp, C.glyph));
  ks.forEach((s, i) => parts.push(txt(4.2 * sp + i * 1.15 * sp, yOf(s), sp, key.type === '#' ? G.sharp : G.flat)));
  const h = top + 4 * sp + (clef === 'bass' ? 1.6 : 2) * sp;
  return `<span class="mk"><svg class="mini-key" viewBox="0 0 ${width} ${f(h)}" width="${width}" height="${f(h)}" font-family="Bravura" fill="currentColor" aria-hidden="true">${parts.join('')}</svg></span>`;
}

export function timeSigGlyph(top, bottom, sp = 6) {
  const w = 2.4 * sp * Math.max(String(top).length, 1);
  const h = 4 * sp;
  return `<svg class="ts" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}" font-family="Bravura" fill="currentColor" aria-hidden="true">${txt(0, sp, sp, G.ts(top))}${txt(0, 3 * sp, sp, G.ts(bottom))}</svg>`;
}

/** Ruler bar on the shared C1..C8 axis. */
export function rulerBar({ full, served, width = 160, height = 22, ticks = true }) {
  const lo = 24, hi = 108;
  const X = (m) => ((m - lo) / (hi - lo)) * width;
  const parts = [];
  const by = 8;
  parts.push(`<rect x="0" y="${by}" width="${width}" height="6" rx="3" fill="var(--track)"/>`);
  // Every C gets a tick; middle C (C4) is taller and darker, the ruler's one landmark (C15).
  if (ticks) for (let m = lo; m <= hi; m += 12) parts.push(m === 60
    ? `<line x1="${f(X(m))}" x2="${f(X(m))}" y1="0.5" y2="${height - 0.5}" stroke="var(--text-muted)" stroke-width="1.5"/>`
    : `<line x1="${f(X(m))}" x2="${f(X(m))}" y1="${by - 3}" y2="${by + 9}" stroke="var(--tick)" stroke-width="1"/>`);
  parts.push(`<rect x="${f(X(full[0]))}" y="${by}" width="${f(X(full[1]) - X(full[0]))}" height="6" rx="3" fill="var(--range-full-bar)"/>`);
  if (served) parts.push(`<rect x="${f(X(served[0]))}" y="${by - 1}" width="${f(Math.max(4, X(served[1]) - X(served[0])))}" height="8" rx="4" fill="var(--ink-ui)"/>`);
  if (ticks) { const mc = parts.findIndex((q) => q.includes('stroke-width="1.5"')); if (mc >= 0) parts.push(parts.splice(mc, 1)[0]); }
  return `<svg class="ruler" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" preserveAspectRatio="none">${parts.join('')}</svg>`;
}

/** Keyboard strip from loM to hiM (both C's ideally). */
export function keyboard({ loM = 36, hiM = 72, full, served, width = 320, height = 44, labels = true, pressed = -1 }) {
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const whites = [];
  for (let m = loM; m <= hiM; m++) if (!isBlack(m)) whites.push(m);
  const ww = width / whites.length;
  const parts = [];
  const tone = (m) => (m >= served[0] && m <= served[1] ? 'served' : m >= full[0] && m <= full[1] ? 'full' : 'out');
  whites.forEach((m, i) => {
    const t = tone(m);
    const fill = m === pressed ? 'var(--brass)' : t === 'served' ? 'var(--kb-served)' : t === 'full' ? 'var(--kb-full)' : 'var(--kb-white)';
    parts.push(`<rect x="${f(i * ww + 0.5)}" y="0.5" width="${f(ww - 1)}" height="${height - 1}" rx="2.5" fill="${fill}" stroke="var(--kb-edge)" stroke-width="1"/>`);
    if (m === 60) parts.push(`<circle cx="${f(i * ww + ww / 2)}" cy="${height - 7}" r="2" fill="var(--kb-dot)"/>`);
  });
  for (let m = loM; m <= hiM; m++) {
    if (!isBlack(m)) continue;
    const wi = whites.indexOf(m - 1);
    const t = tone(m);
    const fill = t === 'served' ? 'var(--kb-black-served)' : t === 'full' ? 'var(--kb-black-full)' : 'var(--kb-black)';
    parts.push(`<rect x="${f((wi + 1) * ww - ww * 0.32)}" y="0.5" width="${f(ww * 0.64)}" height="${f(height * 0.6)}" rx="1.5" fill="${fill}"/>`);
  }
  let lab = '';
  if (labels) {
    const ls = whites.map((m, i) => (m % 12 === 0 ? `<span style="left:${f((i * ww) / width * 100)}%">${midiName(m)}</span>` : '')).join('');
    lab = `<div class="kb-labels">${ls}</div>`;
  }
  const X = (m) => { const wi = whites.findIndex((w) => w >= m); const i = wi < 0 ? whites.length - 1 : wi; return (isBlack(m) ? i - 0.3 : i) / whites.length * 100; };
  const XE = (m) => { const wi = whites.findIndex((w) => w >= m); const i = wi < 0 ? whites.length - 1 : wi; return (isBlack(m) ? i + 0.3 : i + 1) / whites.length * 100; };
  const br = `<div class="kb-brackets" aria-hidden="true"><i class="full" style="left:${f(X(full[0]))}%;width:${f(XE(full[1]) - X(full[0]))}%"></i><i class="served" style="left:${f(X(served[0]))}%;width:${f(XE(served[1]) - X(served[0]))}%"></i></div>`;
  return `<div class="kb">${br}<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${parts.join('')}</svg>${lab}</div>`;
}
