// @vitest-environment jsdom
// D3 <ScoreFrame>: lazy notation load (once per loader), layout at reveal, ready after fonts, frozen prop, arrangement
// prop, a frozen resize scales without a render, and viewport changes re-lay out only outside a take.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import * as notationModule from '../../notation/index.ts';
import { fixtureDoc } from '../../notation/testing/corpus-node.ts';
import { act, mount, type Mounted } from '../primitives/test-render.ts';
import { barsExcerpt, FRAME_FIXTURE_ID } from '../../../e2e/notation/score-frame-fixture.ts';
import type { FrameLayoutInfo, ScoreFrameController } from './controller.ts';
import { bindNotation, type FrameNotation } from './notation-binding.ts';
import { ScoreFrame } from './ScoreFrame.tsx';

const mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.unmount();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function loader() {
  const bound = bindNotation(notationModule);
  const fonts = vi.fn(() => Promise.resolve());
  const n: FrameNotation = { ...bound, ensureNotationFonts: fonts };
  const load = vi.fn(() => Promise.resolve(n));
  return { load, fonts };
}

const p12 = () => barsExcerpt(fixtureDoc(FRAME_FIXTURE_ID), 12);
const TAB = { width: 390, height: 660 };
const INSETS = { top: 0, bottom: 34 };

describe('<ScoreFrame>', () => {
  it('loads notation lazily, lays out at reveal, and shows the stage once fonts are ready', async () => {
    const { load, fonts } = loader();
    const ref = createRef<ScoreFrameController | null>();
    const layouts: FrameLayoutInfo[] = [];
    const lines: number[][] = [];
    const excerpt = p12();
    const m = mount(
      <ScoreFrame
        ref={ref}
        loadNotation={load}
        excerpt={excerpt}
        bpm={120}
        viewport={TAB}
        insets={INSETS}
        label="Score"
        onLayout={(i) => layouts.push(i)}
        onSlotsChange={(s) => lines.push(s)}
      />,
    );
    mounted.push(m);
    const host = m.container.querySelector<HTMLElement>('.sf-host')!;
    expect(host.getAttribute('aria-label')).toBe('Score');
    expect(host.querySelector('svg')).toBeNull();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(fonts).toHaveBeenCalled();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.systemCount).toBe(6);
    expect(layouts[0]!.plan.slots).toBe(4);
    expect(host.getAttribute('data-ready')).toBe('true');
    expect(host.querySelectorAll('.sr-slot')).toHaveLength(4);
    expect(ref.current).not.toBeNull();
    expect(lines).toEqual([[0, 1, 2, 3]]);

    // Page turns through the handle.
    ref.current!.setPlayhead(17);
    expect(lines.at(-1)).toEqual([4, 1, 2, 3]);
  });

  it('a second frame with the same loader does not load again', async () => {
    const { load } = loader();
    const a = mount(<ScoreFrame loadNotation={load} excerpt={p12()} bpm={100} viewport={TAB} insets={INSETS} />);
    const b = mount(<ScoreFrame loadNotation={load} excerpt={p12()} bpm={100} viewport={TAB} insets={INSETS} />);
    mounted.push(a, b);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('frozen: viewport changes scale nothing in jsdom but never re-render; unfrozen: they re-lay out', async () => {
    const { load } = loader();
    const ref = createRef<ScoreFrameController | null>();
    const layouts: FrameLayoutInfo[] = [];
    const excerpt = p12();
    const el = (frozen: boolean, viewport: { width: number; height: number }, arrangement: 'slots' | 'all' = 'slots') => (
      <ScoreFrame
        ref={ref}
        loadNotation={load}
        excerpt={excerpt}
        bpm={120}
        viewport={viewport}
        insets={INSETS}
        frozen={frozen}
        arrangement={arrangement}
        onLayout={(i) => layouts.push(i)}
      />
    );
    const m = mount(el(false, TAB, 'all'));
    mounted.push(m);
    await flush();
    const host = m.container.querySelector<HTMLElement>('.sf-host')!;
    expect(host.getAttribute('data-arrangement')).toBe('all');
    expect(host.querySelectorAll('.sr-slot')).toHaveLength(6);

    m.render(el(true, TAB));
    expect(host.getAttribute('data-frozen')).toBe('true');
    expect(host.getAttribute('data-arrangement')).toBe('slots');
    const renders = ref.current!.view.renderCount;
    m.render(el(true, { width: 844, height: 340 }));
    await flush();
    expect(ref.current!.view.renderCount).toBe(renders);
    expect(layouts).toHaveLength(1);

    m.render(el(false, { width: 844, height: 340 }));
    await flush();
    expect(host.hasAttribute('data-frozen')).toBe(false);
    m.render(el(false, { width: 845, height: 340 }));
    await flush();
    expect(layouts.length).toBeGreaterThanOrEqual(2);
    expect(layouts.at(-1)!.plan.row.id).toBe('sm-short');
  });

  it('reports a loader failure', async () => {
    const onError = vi.fn();
    const load = vi.fn(() => Promise.reject(new Error('chunk failed')));
    const m = mount(<ScoreFrame loadNotation={load} excerpt={p12()} bpm={120} onError={onError} />);
    mounted.push(m);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'chunk failed' }));
  });
});
