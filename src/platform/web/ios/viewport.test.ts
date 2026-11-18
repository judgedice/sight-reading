import { describe, expect, it } from 'vitest';
import {
  IOS_VIEWPORTS,
  IosViewportController,
  minEdgeDistance,
  injectInsets,
  type Box,
  type FrozenFrameLike,
  type ResizeAction,
  type ViewportMeasure,
} from './viewport.ts';

class FakeFrame implements FrozenFrameLike {
  frozenBox: Box | null = null;
  log: string[] = [];
  get frozen(): boolean {
    return this.frozenBox !== null;
  }
  freeze(box: Box): void {
    this.frozenBox = box;
    this.log.push('freeze');
  }
  unfreeze(): void {
    this.frozenBox = null;
    this.log.push('unfreeze');
  }
  resize(box: Box) {
    if (!this.frozenBox) return null;
    const f = this.frozenBox;
    this.log.push('scale');
    return { scale: Math.min(box.width / f.width, box.height / f.height), orientationChanged: f.width > f.height !== box.width > box.height };
  }
  relayout(): unknown {
    if (this.frozenBox) throw new Error('relayout while frozen');
    this.log.push('relayout');
    return null;
  }
}

function rig() {
  const frame = new FakeFrame();
  let size: Box = { width: 390, height: 844 };
  let restarts = 0;
  const actions: ResizeAction[] = [];
  const measure = (): ViewportMeasure => ({ viewport: size, insets: { top: 47, bottom: 34 }, box: size });
  const c = new IosViewportController({ frame, measure, onRestartCountIn: () => restarts++, onResizeAction: (a) => actions.push(a) });
  return { frame, c, actions, resize: (b: Box) => (size = b), restarts: () => restarts };
}

describe('IosViewportController', () => {
  it('re-lays out freely outside a take and skips an unchanged size', () => {
    const r = rig();
    expect(r.c.handleResize()).toBe('relayout');
    expect(r.c.handleResize()).toBe('none');
    r.resize({ width: 844, height: 390 });
    expect(r.c.handleResize()).toBe('relayout');
  });

  it('freezes at count-in start and only scales for a same-orientation resize', () => {
    const r = rig();
    r.c.handleResize();
    r.c.setPhase('countIn');
    r.resize({ width: 390, height: 700 });
    expect(r.c.handleResize()).toBe('scale');
    r.c.setPhase('performing');
    r.resize({ width: 390, height: 650 });
    expect(r.c.handleResize()).toBe('scale');
    expect(r.frame.log.filter((l) => l === 'relayout')).toHaveLength(1);
    expect(r.restarts()).toBe(0);
  });

  it('a rotation during the count-in re-lays out and restarts it once, however many events follow', () => {
    const r = rig();
    r.c.handleResize();
    r.c.setPhase('countIn');
    r.resize({ width: 844, height: 390 });
    expect(r.c.handleResize()).toBe('rotate-restart');
    expect(r.c.handleResize()).toBe('scale');
    expect(r.c.handleResize()).toBe('scale');
    expect(r.restarts()).toBe(1);
    expect(r.frame.frozen).toBe(true);
    expect(r.frame.frozenBox).toEqual({ width: 844, height: 390 });
  });

  it('a rotation while performing scales and never re-lays out or restarts', () => {
    const r = rig();
    r.c.handleResize();
    r.c.setPhase('countIn');
    r.c.setPhase('performing');
    r.resize({ width: 844, height: 390 });
    expect(r.c.handleResize()).toBe('scale');
    expect(r.restarts()).toBe(0);
    expect(r.frame.log.filter((l) => l === 'relayout')).toHaveLength(1);
  });

  it('end of take unfreezes and re-lays out for the size the window has now', () => {
    const r = rig();
    r.c.handleResize();
    r.c.setPhase('countIn');
    r.resize({ width: 844, height: 390 });
    r.c.setPhase('idle');
    expect(r.frame.frozen).toBe(false);
    expect(r.frame.log.at(-1)).toBe('relayout');
  });
});

describe('constants and helpers', () => {
  it('lists V1 to V7 as in 05 section 7', () => {
    expect(IOS_VIEWPORTS.map((v) => [v.id, v.width, v.height])).toEqual([
      ['V1', 390, 844],
      ['V2', 390, 660],
      ['V3', 375, 553],
      ['V4', 844, 340],
      ['V5', 844, 390],
      ['V6', 1180, 760],
      ['V7', 1024, 1366],
    ]);
    expect(IOS_VIEWPORTS[3]!.insets).toEqual({ top: 0, right: 47, bottom: 21, left: 47 });
  });
  it('edge distance is inset plus 8', () => {
    expect(minEdgeDistance(34)).toBe(42);
    expect(minEdgeDistance(0)).toBe(8);
  });
  it('injects the --test-sai variables', () => {
    const el = { style: new Map<string, string>() };
    const root = { style: { setProperty: (k: string, v: string) => el.style.set(k, v) } } as unknown as HTMLElement;
    injectInsets(root, { top: 1, right: 2, bottom: 3, left: 4 });
    expect([...el.style.entries()]).toEqual([
      ['--test-sai-top', '1px'],
      ['--test-sai-right', '2px'],
      ['--test-sai-bottom', '3px'],
      ['--test-sai-left', '4px'],
    ]);
  });
});
