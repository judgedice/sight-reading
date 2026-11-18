// Browser entry for the ScoreFrame (D3) e2e spec, bundled by score-frame-page.ts with React, the notation module and
// the token CSS. Exposes `window.frameRig`: mount a 8/10/12-bar excerpt in a page laid out like the performance
// screen (toolbar, frame, status line, injected safe-area insets), then drive the playhead.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ExcerptDoc, GhostNote, PreparedExcerpt } from '../../src/core/types.ts';
import * as notation from '../../src/notation/index.ts';
import { selectRow } from '../../src/ui/layout-table.ts';
import { ScoreFrame, bindNotation, type FrameLayoutInfo, type FrozenResize, type ScoreFrameController } from '../../src/ui/score-frame/index.ts';
import '../../src/ui/tokens.css';
import { barsExcerpt } from './score-frame-fixture.ts';

const loadNotation = () => Promise.resolve(bindNotation(notation));

interface MountArgs {
  doc: ExcerptDoc;
  bars: number;
  bpm: number;
  insets: { top: number; bottom: number };
  sprite: string;
  arrangement?: 'slots' | 'all';
}

let root: Root | null = null;
let frame: ScoreFrameController | null = null;
let info: FrameLayoutInfo | null = null;
let slotLog: number[][] = [];
let resizeLog: FrozenResize[] = [];
let current: MountArgs | null = null;
let excerpt: PreparedExcerpt | null = null;
let frozen = false;
let arrangement: 'slots' | 'all' = 'slots';

function render(): void {
  const a = current!;
  const p = excerpt!;
  flushSync(() => {
    root!.render(
      createElement(ScoreFrame, {
        ref: (c: ScoreFrameController | null) => {
          frame = c;
        },
        loadNotation,
        excerpt: p,
        bpm: a.bpm,
        frozen,
        arrangement,
        reducedMotion: () => false,
        highContrast: () => false,
        onLayout: (i: FrameLayoutInfo) => {
          info = i;
        },
        onSlotsChange: (s: number[]) => {
          slotLog.push(s);
        },
        onFrozenResize: (r: FrozenResize) => {
          resizeLog.push(r);
        },
      }),
    );
  });
}

function pageChrome(insets: { top: number; bottom: number }): void {
  const row = selectRow(window.innerWidth, window.innerHeight);
  const rs = document.documentElement.style;
  rs.setProperty('--test-sai-top', `${insets.top}px`);
  rs.setProperty('--test-sai-bottom', `${insets.bottom}px`);
  rs.setProperty('--toolbar-h', `${row.toolbarPx}px`);
  rs.setProperty('--status-h', `${row.statusLinePx}px`);
}

const rig = {
  async mount(a: MountArgs): Promise<{ info: FrameLayoutInfo; renders: number }> {
    if (!document.getElementById('sprite')) {
      const holder = document.createElement('div');
      holder.id = 'sprite';
      holder.hidden = true;
      holder.innerHTML = a.sprite;
      document.body.appendChild(holder);
    }
    root?.unmount();
    root = createRoot(document.getElementById('frame-root')!);
    info = null;
    frame = null;
    slotLog = [];
    resizeLog = [];
    frozen = false;
    arrangement = a.arrangement ?? 'slots';
    current = a;
    excerpt = barsExcerpt(a.doc, a.bars);
    pageChrome(a.insets);
    render();
    for (let i = 0; i < 200 && !(info && frame && document.querySelector('.sf-frame[data-ready="true"]')); i++) await new Promise((r) => setTimeout(r, 10));
    if (!info || !frame) throw new Error('ScoreFrame did not lay out');
    return { info: rig.info(), renders: notation.vexflowRenderCount() };
  },
  info(): FrameLayoutInfo {
    // Functions and Maps do not cross page.evaluate; strip them.
    const i = info!;
    return { ...i, layout: { systems: i.layout.systems } } as unknown as FrameLayoutInfo;
  },
  setFrozen(f: boolean): void {
    frozen = f;
    render();
  },
  setArrangement(a: 'slots' | 'all'): void {
    arrangement = a;
    render();
  },
  setPlayhead(b: number | null): number[] {
    frame!.setPlayhead(b);
    return frame!.slotSystems();
  },
  showGhost(g: GhostNote): void {
    frame!.showGhost(g);
  },
  firstNote(): { beat: number; pitch: GhostNote['writtenPitch'] } {
    const p = excerpt!;
    for (const m of p.measures)
      for (const e of m.events) if (e.kind === 'note') return { beat: (e.tick - p.pickupTicks) / p.meter.countUnitTicks, pitch: e.writtenPitch };
    throw new Error('no note');
  },
  slots(): number[] {
    return frame!.slotSystems();
  },
  slotLog: () => slotLog,
  resizeLog: () => resizeLog,
  scale: () => frame!.scale,
  renders: () => notation.vexflowRenderCount(),
  viewRenders: () => frame!.view.renderCount,
};

(window as unknown as { frameRig: typeof rig }).frameRig = rig;
