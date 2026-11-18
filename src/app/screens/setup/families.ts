import type { Family } from '../../../core/types.ts';

/** Group headings of the instrument select (04 section 5.2), in display order. Not in the copy catalogue. */
export const FAMILY_ORDER: readonly { family: Family; label: string }[] = [
  { family: 'voice', label: 'Voice' },
  { family: 'flute', label: 'Flutes' },
  { family: 'double-reed', label: 'Double reeds' },
  { family: 'clarinet', label: 'Clarinets' },
  { family: 'sax', label: 'Saxophones' },
  { family: 'high-brass', label: 'Trumpet and horn' },
  { family: 'low-brass', label: 'Low brass' },
  { family: 'upper-strings', label: 'Violin and viola' },
  { family: 'low-strings', label: 'Cello and bass' },
  { family: 'keyboard', label: 'Piano' },
  { family: 'guitar', label: 'Guitar' },
];
