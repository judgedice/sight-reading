// @vitest-environment jsdom
// Short pieces on one system and no orphaned last bar (PLAN R69, point 5 of the note colours round): a 3-bar scale drew
// its last whole note alone on a second system, on desktop (the xl row's "half" rule) and on the phone (2 bars a line).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ExcerptDoc, PreparedExcerpt } from '../../core/types.ts';
import * as notationModule from '../../notation/index.ts';
import { fixtureDoc } from '../../notation/testing/corpus-node.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfigs } from '../../rules/index.ts';
import scalesJson from '../../../config/scales.json';
import { loadScales, prepareScale } from '../../corpus/scales/index.ts';
import { barsExcerpt, FRAME_FIXTURE_ID } from '../../../e2e/notation/score-frame-fixture.ts';
import { squeezeWidths } from '../../notation/layout.ts';
import { balanceSystems } from '../layout-table.ts';
import { score } from '../tokens.ts';
import { ScoreFrameController, type FramePurpose } from './controller.ts';
import { bindNotation } from './notation-binding.ts';

const notation = bindNotation(notationModule);
let doc: ExcerptDoc;
let scale: PreparedExcerpt;
beforeAll(() => {
  doc = fixtureDoc(FRAME_FIXTURE_ID);
  const read = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as unknown;
  const cfg = loadConfigs({
    grading: read('config/grading-config.json'),
    levels: read('config/levels.json'),
    instruments: read('config/instruments.json'),
    progression: read('config/progression.json'),
    tips: read('config/tips.json'),
    budget: read('config/measurement-budget.json'),
    trumpetValves: read('data/trumpet-valves.json'),
  } as never);
  scale = prepareScale(loadScales(scalesJson, cfg), cfg, 'voice-baritone', 'five-note-c');
});

const hosts: HTMLElement[] = [];
function frame() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  return new ScoreFrameController(host, notation, { appearance: { reducedMotion: () => true, highContrast: () => false } });
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

const DESKTOP = { viewport: { width: 1440, height: 900 }, insets: { top: 0, bottom: 0 }, widthPx: 1440 - 2 * 72, bpm: 66, heightPx: 700 };
const LAPTOP = { viewport: { width: 1280, height: 800 }, insets: { top: 0, bottom: 0 }, widthPx: 1100, bpm: 66, heightPx: 600 };
/** A phone's score width: the read-through and review sit in a card (about 318 px), the try uses the screen (366 px). */
const PHONE = { viewport: { width: 390, height: 844 }, insets: { top: 0, bottom: 0 }, widthPx: 318, bpm: 66, heightPx: 600 };
const PHONE_W: Record<FramePurpose, number> = { read: 318, take: 366, review: 318 };
const PURPOSES: FramePurpose[] = ['read', 'take', 'review'];
const SP = { read: ['readDesktop', 'readPhone'], take: ['takeDesktop', 'takePhone'], review: ['reviewDesktop', 'reviewPhone'] } as const;

describe('balanceSystems', () => {
  const sp = (perBar: number, width: number, cap: number) => (bars: number) => Math.min(cap, width / (bars * perBar + 7));
  it('puts up to four bars on one system when the staff space stays at or above the floor', () => {
    expect(balanceSystems([2, 1], sp(10, 1300, 15), 12)).toEqual([3]);
    expect(balanceSystems([2, 2], sp(10, 1300, 15), 12)).toEqual([4]);
    expect(balanceSystems([2, 1], sp(10, 318, 9.5), 7.6)).toEqual([3]);
    // Four bars at a phone width would draw too small: they stay two and two.
    expect(balanceSystems([2, 2], sp(10, 318, 9.5), 7.6)).toEqual([2, 2]);
  });
  it('keeps busy short pieces on their systems', () => {
    expect(balanceSystems([2, 1], sp(10, 1300, 15), 12, () => false)).toEqual([2, 1]);
  });
  it('joins an orphaned last bar to the system before it only when that costs no staff space', () => {
    expect(balanceSystems([4, 4, 1], sp(10, 2000, 15), 12)).toEqual([4, 5]);
    expect(balanceSystems([2, 2, 1], sp(10, 318, 9.5), 7.6)).toEqual([2, 2, 1]);
    expect(balanceSystems([3, 3], sp(10, 300, 15), 12)).toEqual([3, 3]);
    expect(balanceSystems([5], sp(10, 300, 15), 12)).toEqual([5]);
  });
});

describe('squeezeWidths', () => {
  it('shares a tight system by what each bar holds: a lone whole note takes half a busy bar’s share', () => {
    const w = squeezeWidths(290, [4, 4, 1], 140);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(290);
    expect(w[2]! * 2).toBeCloseTo(w[0]!);
    expect(w[0]).toBeCloseTo(w[1]!);
    // Busy bars are squeezed evenly, as before.
    expect(squeezeWidths(300, [4, 8, 12], 140)).toEqual([100, 100, 100]);
  });
});

describe('a 3-bar scale is drawn on one system', () => {
  it('is the five-note scale in C: three bars, the last a whole note', () => {
    expect(scale.measures).toHaveLength(3);
    expect(notation.tickablesPerBar(scale)).toEqual([4, 4, 1]);
  });

  for (const purpose of PURPOSES) {
    for (const [name, args, i] of [['desktop', DESKTOP, 0], ['laptop', LAPTOP, 0], ['phone', PHONE, 1]] as const) {
      it(`${purpose}, ${name}: one system, and the staff space at least 80% of the token`, () => {
        const info = frame().layout(scale, { ...args, ...(name === 'phone' ? { widthPx: PHONE_W[purpose] } : {}), purpose }, notation.tickablesPerBar(scale));
        expect(info.plan.barsPerSystem).toEqual([3]);
        expect(info.systemCount).toBe(1);
        const token = score['staff-space'][SP[purpose][i]];
        expect(info.plan.spPx).toBeGreaterThanOrEqual(token * 0.8 - 0.01);
        expect(info.plan.spPx).toBeLessThanOrEqual(token);
        // The final whole note's bar is narrower than the busy bars, but every note stays on the line.
        const xs = scale.measures.flatMap((m) => m.events).map((e) => info.layout.noteBoxes.get(e.id)!);
        for (let k = 1; k < xs.length; k++) expect(xs[k]!.x, `note ${k}`).toBeGreaterThan(xs[k - 1]!.x + xs[k - 1]!.w * 0.9);
        expect(xs[xs.length - 1]!.x + xs[xs.length - 1]!.w).toBeLessThanOrEqual(info.scoreWidthPx);
      });
    }
  }

  it('the 04 layout table (no purpose) puts it on one system at desktop widths too', () => {
    const info = frame().layout(scale, { viewport: { width: 1500, height: 900 }, insets: { top: 0, bottom: 0 }, widthPx: 1500, bpm: 66 }, notation.tickablesPerBar(scale));
    expect(info.plan.barsPerSystem).toEqual([3]);
  });

  it('leaves longer and busier pieces as they were', () => {
    const eight = barsExcerpt(doc, 8);
    expect(frame().layout(eight, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(eight)).plan.barsPerSystem).toEqual([4, 4]);
    expect(frame().layout(eight, { ...PHONE, widthPx: 366, purpose: 'take' }, notation.tickablesPerBar(eight)).plan.barsPerSystem).toEqual([2, 2, 2, 2]);
    const four = barsExcerpt(doc, 4);
    expect(frame().layout(four, { ...PHONE, purpose: 'read' }, notation.tickablesPerBar(four)).plan.barsPerSystem).toEqual([2, 2]);
  });
});
