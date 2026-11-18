// Browser entry for the IOS6 e2e spec: a performance-screen skeleton (toolbar, score frame, status line, a Stop
// button) driven by ScoreFrameController and IosViewportController. Exposes `window.iosRig`.
import type { ExcerptDoc, GhostNote, PreparedExcerpt } from '../../src/core/types.ts';
import * as notation from '../../src/notation/index.ts';
import { selectRow } from '../../src/ui/layout-table.ts';
import {
  ScoreFrameController,
  bindNotation,
  contentBox,
  readInsets,
  type FrameLayoutInfo,
} from '../../src/ui/score-frame/index.ts';
import '../../src/ui/tokens.css';
import '../../src/ui/score-frame/score-frame.css';
import { IosViewportController, injectInsets, type Insets4, type ResizeAction } from '../../src/platform/web/ios/viewport.ts';
import { barsExcerpt } from '../notation/score-frame-fixture.ts';

interface MountArgs {
  doc: ExcerptDoc;
  bars: number;
  bpm: number;
  insets: Insets4;
  sprite: string;
}

let frame: ScoreFrameController | null = null;
let vc: IosViewportController | null = null;
let excerpt: PreparedExcerpt | null = null;
let info: FrameLayoutInfo | null = null;
let bpm = 120;
let restartCalls = 0;
let actions: ResizeAction[] = [];
let detach: (() => void) | null = null;

function chrome(): void {
  const row = selectRow(window.innerWidth, window.innerHeight);
  const rs = document.documentElement.style;
  rs.setProperty('--toolbar-h', `${row.toolbarPx}px`);
  rs.setProperty('--status-h', `${row.statusLinePx}px`);
}

const rig = {
  async mount(a: MountArgs): Promise<{ info: FrameLayoutInfo; renders: number }> {
    detach?.();
    const host = document.getElementById('frame-root')!;
    host.replaceChildren();
    injectInsets(document.documentElement, a.insets);
    chrome();
    if (!document.getElementById('sprite')) {
      const holder = document.createElement('div');
      holder.id = 'sprite';
      holder.hidden = true;
      holder.innerHTML = a.sprite;
      document.body.appendChild(holder);
    }
    const sfHost = document.createElement('div');
    sfHost.className = 'sf-host';
    host.appendChild(sfHost);
    const n = bindNotation(notation);
    frame = new ScoreFrameController(sfHost, n);
    excerpt = barsExcerpt(a.doc, a.bars);
    bpm = a.bpm;
    restartCalls = 0;
    actions = [];
    const measure = () => ({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      insets: readInsets(sfHost),
      box: contentBox(sfHost),
    });
    // Initial layout through the same measure the controller uses.
    const m = measure();
    info = frame.layout(excerpt, { viewport: m.viewport, insets: m.insets, widthPx: m.box.width, bpm }, n.tickablesPerBar(excerpt));
    const origRelayout = frame.relayout.bind(frame);
    vc = new IosViewportController({
      frame: {
        get frozen() {
          return frame!.frozen;
        },
        freeze: (b) => frame!.freeze(b),
        unfreeze: () => frame!.unfreeze(),
        resize: (b) => frame!.resize(b),
        relayout: (args) => {
          info = origRelayout(args) ?? info;
          return info;
        },
      },
      measure,
      onRestartCountIn: () => {
        restartCalls++;
      },
      onResizeAction: (x) => actions.push(x),
    });
    vc.handleResize();
    detach = vc.attach(window);
    await n.ensureNotationFonts();
    sfHost.setAttribute('data-ready', 'true');
    return { info: rig.info(), renders: notation.vexflowRenderCount() };
  },
  info(): FrameLayoutInfo {
    const i = info!;
    return { ...i, layout: { systems: i.layout.systems } } as unknown as FrameLayoutInfo;
  },
  phase: (p: 'idle' | 'countIn' | 'performing') => vc!.setPhase(p),
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
  spans: () => info!.spans,
  restarts: () => restartCalls,
  controllerRestarts: () => vc!.countInRestarts,
  actions: () => actions,
  scale: () => frame!.scale,
  renders: () => notation.vexflowRenderCount(),
};

(window as unknown as { iosRig: typeof rig }).iosRig = rig;
