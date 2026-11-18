/**
 * Review text (04 section 6.5, 8.3). Every string comes from the copy catalogue through the results screen's `text()`.
 * The strings review needs that the frozen catalogue does not hold yet are listed here under the key they should get;
 * `rtext()` uses the catalogue entry as soon as one exists. The list is reported to the copy owner, so nothing here is
 * a permanent literal.
 */
import { copy, formatMessage, isCopyKey, type CopyVars } from '../../../../ui/copy/copy.ts';
import { text, type TextKey } from '../text.ts';

export const REVIEW_PENDING_COPY = {} as const;

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
