/**
 * Screen text for the progress screen (D10). Every string comes from the copy catalogue (04 section 10). Strings the
 * frozen catalogue does not yet hold are listed in `PENDING_COPY` under the key they should get; `text()` uses the
 * catalogue entry as soon as one exists and the pending text until then.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {
  'progress.ladder.label': 'Rank ladder',
  'progress.ladder.current': 'Current rank',
  'progress.ladder.achieved': 'Reached',
  'progress.ladder.future': '{xp} XP, level {level}',
  'progress.streak.title': 'Streak',
  'progress.streak.days': '{n, plural, one {# day} other {# days}}',
  'progress.streak.none': 'No streak yet.',
  'progress.best': 'Best at level {level}: {score}',
  'progress.attempts': '{n, plural, one {# ranked take} other {# ranked takes}}',
  'progress.window.label': 'Last ranked takes at this level',
  'progress.window.empty': 'Not yet played',
  'progress.window.midTempo': 'At mid tempo',
  'progress.slips.times': '{n, plural, one {# time} other {# times}}',
  'progress.instruments.title': 'Instruments',
  'progress.instruments.none': 'No instrument played yet.',
  'progress.level.best': 'Best scores',
  'progress.xp': '{xp} XP',
} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type ProgressTextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: ProgressTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
