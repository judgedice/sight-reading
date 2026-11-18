// Browser entry for the notation e2e specs (bundled by page.ts). Exposes `window.notation`.
import type { Clef, ExcerptDoc } from '../../src/core/types.ts';
import { ensureNotationFonts, VexScoreView, tickablesPerBar, vexflowRenderCount } from '../../src/notation/index.ts';
import { preparedFromDoc } from '../../src/notation/testing/prepared.ts';
import { planLayout } from '../../src/ui/layout-table.ts';

const view = new VexScoreView();

function render(doc: ExcerptDoc, clef: Clef, viewport: { width: number; height: number }) {
  const p = preparedFromDoc(doc, clef);
  const plan = planLayout(viewport, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p));
  const el = document.getElementById('score')!;
  el.style.width = `${plan.renderOptions.widthPx}px`;
  const t0 = performance.now();
  const layout = view.render(p, el, plan.renderOptions);
  const ms = performance.now() - t0;
  return { p, plan, layout, ms };
}

const api = {
  ready: () => ensureNotationFonts(),
  view,
  render,
  renderCount: () => vexflowRenderCount(),
  preparedFromDoc,
  planLayout,
  tickablesPerBar,
};
(window as unknown as { notation: typeof api }).notation = api;
