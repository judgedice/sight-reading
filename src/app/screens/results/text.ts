/**
 * Screen text for D8a and D9. Every string comes from the copy catalogue (04 section 10). The few strings these
 * screens need that the frozen catalogue does not yet hold are listed in `PENDING_COPY` under the key they should
 * get; `text()` uses the catalogue entry as soon as one exists and the pending text until then. The list is
 * reported to the copy owner in the package report, so nothing here is a permanent literal.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {
  'results.tipPreview': 'Tip: {headline}',
  'results.xp.details': 'Details',
  'results.xp.factor.tempo': 'Tempo ×{value}',
  'results.xp.factor.countInOnly': 'Count-in only ×{value}',
  'results.xp.factor.random': 'Random settings ×{value}',
  'results.xp.factor.generic': '{label} ×{value}',
  'results.loading': 'Looking for that attempt…',
  'results.notFound': "We couldn't find that attempt.",
  'results.header.back': 'Home',
  'results.header.corpusAdapted': 'Adapted',
  'results.level.stay': 'Stay at {level}',
  'tips.dimension.notes': 'Notes',
  'tips.dimension.in-tune': 'In tune',
  'tips.dimension.rhythm': 'Rhythm',
  'tips.dimension.flow': 'Flow',
  'tips.dimension.none': 'Clean read',
  'tips.noTips': 'No tips this time. Keep reading.',
  'tips.showBetween': 'Show tips between exercises',
  'rankup.next': 'Next: {rank}, at {xp} XP and level {level} on any instrument.',
  'rankup.top': "That's the top rank.",
  'summary.title': 'Session summary',
  'summary.takes': '{n, plural, one {# take} other {# takes}}',
  'summary.average': 'Average score {score}',
  'summary.xp': '+{xp} XP',
  'summary.best': 'Best take: {score}, {title}',
  'summary.patterns': 'Most common slips',
  'summary.pattern': '{pattern}, {n, plural, one {# time} other {# times}}',
  'summary.streak': 'Streak {days, plural, one {# day} other {# days}}',
  'summary.streak.none': 'No streak yet. A streak day needs 3 ranked takes.',
  'summary.empty': 'No takes in this session yet.',
  'stop.restart.title': 'Restart the count-in?',
  'skip.title': 'Skip this one? It counts as seen.',
  'install.title': 'Add to Home Screen',
} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type TextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: TextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
