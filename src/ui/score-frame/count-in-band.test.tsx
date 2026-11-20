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

  it('a pickup ends the last bar at the count the title names, so "Sing" follows that count', () => {
    m = mount(<CountInBand click={7} beatsPerBar={4} bars={2} title="Come in after 3" detail="" entry="Sing" entryAfter={3} />);
    expect(cells()).toEqual([['1', '2', '3', '4'], ['1', '2', '3']]);
    expect(document.querySelector('.sf-count-entry')?.getAttribute('data-on')).toBe('true');
    const groups = document.querySelectorAll('.sf-count-group');
    expect(groups[1]!.querySelector('.sf-count-cell[data-state="current"]')?.textContent).toBe('3');
  });
});
