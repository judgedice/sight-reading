// VexFlow 5 static render of a PreparedExcerpt: one <svg> per system (01 §5.8, 04 §4.2).
//
// Geometry is laid out in VexFlow units, where a staff space is 10 units, and drawn inside a
// <g class="sr-static" transform="scale(sp / 10)">. Each system SVG's own user units are CSS px, so the
// overlay groups (P15) and every coordinate in ScoreLayout are plain px within the system SVG.

import {
  Accidental,
  Articulation,
  BarlineType,
  Beam,
  Curve,
  Dot,
  Formatter,
  Modifier,
  Stave,
  StaveHairpin,
  StaveNote,
  StaveTie,
  SVGContext,
  Tuplet,
  Voice,
} from './font/vexflow-bravura.ts';
import type { Articulation as ArticName, Clef, Dynamic, PreparedEvent, PreparedExcerpt, PreparedMeasure, RenderOptions } from '../core/types.ts';
import { splitDuration, vexDuration, writtenTicks, isBeamable, type DurationPiece } from './durations.ts';
import { distributeWidths, squeezeWidths, type MeasureAnchors } from './layout.ts';
import { BarAccidentals, vexAccidental, vexClef, vexKey, vexKeySignature } from './pitch-geometry.ts';
import { installTableMetrics } from './text-metrics.ts';
import { noteLetter } from './note-colours.ts';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** VexFlow's staff space in its own units. */
export const VF_SP = 10;
/** 04 §4.2 system geometry (mirrors src/ui/layout-table.ts; notation may not import ui, a test checks equality). */
export const SYSTEM_STAFF_SP = 12;
export const STAFF_TOP_SP = 4;
export const LANE_PX = 20;
export const SYSTEM_GAP_PX = 12;
export const MIN_BAR_WIDTH_SP = 14;
/** Left and right padding inside each system SVG, VexFlow units (keeps the barlines inside the viewport). */
const PAD_LEFT_VF = 1;
const PAD_RIGHT_VF = 1.5;

export function systemHeightPx(spPx: number): number {
  return SYSTEM_STAFF_SP * spPx + LANE_PX + SYSTEM_GAP_PX;
}

/** One drawn glyph of an event (an event split into tied pieces has several). */
interface Piece {
  measure: PreparedMeasure;
  event: PreparedEvent;
  pieceIdx: number;
  pieceCount: number;
  dur: DurationPiece;
  /** Written-tick onset of the piece, relative to the measure start. */
  offset: number;
  /** A whole-bar rest drawn as a centred whole rest. */
  barRest: boolean;
}

/** Events of a measure as drawable pieces (05 tickables count for the layout table). */
export function measurePieces(m: PreparedMeasure, barTicks: number): Piece[] {
  const out: Piece[] = [];
  const only = m.events.length === 1 ? m.events[0] : undefined;
  if (only && only.kind === 'rest' && !only.tuplet && only.dur === barTicks && !m.isPickup) {
    return [{ measure: m, event: only, pieceIdx: 0, pieceCount: 1, dur: { code: 'w', dots: 0, ticks: barTicks }, offset: 0, barRest: true }];
  }
  for (const e of m.events) {
    const written = writtenTicks(e.dur, e.tuplet);
    const parts = splitDuration(written);
    let off = e.tick - m.startTick;
    parts.forEach((d, i) => {
      out.push({ measure: m, event: e, pieceIdx: i, pieceCount: parts.length, dur: d, offset: off, barRest: false });
      off += e.tuplet ? (d.ticks * e.tuplet.normal) / e.tuplet.actual : d.ticks;
    });
  }
  return out;
}

/** Tickables (drawn notes and rests) per measure, for `planLayout`'s density rules. */
export function tickablesPerBar(p: PreparedExcerpt): number[] {
  const bt = p.meter.countUnitTicks * p.meter.countsPerBar;
  return p.measures.map((m) => measurePieces(m, bt).length);
}

export interface RenderedNote {
  eventId: string;
  system: number;
  /** All drawn groups of the event (tied pieces included). */
  groups: SVGElement[];
  /** Box in px within the system SVG (first piece's notehead, or the rest glyph). */
  box: { x: number; y: number; w: number; h: number };
}

export interface RenderedSystem {
  index: number;
  svg: SVGSVGElement;
  underlay: SVGGElement;
  staticGroup: SVGGElement;
  overlay: SVGGElement;
  firstMeasure: number;
  lastMeasure: number;
}

export interface RenderedExcerpt {
  systems: RenderedSystem[];
  notes: Map<string, RenderedNote>;
  anchors: MeasureAnchors[];
  spPx: number;
  heightPx: number;
  widthPx: number;
  /** False when the minimum bar width could not be honoured in some system (bars were squeezed). */
  fits: boolean;
}

const ARTIC: Record<ArticName, string> = { staccato: 'a.', tenuto: 'a-', accent: 'a>', marcato: 'a^' };

/** SMuFL dynamics letters (U+E520 p, U+E521 m, U+E522 f, U+E524 s, U+E525 z) and breath mark (U+E4CE). */
const DYN = { p: '\uE520', m: '\uE521', f: '\uE522', s: '\uE524', z: '\uE525' } as const;
const BREATH_MARK = '\uE4CE';
const DYNAMIC_GLYPHS: Record<Dynamic, string> = {
  pp: DYN.p + DYN.p,
  p: DYN.p,
  mp: DYN.m + DYN.p,
  mf: DYN.m + DYN.f,
  f: DYN.f,
  ff: DYN.f + DYN.f,
  fp: DYN.f + DYN.p,
  sfz: DYN.s + DYN.f + DYN.z,
};

/** Rest placement key per clef (middle line). */
const REST_KEY: Record<Clef, string> = { treble: 'b/4', 'treble-8vb': 'b/4', bass: 'd/3', alto: 'c/4', tenor: 'a/3' };

/** VexFlow y of the top staff line for a stave at y = 0 (VexFlow reserves 4 spaces above). */
const STAFF_TOP_VF = STAFF_TOP_SP * VF_SP;
const STAFF_BOTTOM_VF = STAFF_TOP_VF + 4 * VF_SP;

function assertLayout(p: PreparedExcerpt, o: RenderOptions): void {
  if (!(o.widthPx > 0) || !(o.spPx > 0)) throw new RangeError(`RenderOptions need positive widthPx and spPx, got ${o.widthPx} and ${o.spPx}`);
  if (o.barsPerSystem.length === 0 || o.barsPerSystem.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new RangeError(`barsPerSystem must be positive integers, got [${o.barsPerSystem.join(', ')}]`);
  }
  const total = o.barsPerSystem.reduce((a, b) => a + b, 0);
  if (total !== p.measures.length) {
    throw new RangeError(`barsPerSystem sums to ${total} but the excerpt has ${p.measures.length} measures (pickup included)`);
  }
}

/** Measure end tick: the next measure's start, or start + bar length (pickup length for a lone pickup). */
function measureEnd(p: PreparedExcerpt, i: number): number {
  const m = p.measures[i]!;
  const next = p.measures[i + 1];
  if (next) return next.startTick;
  const bt = p.meter.countUnitTicks * p.meter.countsPerBar;
  const evEnd = m.events.reduce((a, e) => Math.max(a, e.tick + e.dur), m.startTick);
  return Math.max(evEnd, m.startTick + (m.isPickup ? p.pickupTicks : bt));
}

interface Pending {
  /** Start note, or null when continued from the previous system (then it starts at this system's first note). */
  note: StaveNote | null;
  system: number;
}

/**
 * Render every system. Requires a global `document` (browser, or jsdom in Node). The returned SVGs are detached;
 * the caller places them.
 */
export function renderExcerpt(p: PreparedExcerpt, o: RenderOptions): RenderedExcerpt {
  assertLayout(p, o);
  installTableMetrics();
  const k = o.spPx / VF_SP;
  const widthVF = o.widthPx / k;
  const heightPx = systemHeightPx(o.spPx);
  const barTicks = p.meter.countUnitTicks * p.meter.countsPerBar;
  const clef = vexClef(p.clef);
  const keySpec = vexKeySignature(p.writtenKey);
  const timeSpec = `${p.meter.beats}/${p.meter.beatType}`;
  const pieces = p.measures.map((m) => measurePieces(m, barTicks));

  const systems: RenderedSystem[] = [];
  const notes = new Map<string, RenderedNote>();
  const anchors: MeasureAnchors[] = [];
  let fits = true;

  // Cross-measure state, carried across systems.
  let pendingTie: Pending | null = null;
  const openSlurs: Pending[] = [];
  let openHairpin: (Pending & { type: number }) | null = null;
  const accidentals = new BarAccidentals(p.writtenKey);

  let measureIdx = 0;
  o.barsPerSystem.forEach((count, s) => {
    const first = measureIdx;
    const last = measureIdx + count - 1;
    measureIdx += count;

    // Width of clef + key (+ time in system 0) beyond a bare stave's note start.
    const probe = new Stave(0, 0, 1000);
    const bare = probe.getNoteStartX();
    const withMods = new Stave(0, 0, 1000).addClef(clef.name, 'default', clef.annotation).addKeySignature(keySpec);
    if (s === 0) withMods.addTimeSignature(timeSpec);
    const extra = withMods.getNoteStartX() - bare;
    const weights = pieces.slice(first, last + 1).map((ps) => ps.length);
    const avail = widthVF - PAD_LEFT_VF - PAD_RIGHT_VF - extra;
    const dist = distributeWidths(avail, weights, MIN_BAR_WIDTH_SP * VF_SP);
    fits &&= dist.fits;
    // Squeezed: share by what each bar holds rather than evenly, so a lone whole note gives room to busier bars.
    const shared = dist.fits ? dist.widths : squeezeWidths(avail, weights, MIN_BAR_WIDTH_SP * VF_SP);
    const widths = shared.map((w, i) => (i === 0 ? w + extra : w));

    // SVG scaffold: underlay (bar tint), static VexFlow ink, overlay (marks); P15 owns the first and last.
    const host = document.createElement('div');
    const ctx = new SVGContext(host);
    ctx.resize(o.widthPx, heightPx);
    const svg = ctx.svg as SVGSVGElement;
    svg.removeAttribute('style');
    svg.setAttribute('class', 'sr-system');
    svg.setAttribute('data-system', String(s));
    svg.setAttribute('overflow', 'visible');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'currentColor');
    const underlay = document.createElementNS(SVG_NS, 'g');
    underlay.setAttribute('class', 'sr-underlay');
    svg.appendChild(underlay);
    ctx.setFillStyle('currentColor');
    ctx.setStrokeStyle('currentColor');
    // Themed default: without it VexFlow applies its metrics' fixed colours (Stem strokeStyle 'black', Stave
    // '#999999'), so stems vanish on dark paper. A defined default makes Element.applyStyle drop those.
    ctx.setDefaultStyle({ fillStyle: 'currentColor', strokeStyle: 'currentColor' });
    const staticGroup = ctx.openGroup('sr-static') as SVGGElement;
    // VexFlow prefixes classes with "vf-"; keep ours unprefixed.
    staticGroup.setAttribute('class', 'sr-static');
    staticGroup.setAttribute('transform', `scale(${k})`);

    const systemNotes: StaveNote[] = [];
    let x = PAD_LEFT_VF;
    for (let mi = first; mi <= last; mi++) {
      const m = p.measures[mi]!;
      const w = widths[mi - first]!;
      const stave = new Stave(x, 0, w);
      if (mi === first) {
        stave.addClef(clef.name, 'default', clef.annotation).addKeySignature(keySpec);
        if (s === 0) stave.addTimeSignature(timeSpec);
      } else {
        stave.setBegBarType(BarlineType.NONE);
      }
      if (mi === p.measures.length - 1) stave.setEndBarType(BarlineType.END);
      stave.setContext(ctx).draw();
      accidentals.barline();

      const mPieces = pieces[mi]!;
      const staveNotes: StaveNote[] = [];
      for (const pc of mPieces) {
        const e = pc.event;
        let sn: StaveNote;
        if (e.kind === 'rest') {
          sn = new StaveNote({ keys: [REST_KEY[p.clef]], duration: vexDuration(pc.dur, true), clef: clef.name, alignCenter: pc.barRest });
        } else {
          sn = new StaveNote({ keys: [vexKey(e.writtenPitch)], duration: vexDuration(pc.dur, false), clef: clef.name, autoStem: true });
          const tiedIn = pc.pieceIdx > 0 || e.tieStop === true;
          const acc = accidentals.next(e.writtenPitch, tiedIn);
          if (acc !== null) sn.addModifier(new Accidental(vexAccidental(acc)), 0);
        }
        if (pc.dur.dots > 0) Dot.buildAndAttach([sn], { all: true });
        staveNotes.push(sn);
      }

      // Tuplets before the voice (they change tick counts), beams before formatting (they set stems).
      const tuplets: Tuplet[] = [];
      const byGroup = new Map<string, { notes: StaveNote[]; actual: number; normal: number }>();
      mPieces.forEach((pc, i) => {
        const t = pc.event.tuplet;
        if (!t) return;
        const g = byGroup.get(t.groupId) ?? { notes: [], actual: t.actual, normal: t.normal };
        g.notes.push(staveNotes[i]!);
        byGroup.set(t.groupId, g);
      });
      for (const g of byGroup.values()) {
        tuplets.push(new Tuplet(g.notes, { numNotes: g.actual, notesOccupied: g.normal, ratioed: false, bracketed: !beamableRun(g.notes) }));
      }
      const beams = beamGroups(mPieces, staveNotes, p.meter.countUnitTicks).map((ns) => new Beam(ns, true));

      // Articulations after stems are final, on the notehead side.
      mPieces.forEach((pc, i) => {
        if (pc.event.kind !== 'note' || pc.pieceIdx !== 0 || !pc.event.artic) return;
        const sn = staveNotes[i]!;
        const below = sn.getStemDirection() === 1;
        for (const a of pc.event.artic) {
          sn.addModifier(new Articulation(ARTIC[a]).setPosition(below ? Modifier.Position.BELOW : Modifier.Position.ABOVE), 0);
        }
      });

      const voice = new Voice({ numBeats: p.meter.beats, beatValue: p.meter.beatType }).setMode(Voice.Mode.SOFT);
      voice.addTickables(staveNotes);
      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);
      for (const b of beams) b.setContext(ctx).draw();
      for (const t of tuplets) t.setContext(ctx).draw();

      // Ties, slurs, hairpins, dynamics and breath marks, and the beat anchors.
      const points: { tick: number; x: number }[] = [];
      mPieces.forEach((pc, i) => {
        const sn = staveNotes[i]!;
        const e = pc.event;
        if (pc.pieceIdx > 0) {
          const prev = staveNotes[i - 1]!;
          if (e.kind === 'note') new StaveTie({ firstNote: prev, lastNote: sn, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw();
        }
        if (e.kind === 'note' && pc.pieceIdx === 0) {
          if (e.tieStop && pendingTie) {
            if (pendingTie.system === s) {
              new StaveTie({ firstNote: pendingTie.note, lastNote: sn, firstIndexes: [0], lastIndexes: [0] }).setContext(ctx).draw();
            } else {
              new StaveTie({ firstNote: null, lastNote: sn, lastIndexes: [0] }).setContext(ctx).draw();
            }
            pendingTie = null;
          }
          if (e.slur === 'stop' || e.slur === 'continue') {
            const open = openSlurs.pop();
            if (open) slur(ctx, open.note ?? systemNotes[0] ?? staveNotes[0]!, sn);
          }
          if (e.slur === 'start' || e.slur === 'continue') openSlurs.push({ note: sn, system: s });
          if (e.hairpin === 'end' && openHairpin) {
            hairpin(ctx, openHairpin.note ?? systemNotes[0] ?? staveNotes[0]!, sn, openHairpin.type);
            openHairpin = null;
          }
          if (e.hairpin === 'cresc' || e.hairpin === 'dim') {
            openHairpin = { note: sn, system: s, type: e.hairpin === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC };
          }
          if (e.dynamic) drawText(ctx, 'sr-dynamic', DYNAMIC_GLYPHS[e.dynamic], sn.getNoteHeadBeginX() - VF_SP * 0.2, STAFF_BOTTOM_VF + 3.2 * VF_SP);
        }
        if (e.kind === 'note' && pc.pieceIdx === pc.pieceCount - 1) {
          if (e.tieStart) pendingTie = { note: sn, system: s };
          if (e.breath) drawText(ctx, 'sr-breath', BREATH_MARK, sn.getNoteHeadEndX() + VF_SP * 0.6, STAFF_TOP_VF - 0.5 * VF_SP);
        }
        const g = groupOf(svg, sn);
        if (g) tagGroup(g, pc, p, mi, s);
        if (pc.pieceIdx === 0) {
          const box = boxOf(sn, e.kind === 'rest');
          notes.set(e.id, { eventId: e.id, system: s, groups: [], box: scaleBox(box, k) });
          if (!pc.barRest) points.push({ tick: m.startTick + pc.offset, x: sn.getNoteHeadBeginX() * k });
        }
        if (g) notes.get(e.id)?.groups.push(g);
      });
      systemNotes.push(...staveNotes);

      const barlineX = (x + w) * k;
      const headW = (staveNotes.find((n) => !n.isRest())?.getGlyphWidth() ?? VF_SP * 1.2) * k;
      anchors.push({
        system: s,
        startTick: m.startTick,
        endTick: measureEnd(p, mi),
        startX: stave.getNoteStartX() * k,
        endX: barlineX - headW,
        points,
      });
      x += w;
    }

    // Close what continues into the next system at this system's last note.
    const lastNote = systemNotes[systemNotes.length - 1];
    if (lastNote && s < o.barsPerSystem.length - 1) {
      const sysFirst = systemNotes[0]!;
      if (pendingTie && pendingTie.system === s && pendingTie.note) {
        new StaveTie({ firstNote: pendingTie.note, lastNote: null, firstIndexes: [0] }).setContext(ctx).draw();
      }
      for (const open of openSlurs) slur(ctx, open.note ?? sysFirst, lastNote);
      if (openHairpin) hairpin(ctx, openHairpin.note ?? sysFirst, lastNote, openHairpin.type);
      // Continuations start at the next system's first note.
      for (const open of openSlurs) open.note = null;
      if (openHairpin) openHairpin.note = null;
    }
    ctx.closeGroup();
    const overlay = document.createElementNS(SVG_NS, 'g');
    overlay.setAttribute('class', 'sr-overlay');
    svg.appendChild(overlay);
    host.removeChild(svg);
    systems.push({ index: s, svg, underlay, staticGroup, overlay, firstMeasure: first, lastMeasure: last });
  });

  return { systems, notes, anchors, spPx: o.spPx, heightPx, widthPx: o.widthPx, fits };
}

function slur(ctx: SVGContext, from: StaveNote, to: StaveNote): void {
  if (from === to) return;
  new Curve(from, to, {}).setContext(ctx).draw();
}

function hairpin(ctx: SVGContext, start: StaveNote, to: StaveNote, type: number): void {
  if (start === to) return;
  // VexFlow draws hairpins at stave height + 20; pull them up to sit 2.2 spaces under the bottom line.
  const staveBottom = start.checkStave().getY() + start.checkStave().getHeight();
  const yShift = STAFF_BOTTOM_VF + 2.2 * VF_SP - (staveBottom + 20);
  new StaveHairpin({ firstNote: start, lastNote: to }, type)
    .setContext(ctx)
    .setRenderOptions({ height: 0.8 * VF_SP, yShift, leftShiftPx: 0, rightShiftPx: 0, leftShiftTicks: 0, rightShiftTicks: 0 })
    .setPosition(Modifier.Position.BELOW)
    .draw();
}

function drawText(ctx: SVGContext, cls: string, text: string, x: number, y: number): void {
  ctx.save();
  ctx.setFont('Bravura', 30);
  const g = ctx.openGroup(cls);
  g.setAttribute('class', cls);
  ctx.fillText(text, x, y);
  ctx.closeGroup();
  ctx.restore();
}

function beamableRun(notes: StaveNote[]): boolean {
  return notes.length > 1 && notes.every((n) => !n.isRest() && ['8', '16', '32', '64'].includes(n.getDuration()));
}

/**
 * Beam groups: consecutive beamable notes within one metronome beat (a dotted quarter in compound meters, a half in
 * 2/2), and each tuplet on its own. Rests break beams.
 */
function beamGroups(pieces: Piece[], notes: StaveNote[], beatTicks: number): StaveNote[][] {
  const out: StaveNote[][] = [];
  let run: StaveNote[] = [];
  let runKey: string | null = null;
  const flush = (): void => {
    if (run.length > 1) out.push(run);
    run = [];
    runKey = null;
  };
  pieces.forEach((pc, i) => {
    const ok = pc.event.kind === 'note' && isBeamable(pc.dur) && !pc.barRest;
    if (!ok) {
      flush();
      return;
    }
    const key = pc.event.tuplet ? `t:${pc.event.tuplet.groupId}` : `b:${Math.floor(pc.offset / beatTicks)}`;
    if (runKey !== null && key !== runKey) flush();
    runKey = key;
    run.push(notes[i]!);
  });
  flush();
  return out;
}

function boxOf(sn: StaveNote, rest: boolean): { x: number; y: number; w: number; h: number } {
  if (rest) {
    const bb = sn.getBoundingBox();
    return { x: bb.getX(), y: bb.getY(), w: bb.getW(), h: bb.getH() };
  }
  const x = sn.getNoteHeadBeginX();
  const w = sn.getNoteHeadEndX() - x;
  const y = (sn.getYs()[0] ?? STAFF_TOP_VF) - VF_SP / 2;
  return { x, y, w, h: VF_SP };
}

function scaleBox(b: { x: number; y: number; w: number; h: number }, k: number): { x: number; y: number; w: number; h: number } {
  return { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k };
}

/** The <g> VexFlow drew for a note. Element.getSVGElement() uses document.getElementById, which misses detached SVGs. */
function groupOf(svg: SVGSVGElement, sn: StaveNote): SVGElement | null {
  const id = sn.getAttribute('id') as string | undefined;
  return id ? svg.querySelector<SVGElement>(`[id="vf-${id}"]`) : null;
}

function tagGroup(g: SVGElement, pc: Piece, p: PreparedExcerpt, mi: number, s: number): void {
  g.classList.add(pc.event.kind === 'rest' ? 'sr-rest' : 'sr-note');
  g.setAttribute('data-event-id', pc.event.id);
  g.setAttribute('data-bar', String(p.measures[mi]!.displayBar));
  g.setAttribute('data-system', String(s));
  // The written letter, for note colours (PLAN R69; note-colours.ts). Read only by CSS while the setting is on.
  if (pc.event.kind === 'note') g.setAttribute('data-letter', noteLetter(pc.event.writtenPitch));
  if (pc.pieceCount > 1) g.setAttribute('data-piece', String(pc.pieceIdx));
}
