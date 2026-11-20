// @vitest-environment jsdom
// Note colours (PLAN R69): the pitch-to-colour mapping, and the letter the renderer tags each written note with.
import { describe, expect, it } from 'vitest';
import type { Alter, SpelledPitch, Step } from '../core/types.ts';
import { planLayout } from '../ui/layout-table.ts';
import { tickablesPerBar } from './render-excerpt.ts';
import { headColour, NOTE_LETTERS, noteLetter } from './note-colours.ts';
import { VexScoreView } from './score-view.ts';
import { fixtureDoc, golden, goldenFiles } from './testing/corpus-node.ts';
import { preparedFromGolden } from './testing/prepared.ts';

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

describe('noteLetter', () => {
  it('maps each of the seven letters to its own colour token, in the key order C to B', () => {
    expect(STEPS.map((step) => noteLetter({ step }))).toEqual(['c', 'd', 'e', 'f', 'g', 'a', 'b']);
    expect(NOTE_LETTERS).toEqual(['c', 'd', 'e', 'f', 'g', 'a', 'b']);
    expect(new Set(NOTE_LETTERS.map(headColour)).size).toBe(7);
    expect(headColour('c')).toBe('var(--head-c)');
    expect(headColour('b')).toBe('var(--head-b)');
  });

  it('keeps the letter colour for sharps, flats, double accidentals and every octave', () => {
    const alters: Alter[] = [-2, -1, 0, 1, 2];
    for (const step of STEPS) {
      for (const alter of alters) {
        for (const octave of [1, 3, 4, 6]) {
          const p: SpelledPitch = { step, alter, octave };
          expect(noteLetter(p), `${step}${alter} ${octave}`).toBe(step.toLowerCase());
        }
      }
    }
    // F sharp is green like F, B flat pink like B: colour by name as written, not by sounding key.
    const fSharp: SpelledPitch = { step: 'F', alter: 1, octave: 4 };
    const bFlat: SpelledPitch = { step: 'B', alter: -1, octave: 3 };
    expect(noteLetter(fSharp)).toBe('f');
    expect(noteLetter(bFlat)).toBe('b');
  });
});

describe('the rendered score carries each written note’s letter', () => {
  it('tags a B♭ clarinet part with its written letters, not the concert ones', () => {
    const file = goldenFiles().find((f) => f.endsWith('.clarinet-bb.json'))!;
    const g = golden(file);
    const p = preparedFromGolden(fixtureDoc(g.excerptId), g);
    const el = document.createElement('div');
    const view = new VexScoreView();
    view.render(p, el, planLayout({ width: 1280, height: 800 }, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p)).renderOptions);
    let differs = 0;
    for (const m of p.measures) {
      for (const e of m.events) {
        const groups = [...el.querySelectorAll(`[data-event-id="${e.id}"]`)];
        expect(groups.length, e.id).toBeGreaterThan(0);
        for (const grp of groups) {
          if (e.kind === 'rest') expect(grp.hasAttribute('data-letter'), e.id).toBe(false);
          else expect(grp.getAttribute('data-letter'), e.id).toBe(e.writtenPitch.step.toLowerCase());
        }
        if (e.kind === 'note' && e.writtenPitch.step !== e.concertPitch.step) differs++;
      }
    }
    // A B♭ clarinet is written a tone above concert, so the letters differ from the sounding ones.
    expect(differs).toBeGreaterThan(0);
  });

  it('draws the head as the notehead group’s own text, apart from stems and accidentals', () => {
    const file = goldenFiles()[0]!;
    const g = golden(file);
    const p = preparedFromGolden(fixtureDoc(g.excerptId), g);
    const el = document.createElement('div');
    new VexScoreView().render(p, el, planLayout({ width: 1280, height: 800 }, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p)).renderOptions);
    const note = el.querySelector('.sr-note[data-letter]')!;
    const heads = note.querySelectorAll('.vf-notehead > text:first-child');
    expect(heads.length).toBeGreaterThan(0);
    // VexFlow draws a note's dots and articulations inside the notehead group after the head: the head is the first text.
    const all = [...el.querySelectorAll('.vf-notehead')];
    const withModifier = all.find((h) => h.querySelectorAll(':scope > text').length > 1);
    if (withModifier) expect(withModifier.firstElementChild?.tagName.toLowerCase()).toBe('text');
    // The stem is not inside the notehead group, so note-colours.css never reaches it.
    for (const stem of note.querySelectorAll('.vf-stem')) expect(stem.closest('.vf-notehead')).toBeNull();
    for (const acc of note.querySelectorAll('.vf-accidental')) expect(acc.parentElement?.classList.contains('vf-notehead')).toBe(false);
  });
});
