/**
 * Review text (04 section 6.5, 8.3). Every string comes from the copy catalogue through the results screen's `text()`.
 * The strings review needs that the frozen catalogue does not hold yet are listed here under the key they should get;
 * `rtext()` uses the catalogue entry as soon as one exists. The list is reported to the copy owner, so nothing here is
 * a permanent literal.
 */
import { copy, formatMessage, isCopyKey, type CopyVars } from '../../../../ui/copy/copy.ts';
import { text, type TextKey } from '../text.ts';

export const REVIEW_PENDING_COPY = {
  'review.label': 'Your take, marked',
  'review.toolbar': 'Review',
  'review.filter.timing': 'Showing slips: early or late',
  'review.filter.pitch': 'Showing slips: out of tune',
  'review.filter.wrong': 'Showing slips: wrong notes',
  'review.filter.missed': 'Showing slips: missed',
  'review.filter.extra': 'Showing slips: extra notes',
  'review.filter.correct': 'Showing: right notes',
  'review.filter.rejudged': 'Showing: notes re-judged after the take',
  'review.slipCount': '{n} of {total}',
  'review.noSlips': 'No slips to step through.',
  'review.onTime': 'on time',
  'review.notPlayed': 'Not played',
  'review.verdict.late': 'Late',
  'review.verdict.early': 'Early',
  'review.marginalEarly': 'On time, {ms} ms early (a little credit lost)',
  'review.marginalPlain': 'On time (a little credit lost)',
  'review.voiceOctaveHigher': 'Sung an octave higher (counts as right)',
  'review.extraLocation': 'Played at bar {bar}, beat {beat}',
  'review.a11y.ms': '{ms} milliseconds {verdict}',
  'review.a11y.missed': 'Bar {bar}, beat {beat}, written {written} {value} note, missed',
  'review.a11y.extra': 'Bar {bar}, beat {beat}, you played {played}, {verdict}',
  'review.inspector.label': 'Note details',
  'review.accidental.doubleSharp': 'double sharp',
  'review.accidental.doubleFlat': 'double flat',
  'review.value.whole': 'whole',
  'review.value.dottedHalf': 'dotted half',
  'review.value.half': 'half',
  'review.value.dottedQuarter': 'dotted quarter',
  'review.value.quarter': 'quarter',
  'review.value.tripletQuarter': 'triplet quarter',
  'review.value.dottedEighth': 'dotted eighth',
  'review.value.eighth': 'eighth',
  'review.value.tripletEighth': 'triplet eighth',
  'review.value.dottedSixteenth': 'dotted sixteenth',
  'review.value.sixteenth': 'sixteenth',
  'review.value.tripletSixteenth': 'triplet sixteenth',
  'review.value.thirtySecond': '32nd',
  'review.value.tied': 'tied',
} as const;

export type ReviewPendingKey = keyof typeof REVIEW_PENDING_COPY;
export type ReviewTextKey = TextKey | ReviewPendingKey;

/** Copy by key: the catalogue when it has the key, else the results screen's pending text, else review's. */
export function rtext(key: ReviewTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  if (key in REVIEW_PENDING_COPY) return formatMessage(REVIEW_PENDING_COPY[key as ReviewPendingKey], vars);
  return text(key as TextKey, vars);
}

/** Sentence case for a verdict word that starts a line ("wrong note" → "Wrong note"). */
export function sentence(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
