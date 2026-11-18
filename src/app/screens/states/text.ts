/**
 * Screen text for D4 and D12. Every string comes from the copy catalogue (04 section 10). The few strings these
 * screens need that the frozen catalogue does not yet hold are listed in `PENDING_COPY` under the key they should
 * get; `text()` uses the catalogue entry as soon as one exists and the pending text until then. The list is reported
 * to the copy owner (see the package report), so nothing here is a permanent literal.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {
  'onboarding.family.voice': 'Voice',
  'onboarding.family.woodwinds': 'Woodwinds',
  'onboarding.family.brass': 'Brass',
  'onboarding.family.strings': 'Strings',
  'onboarding.family.keyboard': 'Keyboard',
  'onboarding.instrument.title': 'Choose your instrument',
  'onboarding.instrument.body': 'We pick music in your range and show it as you read it.',
  'onboarding.name.hint': 'Optional. Stays on this device.',
  'onboarding.calibration.title': 'Check your setup',
  'onboarding.level.title': 'Where should we start?',
  'onboarding.level.stepper': 'Starting level',
  'onboarding.mic.granted': 'Microphone is on.',
  'interval.minor2': 'minor 2nd',
  'interval.major2': 'major 2nd',
  'interval.minor3': 'minor 3rd',
  'interval.major3': 'major 3rd',
  'interval.perfect4': 'perfect 4th',
  'interval.perfect5': 'perfect 5th',
  'interval.minor6': 'minor 6th',
  'interval.major6': 'major 6th',
  'interval.minor7': 'minor 7th',
  'interval.major7': 'major 7th',
  'calibrate.title': 'Calibrate',
  'calibrate.listening': 'Listening…',
  'calibrate.dot.pending': 'Click {n} of {total}: waiting',
  'calibrate.dot.heard': 'Click {n} of {total}: heard',
  'calibrate.dot.missed': 'Click {n} of {total}: missed',
  'calibrate.dot.offsetEarly': 'Note {n} of {total}: {ms} ms early',
  'calibrate.dot.offsetLate': 'Note {n} of {total}: {ms} ms late',
  'calibrate.dot.noNote': 'Note {n} of {total}: not heard',
  'calibrate.progress': '{found} of {total} heard',
  'calibrate.fail.playAlong': "We didn't hear enough notes. Play one clear note on each click.",
  'calibrate.fail.error': "The audio check couldn't run. Try again.",
  'calibrate.done': 'Done. Takes can earn XP on this setup.',
  'calibrate.estimateUsed': 'Using an estimate.',
  'calibrate.audibility.link': 'Open Click sound settings',
  'calibrate.selfTest.title': 'Audio check',
  'calibrate.selfTest.running': 'Checking audio…',
  'calibrate.selfTest.pass': 'Pass',
  'calibrate.selfTest.fail': 'Fail',
  'calibrate.selfTest.skipped': 'Skipped',
  'calibrate.selfTest.summaryPass': 'Everything checks out.',
  'calibrate.selfTest.summaryFail': 'Some checks failed. Takes may be practice until they pass.',
  'void.stopped': "You stopped before the first note, so this take wasn't graded.",
  'practise.notice': "Practising without listening. This take won't be graded and earns no XP.",
  'practise.heading': 'Practise without listening',
} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type TextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: TextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
