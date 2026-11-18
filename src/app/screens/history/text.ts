/**
 * Screen text for History (D10). Strings come from the copy catalogue (04 section 10); the ones the frozen catalogue
 * does not hold yet are in `PENDING_COPY`, which `text()` falls back to.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {
  'history.filter.all': 'All instruments',
  'history.filter.clear': 'Show all takes',
  'history.loading': 'Loading takes…',
  'history.more': 'Show more takes',
  'history.tempo': '{bpm} bpm',
  'history.notFound': "That take isn't on this device.",
  'history.backToList': 'Back to history',
  'history.error': "Your takes couldn't be read. Reload the page, or export a backup first.",
} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type HistoryTextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: HistoryTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
