// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../primitives/test-render.ts';
import { CountInBand } from './CountInBand.tsx';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
});

const cells = (): string[][] =>
  [...document.querySelectorAll('.sf-count-group')].map((g) => [...g.querySelectorAll('.sf-count-cell')].map((c) => c.textContent ?? ''));

describe('CountInBand', () => {
  it('without a pickup, the last bar shows every count and the word comes after the last one', () => {
    m = mount(<CountInBand click={5} beatsPerBar={4} bars={2} title="Come in after 4" detail="" entry="Sing" />);
    expect(cells()).toEqual([['1', '2', '3', '4'], ['1', '2', '3', '4']]);
  });

  it('a pickup ends the last bar at the count the title names; "Sing" waits for the music (PLAN R70)', () => {
    m = mount(<CountInBand click={7} beatsPerBar={4} bars={2} title="Come in after 3" detail="" entry="Sing" entryAfter={3} />);
    expect(cells()).toEqual([['1', '2', '3', '4'], ['1', '2', '3']]);
    expect(document.querySelector('.sf-count-entry')).toBeNull();
    const groups = document.querySelectorAll('.sf-count-group');
    expect(groups[1]!.querySelector('.sf-count-cell[data-state="current"]')?.textContent).toBe('3');
    m.unmount();
    m = mount(<CountInBand click={7} beatsPerBar={4} bars={2} title="Come in after 3" detail="" entry="Sing" entryAfter={3} go />);
    expect(document.querySelector('.sf-count-entry')?.getAttribute('data-on')).toBe('true');
    expect(document.querySelector('.sf-count-entry .sf-count-word')?.textContent).toBe('Sing');
  });

  /** The entry word in the track, if any. */
  const shownWord = (): string => document.querySelector('.sf-count')?.querySelector('.sf-count-word')?.textContent ?? '';

  it('a one-bar count-in is a plain 1 2 3 4 in one tone, and nothing says "Sing" before the music (PLAN R70)', () => {
    for (let click = 0; click <= 4; click++) {
      m = mount(<CountInBand click={click} beatsPerBar={4} bars={1} title="Count-in: listen to the beat" detail="" entry="Sing" />);
      expect(cells()).toEqual([['1', '2', '3', '4']]);
      expect(document.querySelector('.sf-count-group')!.getAttribute('data-tone')).toBe('listen');
      expect(document.querySelector('.sf-count')!.hasAttribute('data-last')).toBe(false);
      expect(shownWord(), `click ${click}`).toBe('');
      expect(document.querySelector('.sf-count')!.textContent).not.toContain('Sing');
      m.unmount();
    }
    m = mount(<CountInBand click={4} beatsPerBar={4} bars={1} title="Count-in: listen to the beat" detail="" entry="Sing" go />);
    expect(shownWord()).toBe('Sing');
    expect(document.querySelector('.sf-count')!.getAttribute('data-go')).toBe('true');
  });
});
