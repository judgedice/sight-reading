/**
 * Screen text for the source sheet and credits page (D11). Strings come from the copy catalogue (04 section 10); the
 * ones the frozen catalogue does not hold yet are in `PENDING_COPY`, which `text()` falls back to.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {
  'source.open': 'About this music',
  'source.bars': 'Bars {a}–{b}',
  'source.loading': 'Loading credits…',
  'source.unavailable': 'Credit details for this work aren\'t on this device.',
  'licence.PD': 'Public domain',
  'licence.CC0-1.0': 'CC0 1.0 (public domain dedication)',
  'licence.CC-BY-4.0': 'CC BY 4.0',
  'change.excerpted': 'excerpted',
  'change.grace-removed': 'grace notes removed',
  'change.ornament-removed': 'ornaments removed',
  'change.fermata-removed': 'fermatas removed',
  'change.lyrics-removed': 'lyrics removed',
  'change.rhythm-augmented-x2': 'note values doubled',
  'change.final-bar-completed': 'final bar completed',
  'change.transposed': 'transposed',
  'change.octave-displaced': 'octave displaced',
  'credits.intro': 'Sightread plays public-domain and openly licensed scores from these collections.',
  'credits.collections': 'Collections',
  'credits.collection.licences': 'Licences: {licences}',
  'credits.works': 'Works that need attribution',
  'credits.works.none': 'No work on this device needs individual attribution.',
  'credits.work.by': 'By {creator}',
  'credits.work.changes': 'Modified: {changes}.',
  'credits.link.source': 'Source',
  'credits.link.licence': 'Licence text',
  'credits.rightsProblem.subject': 'Rights problem in Sightread',
  'credits.back': 'Settings',
} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type AboutTextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: AboutTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
