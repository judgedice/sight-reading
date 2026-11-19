// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import grading from '../../../../config/grading-config.json';
import instruments from '../../../../config/instruments.json';
import budget from '../../../../config/measurement-budget.json';
import levels from '../../../../config/levels.json';
import progression from '../../../../config/progression.json';
import tips from '../../../../config/tips.json';
import trumpetValves from '../../../../data/trumpet-valves.json';
import type { RawConfigs } from '../../../core/types.ts';
import { loadConfigs } from '../../../rules/load-configs.ts';
import { getInstrument } from '../../../instruments/index.ts';
import { keyboardSpan, pictureNotes, rangeModel, staffPlan } from '../../../instruments/range.ts';
import { instrumentName } from '../../copy/instrument-names.ts';
import { click, mount, type Mounted } from '../../primitives/test-render.ts';
import { RangePicture } from './RangePicture.tsx';
import { RulerBar, rulerPercent } from './RulerBar.tsx';
import { keyBoxes } from './KeyboardStrip.tsx';
import { staffGeometry } from './RangeStaff.tsx';
import { shortTranspositionText, splitRangeText } from './range-text.ts';
import type { RangeData } from './types.ts';

const cfg = loadConfigs({ grading, levels, instruments, progression, tips, budget, trumpetValves } as unknown as RawConfigs);

/** The app's recipe: the range model, its staff plan and keyboard span at one difficulty. */
function dataFor(id: string, level = 2): RangeData {
  const inst = getInstrument(cfg, id);
  const model = rangeModel(cfg, inst, level);
  return { model, staff: staffPlan(inst, pictureNotes(model)), keyboard: keyboardSpan(model, inst) };
}

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

const all = <T extends Element>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));
const one = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`no ${sel}`);
  return el;
};

function picture(id: string, level = 2, extra: Partial<Parameters<typeof RangePicture>[0]> = {}) {
  const onHearNote = vi.fn();
  current = mount(
    <RangePicture data={dataFor(id, level)} instrumentName={instrumentName(getInstrument(cfg, id))} onHearNote={onHearNote} {...extra} />,
  );
  return onHearNote;
}

describe('RulerBar', () => {
  it('places sounding pitch on the shared C1 to C8 axis', () => {
    expect(rulerPercent(24)).toBe(0);
    expect(rulerPercent(108)).toBe(100);
    expect(rulerPercent(60)).toBeCloseTo(42.86, 2);
    expect(rulerPercent(10)).toBe(0);
    expect(rulerPercent(120)).toBe(100);
  });

  it('draws the full band, the served band and middle C, all hidden from assistive tech', () => {
    current = mount(<RulerBar full={[43, 67]} served={[48, 60]} />);
    const bar = one('[data-testid="ruler-bar"]');
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(one<HTMLElement>('[data-testid="ruler-full"]').style.left).toBe(`${rulerPercent(43)}%`);
    expect(one<HTMLElement>('[data-testid="ruler-served"]').style.left).toBe(`${rulerPercent(48)}%`);
    expect(all('.rp-ruler-tick')).toHaveLength(7);
    expect(all('.rp-ruler-middle-c')).toHaveLength(1);
  });

  it('leaves the served band out while it is not known', () => {
    current = mount(<RulerBar full={[43, 67]} />);
    expect(all('[data-testid="ruler-served"]')).toHaveLength(0);
  });
});

describe('RangePicture, large', () => {
  it('is a figure whose caption carries range.a11y', () => {
    picture('voice-baritone');
    const fig = one('figure[data-testid="range-picture"]');
    const caption = fig.querySelector('figcaption');
    expect(caption).not.toBeNull();
    expect(one('[data-testid="range-a11y"]').textContent).toBe('Baritone voice range: G2 to G4. At difficulty 2: C3 to C4.');
    expect(one('[data-testid="range-staff"]').getAttribute('aria-hidden')).toBe('true');
    expect(one('[data-testid="keyboard-strip"]').getAttribute('aria-hidden')).toBe('true');
  });

  it('has four note buttons named "Hear …", in drawing order', () => {
    picture('voice-baritone');
    const names = all<HTMLButtonElement>('button.rp-note-pill').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Hear G2', 'Hear C3', 'Hear C4', 'Hear G4']);
  });

  it('note buttons call onHearNote with the sounding pitch', () => {
    const baritone = picture('voice-baritone');
    click(one('button[aria-label="Hear C3"]'));
    expect(baritone).toHaveBeenLastCalledWith(48);
    current?.unmount();

    // Tenor reads treble-8vb: the button says the sung A2 and plays MIDI 45.
    const tenor = picture('voice-tenor');
    click(one('button[aria-label="Hear A2"]'));
    expect(tenor).toHaveBeenLastCalledWith(45);
    current?.unmount();

    // Clarinet in B♭: written E3 (52) sounds D3 (50).
    const clarinet = picture('clarinet-bb');
    click(one('button[aria-label="Hear E3"]'));
    expect(clarinet).toHaveBeenLastCalledWith(50);
  });

  it('shows the legend lines and the voice line, values set apart for the bold weight', () => {
    picture('voice-baritone');
    const lines = all('.rp-legend-line').map((l) => l.textContent);
    expect(lines).toEqual(['Full range: G2 to G4', 'At difficulty 2: C3 to C4']);
    expect(all('.rp-legend-line b').map((b) => b.textContent)).toEqual(['G2 to G4', 'C3 to C4']);
    expect(one('.rp-legend-note').textContent).toBe('Sing in any octave that suits you. Pitch is marked relative to your starting note.');
  });

  it('gives transposing instruments the concert line', () => {
    picture('clarinet-bb');
    expect(all('.rp-legend-note').map((p) => p.textContent)).toEqual(['Sounds a major 2nd lower: concert D3 to F6']);
  });

  it('draws a clef change for the cello A5 and an octave mark when no higher clef exists', () => {
    picture('cello', 10);
    expect(all('[data-testid="range-clef-change"]')).toHaveLength(1);
    current?.unmount();
    picture('piano-rh', 10);
    expect(all('[data-testid="range-octave-mark"]').length).toBeGreaterThan(0);
  });

  it('keeps the picture inside its box when a note carries an octave mark', () => {
    for (const id of ['piano-rh', 'tuba', 'cello', 'voice-baritone']) {
      const d = dataFor(id, 10);
      const g = staffGeometry(d.staff);
      expect(g.mid).toBeGreaterThan(0);
      expect(g.height).toBeGreaterThan(g.mid);
    }
  });

  it('moves the served notes when the difficulty changes', () => {
    const data2 = dataFor('voice-baritone', 2);
    const data9 = dataFor('voice-baritone', 9);
    current = mount(<RangePicture data={data2} instrumentName="Baritone voice" />);
    const before = one<SVGGElement>('[data-testid="range-note-1"]').style.transform;
    current.render(<RangePicture data={data9} instrumentName="Baritone voice" />);
    const after = one<SVGGElement>('[data-testid="range-note-1"]').style.transform;
    expect(before).not.toBe(after);
    expect(one('[data-testid="range-a11y"]').textContent).toBe('Baritone voice range: G2 to G4. At difficulty 9: G2 to G4.');
  });

  it('leaves out the keyboard and the extra lines when asked (phone panel)', () => {
    picture('voice-baritone', 2, { keyboard: false, notes: false, compact: true });
    expect(all('[data-testid="keyboard-strip"]')).toHaveLength(0);
    expect(all('.rp-legend-note')).toHaveLength(0);
    expect(all('button.rp-note-pill')).toHaveLength(4);
  });

  it('shows only the full range while the served range is unknown', () => {
    picture('voice-baritone', 2, { showServed: false });
    expect(all('button.rp-note-pill').map((b) => b.getAttribute('aria-label'))).toEqual(['Hear G2', 'Hear G4']);
    expect(all('[data-testid="range-band"]')).toHaveLength(0);
    expect(all('.rp-legend-line')).toHaveLength(1);
    expect(one('[data-testid="range-a11y"]').textContent).toBe('Full range: G2 to G4');
  });

  it('renders names as text when no player is wired', () => {
    current = mount(<RangePicture data={dataFor('flute')} instrumentName="Flute" />);
    expect(all('button.rp-note-pill')).toHaveLength(0);
    expect(all('.rp-note-pill-static')).toHaveLength(4);
  });
});

describe('RangePicture, bar and line', () => {
  it('bar draws the ruler in sounding pitch', () => {
    current = mount(<RangePicture size="bar" data={dataFor('clarinet-bb')} instrumentName="Clarinet" />);
    expect(one<HTMLElement>('[data-testid="ruler-full"]').style.left).toBe(`${rulerPercent(50)}%`);
  });

  it('line reads "At difficulty 2: C3 to C4"', () => {
    current = mount(<RangePicture size="line" data={dataFor('voice-baritone')} instrumentName="Baritone voice" />);
    expect(one('[data-testid="range-line"]').textContent).toBe('At difficulty 2: C3 to C4');
  });
});

describe('KeyboardStrip', () => {
  it('spans C2 to C5 for voices with full and served brackets and a middle C dot', () => {
    picture('voice-baritone');
    const keys = all<HTMLElement>('.rp-kb-key');
    expect(keys[0]?.dataset['midi']).toBe('36');
    expect(keys[keys.length - 1]?.dataset['midi']).toBe('72');
    expect(keys.find((k) => k.dataset['midi'] === '48')?.dataset['state']).toBe('served');
    expect(keys.find((k) => k.dataset['midi'] === '43')?.dataset['state']).toBe('full');
    expect(keys.find((k) => k.dataset['midi'] === '40')?.dataset['state']).toBe('out');
    expect(all('[data-testid="kb-middle-c"]')).toHaveLength(1);
    expect(all('[data-testid="kb-bracket-full"]')).toHaveLength(1);
    expect(all('[data-testid="kb-bracket-served"]')).toHaveLength(1);
    expect(all('.rp-kb-labels span').map((s) => s.textContent)).toEqual(['C2', 'C3', 'C4', 'C5']);
  });

  it('lays white keys edge to edge and black keys across the boundary', () => {
    const boxes = keyBoxes(36, 48);
    const whites = boxes.filter((b) => b.white);
    expect(whites).toHaveLength(8);
    expect(whites[0]?.left).toBe(0);
    expect(whites[7]?.right).toBeCloseTo(100, 5);
    const cSharp = boxes.find((b) => b.midi === 37);
    expect(cSharp && (cSharp.left + cSharp.right) / 2).toBeCloseTo(whites[0]!.right, 5);
  });
});

describe('range text', () => {
  it('splits a legend line where its note names start', () => {
    const m = dataFor('voice-baritone').model;
    expect(splitRangeText(m.lines[1]!)).toEqual({ lead: 'At difficulty 2: ', value: 'C3 to C4' });
  });

  it('shortens the transposition line for cards', () => {
    expect(shortTranspositionText(dataFor('clarinet-bb').model.cardNote!)).toBe('Sounds a major 2nd lower');
    expect(shortTranspositionText(dataFor('sax-alto').model.cardNote!)).toBe('Sounds a major 6th lower');
  });
});
