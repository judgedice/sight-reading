// @vitest-environment jsdom
// Round 2 (04-design §7, §9): "Show what we heard" draws the try's pitch track as a thin grey line, only when the try
// has a stored track; otherwise the switch is disabled and `diagnostics.noTrack` says why. On an Unsure try at the calm
// difficulties, extras and ghosts are drawn at 50%.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AttemptRecord } from '../../../../core/types.ts';
import * as notationModule from '../../../../notation/index.ts';
import { copy } from '../../../../ui/copy/copy.ts';
import { act, mount, type Mounted } from '../../../../ui/primitives/test-render.ts';
import { bindNotation, type FrameNotation } from '../../../../ui/score-frame/index.ts';
import { hasTrack, heardTrace, type HeardTraceSource } from './model.ts';
import { Review } from './Review.tsx';
import { BPM, cfg, reviewFixture, spell, T0 } from './test-fixture.ts';

const bound = bindNotation(notationModule);
const notation: FrameNotation = { ...bound, ensureNotationFonts: () => Promise.resolve() };
const loadNotation = () => Promise.resolve(notation);

const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('sf-host') ? 900 : 0;
    },
  });
});
afterAll(() => {
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
});

const mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.unmount();
  document.body.replaceChildren();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** A frame track at 50 Hz that sings every written note on its pitch, from the fixture's t0. */
function track(): HeardTraceSource {
  const fx = reviewFixture();
  const t: number[] = [];
  const midi: (number | null)[] = [];
  for (const e of fx.expected) {
    for (let s = 0; s < e.durSec * 0.85; s += 0.02) {
      t.push(T0 + e.onsetSec + s);
      midi.push(e.concertMidi);
    }
    t.push(T0 + e.onsetSec + e.durSec * 0.95);
    midi.push(null);
  }
  return { frames: { t, midi }, playback: { t0: T0 } };
}

async function render(o: { loadTrace?: () => Promise<HeardTraceSource | null>; showHeardDefault?: boolean; over?: Partial<AttemptRecord> } = {}) {
  const fx = reviewFixture(o.over ?? {});
  const m = mount(
    <Review
      record={fx.record}
      prepared={fx.prepared}
      expected={fx.expected}
      tolerances={fx.tolerances}
      configs={cfg}
      loadNotation={loadNotation}
      spell={spell}
      viewport={{ width: 1280, height: 720 }}
      insets={{ top: 0, bottom: 0 }}
      reducedMotion={() => true}
      highContrast={() => false}
      {...(o.loadTrace ? { loadTrace: o.loadTrace } : {})}
      {...(o.showHeardDefault !== undefined ? { showHeardDefault: o.showHeardDefault } : {})}
    />,
  );
  mounted.push(m);
  await flush();
  await flush();
  return { fx, root: m.container.querySelector<HTMLElement>('[data-testid="review"]')! };
}

const heardSwitch = (root: HTMLElement) => root.querySelector<HTMLInputElement>('[data-testid="show-heard"] input[role="switch"]')!;

function toggle(input: HTMLInputElement): void {
  act(() => {
    input.click();
  });
}

describe('Show what we heard', () => {
  it('is disabled with diagnostics.noTrack when the try has no stored track, and draws nothing', async () => {
    const { root } = await render({ loadTrace: () => Promise.resolve(null), showHeardDefault: true });
    const sw = heardSwitch(root);
    expect(sw.disabled).toBe(true);
    expect(sw.checked).toBe(false);
    expect(root.querySelector('[data-testid="show-heard-none"]')!.textContent).toBe(copy('diagnostics.noTrack'));
    expect(root.querySelector('[data-testid="show-heard"]')!.getAttribute('title')).toBe(copy('diagnostics.noTrack'));
    // The visible line is the disabled switch's description (no disabled control without a visible reason).
    expect(document.getElementById(sw.getAttribute('aria-describedby') ?? '')?.textContent).toBe(copy('diagnostics.noTrack'));
    expect(root.querySelector('.sr-trace')).toBeNull();
  });

  it('with a trace loader, the switch appears only once the track has loaded', async () => {
    let resolve: (v: null) => void = () => undefined;
    const pending = new Promise<null>((r) => {
      resolve = r;
    });
    const { root } = await render({ loadTrace: () => pending });
    expect(root.querySelector('[data-testid="show-heard"]')).toBeNull();
    await act(async () => {
      resolve(null);
      await pending;
    });
    expect(heardSwitch(root).disabled).toBe(true);
  });

  it('is disabled when the stored trace has no frames (a try from before round 2)', async () => {
    const { root } = await render({ loadTrace: () => Promise.resolve({ frames: null, playback: { t0: T0 } }), showHeardDefault: true });
    expect(heardSwitch(root).disabled).toBe(true);
    expect(root.querySelector('.sr-trace')).toBeNull();
  });

  it('draws the track as a thin grey line behind the ink only once switched on, with the key line', async () => {
    const { root } = await render({ loadTrace: () => Promise.resolve(track()) });
    const sw = heardSwitch(root);
    expect(sw.disabled).toBe(false);
    expect(root.querySelector('.sr-trace')).toBeNull();
    toggle(sw);
    await flush();
    const lines = root.querySelectorAll('.sr-underlay .sr-trace-line');
    expect(lines.length).toBeGreaterThan(5);
    expect(lines[0]!.getAttribute('stroke')).toBe('var(--text-muted)');
    expect(root.getAttribute('data-heard')).toBe('true');
    expect(root.querySelector('[data-testid="show-heard-key"]')!.textContent).toBe(copy('results.showHeard.key'));
    toggle(sw);
    await flush();
    expect(root.querySelector('.sr-trace')).toBeNull();
  });

  it('starts on with "Show what the app hears", and stays on in Clean score', async () => {
    const { root } = await render({ loadTrace: () => Promise.resolve(track()), showHeardDefault: true });
    expect(heardSwitch(root).checked).toBe(true);
    expect(root.querySelectorAll('.sr-trace-line').length).toBeGreaterThan(0);
  });

  it('without a trace loader the switch is disabled and no noTrack line claims the try is old', async () => {
    const { root } = await render();
    expect(heardSwitch(root).disabled).toBe(true);
    expect(root.querySelector('[data-testid="show-heard-none"]')).toBeNull();
  });

  it('places an in-tune held note on its notehead: beats come from the matched notes', () => {
    const fx = reviewFixture();
    const t = heardTrace({ record: fx.record, prepared: fx.prepared, expected: fx.expected, instrument: cfg.instrumentById.flute!, spell, source: track() })!;
    expect(t).not.toBeNull();
    const first = fx.expected[0]!;
    // The first voiced frame is the first note's onset, at its written pitch.
    expect(t.beats[0]).toBeCloseTo(first.onsetBeat, 5);
    expect(t.midi[0]).toBe(first.concertMidi);
    expect(t.spell(first.concertMidi)).toEqual(spell(first.concertMidi, null, fx.prepared.writtenKey, cfg.instrumentById.flute!));
    expect(Math.abs(t.beats[1]! - t.beats[0]! - (0.02 * BPM) / 60)).toBeLessThan(1e-9);
    expect(hasTrack({ frames: { t: [1, 2], midi: [null, null] }, playback: { t0: 0 } })).toBe(false);
    expect(hasTrack(null)).toBe(false);
  });
});

describe('calm marks on an Unsure try (01-ux 15.1)', () => {
  const unsure = (level: number): Partial<AttemptRecord> => {
    const fx = reviewFixture();
    // Half the notes not steady: Unsure.
    return { levelServed: level, detected: fx.record.detected.map((d, i) => ({ ...d, framesAgree: i % 2 === 0 })) };
  };

  it('draws extras and ghosts at 50% at difficulties 1 to 3', async () => {
    const { root } = await render({ over: unsure(cfg.grading.ui.calmLiveUpTo) });
    expect(root.getAttribute('data-calm')).toBe('true');
    expect(root.querySelectorAll('.sr-ghost').length).toBeGreaterThan(0);
  });

  it('not above difficulty 3, and not on a try we heard clearly', async () => {
    const above = await render({ over: unsure(cfg.grading.ui.calmLiveUpTo + 1) });
    expect(above.root.hasAttribute('data-calm')).toBe(false);
    const clear = await render({ over: { levelServed: 1 } });
    expect(clear.root.hasAttribute('data-calm')).toBe(false);
  });
});
