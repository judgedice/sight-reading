// Browser entry for the overlay e2e spec (bundled by overlay-page.ts). Exposes `window.overlayRig`.
import type { Clef, ExcerptDoc, GhostNote, PreparedExcerpt } from '../../src/core/types.ts';
import { ensureNotationFonts, VexScoreView, expectedChains, tickablesPerBar } from '../../src/notation/index.ts';
import { SvgOverlay } from '../../src/notation/overlay/index.ts';
import { preparedFromDoc } from '../../src/notation/testing/prepared.ts';
import { planLayout } from '../../src/ui/layout-table.ts';

/** The excerpt's full bars repeated until it holds at least `minNotes` notes (ties, slurs and marks dropped). */
function longPrepared(doc: ExcerptDoc, clef: Clef, minNotes: number): PreparedExcerpt {
  const base = preparedFromDoc(doc, clef);
  const bars = base.measures.filter((m) => !m.isPickup);
  const perBar = base.meter.countsPerBar * base.meter.countUnitTicks;
  const perPass = bars.filter((m) => m.events.some((e) => e.kind === 'note')).reduce((n, m) => n + m.events.filter((e) => e.kind === 'note').length, 0);
  const passes = Math.max(1, Math.ceil(minNotes / Math.max(1, perPass)));
  const measures: PreparedExcerpt['measures'] = [];
  for (let r = 0; r < passes; r++) {
    for (const m of bars) {
      const k = measures.length;
      measures.push({
        index: k,
        isPickup: false,
        startTick: k * perBar,
        displayBar: k + 1,
        events: m.events.map((e) => {
          const shifted = { ...e, id: `${e.id}~${r}`, tick: k * perBar + (e.tick - m.startTick) };
          if (shifted.kind === 'note') {
            delete (shifted as { tieStart?: true }).tieStart;
            delete (shifted as { tieStop?: true }).tieStop;
            delete (shifted as { slur?: string }).slur;
            delete (shifted as { hairpin?: string }).hairpin;
            delete (shifted as { dynamic?: string }).dynamic;
          }
          return shifted;
        }),
      });
    }
  }
  return { ...base, pickupTicks: 0, measures, barRhythmLevel: measures.map(() => 1) };
}

const overlay = new SvgOverlay();
const view = new VexScoreView({ overlay });

function mount(doc: ExcerptDoc, clef: Clef, viewport: { width: number; height: number }, minNotes: number, sprite: string) {
  const el = document.getElementById('score')!;
  if (!document.getElementById('sprite')) {
    const holder = document.createElement('div');
    holder.id = 'sprite';
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = sprite;
    document.body.appendChild(holder);
  }
  const p = longPrepared(doc, clef, minNotes);
  const plan = planLayout(viewport, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p));
  el.style.width = `${plan.renderOptions.widthPx}px`;
  const layout = view.render(p, el, plan.renderOptions);
  return { p, layout, notes: expectedChains(p).length };
}

/** Marks every note (two glyphs on up to 4 per bar, a dot elsewhere) and 200+ matched ghosts; returns counts. */
function populate(p: PreparedExcerpt, ghostCount: number) {
  const chains = expectedChains(p);
  const seen = new Map<number, number>();
  chains.forEach((c, i) => {
    const n = seen.get(c.bar) ?? 0;
    seen.set(c.bar, n + 1);
    view.setNoteState(i, n < 4 ? { phase: 'judged', timing: 'late', pitch: 'sharp' } : { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
  });
  const notes = p.measures.flatMap((m) => m.events.filter((e) => e.kind === 'note'));
  const ghosts: GhostNote[] = [];
  for (let i = 0; i < ghostCount; i++) {
    const e = notes[i % notes.length]!;
    if (e.kind !== 'note') continue;
    ghosts.push({
      detectedId: i,
      scoreBeat: (e.tick - p.pickupTicks) / p.meter.countUnitTicks + 0.06 * (1 + (i % 3)),
      writtenPitch: e.writtenPitch,
      kind: i % 2 === 0 ? 'late' : 'sharp',
      centsError: null,
      targetExpectedIdx: null,
      displaced: false,
    });
  }
  for (const g of ghosts) view.showGhost(g);
  return { ghosts };
}

/** Counts of overlay DOM. */
function counts() {
  return {
    ghosts: document.querySelectorAll('#score .sr-ghost').length,
    glyphs: document.querySelectorAll('#score .sr-note-marks .sr-glyph').length,
    overlayNodes: document.querySelectorAll('#score .sr-overlay *').length,
  };
}

/** Plays `ms` of frames with a moving playhead and the follower re-sending marks; returns rAF and JS timings. */
function frames(p: PreparedExcerpt, ghosts: GhostNote[], ms: number): Promise<{ frameMs: number[]; jsMs: number[] }> {
  const total = (p.measures.length * p.meter.countsPerBar) as number;
  const chains = expectedChains(p);
  return new Promise((resolve) => {
    const frameMs: number[] = [];
    const jsMs: number[] = [];
    let last = performance.now();
    const start = last;
    let k = 0;
    const tick = (now: number): void => {
      frameMs.push(now - last);
      last = now;
      const t0 = performance.now();
      view.setPlayhead(((now - start) / ms) * total);
      for (let j = 0; j < 4; j++) {
        const g = ghosts[(k + j) % ghosts.length]!;
        view.showGhost(g);
        const i = (k + j) % chains.length;
        view.setNoteState(i, { phase: 'judged', timing: 'late', pitch: 'sharp' });
      }
      k += 4;
      jsMs.push(performance.now() - t0);
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve({ frameMs: frameMs.slice(2), jsMs });
    };
    requestAnimationFrame(tick);
  });
}

const api = { ready: () => ensureNotationFonts(), mount, populate, counts, frames, view };
(window as unknown as { overlayRig: typeof api }).overlayRig = api;
