/**
 * Screen text for History (D10). Strings come from the copy catalogue (04 section 10); the ones the frozen catalogue
 * does not hold yet are in `PENDING_COPY`, which `text()` falls back to.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type HistoryTextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: HistoryTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
