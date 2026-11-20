/**
 * The facts of "Look before you play" that have no key in `src/ui/copy/en.json` yet. They are kept together here, in the
 * same wording the copy file takes (04-design section 6), until the copy owner moves them there as `look.fact.*`
 * (reported). Nothing else on the screen is written outside the copy file.
 */
export const LOOK_TEXT = {
  tempo: '{tempo}.',
  accidentalsNone: 'None in the music.',
  accidentalsSome: '{n, plural, one {One note has} other {# notes have}} a sharp, flat or natural.',
  rhythm: 'Busiest bar: bar {bar}, {n, plural, one {one note} other {# notes}}.',
  shape: 'Lowest {low}, highest {high}. Ends on {last}.',
  // One short line each, so a row fits on one line beside its fact (04-design section 6).
  adviceSignatures: 'Say the key, its sharps or flats, and the beats in a bar.',
  adviceTempo: 'Feel one beat. Hear the tempo if you like.',
  adviceAccidentals: 'Find each one. It lasts to the bar line.',
  adviceRhythm: 'Count the busiest bar once in your head.',
  adviceSigns: 'Highest, lowest, big jumps, and the ending.',
} as const;
