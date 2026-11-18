/**
 * Screen text for the progress screen (D10). Every string comes from the copy catalogue (04 section 10). Strings the
 * frozen catalogue does not yet hold are listed in `PENDING_COPY` under the key they should get; `text()` uses the
 * catalogue entry as soon as one exists and the pending text until then.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type ProgressTextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: ProgressTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
