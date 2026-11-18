/**
 * Screen text for Settings (D11). Strings come from the copy catalogue (04 section 10); the ones the frozen catalogue
 * does not hold yet are in `PENDING_COPY`, which `text()` falls back to.
 */
import { copy, formatMessage, isCopyKey, type CopyKey, type CopyVars } from '../../../ui/copy/copy.ts';

export const PENDING_COPY = {
  'settings.profile.none': 'Your profile is created when you finish setup.',
  'settings.profile.hint': 'Up to 40 characters. Shown on your progress and history.',
  'settings.audio.defaultDevice': 'System default',
  'settings.audio.calibrated': 'Calibrated {date} ({method})',
  'settings.audio.notCalibrated': 'Not calibrated on this device yet. Takes earn XP after you calibrate.',
  'settings.audio.method.loopback': 'clicks timed',
  'settings.audio.method.play-along': 'played along',
  'settings.audio.method.reported': 'reported by the device',
  'settings.audio.volumeValue': '{n} of 100',
  'settings.data.size.kb': '{n} KB',
  'settings.data.size.mb': '{n} MB',
  'settings.data.exportFailed': "The export didn't work. Try again.",
  'settings.data.importTitle': 'Import a backup?',
  'settings.data.importBody': "This replaces the takes, profile and settings on this device with the backup's. It can't be undone.",
  'settings.data.importNewer': 'This backup came from a newer version of Sightread. Update the app, then import it again.',
  'settings.data.importFailed': "The import didn't finish. Your data is unchanged.",
  'settings.data.deleteTitle': 'Delete all data?',
  'settings.data.deleteBody': 'This erases every take, your profile and your settings from this device. Export a backup first to keep them.',
  'settings.data.deleteHint': 'Type delete to confirm.',
  'settings.data.deleteConfirm': 'Delete everything',
  'settings.data.deleted': 'All data on this device was deleted.',
  'settings.data.deleteFailed': "The data couldn't be deleted. Try again.",
  'settings.data.offline': 'Download all music for offline use',
  'settings.data.offlineFailed': "Music couldn't be downloaded. Check your connection and try again.",
  'settings.nav.profile': 'Profile',
  'settings.placement.hint': 'Plays three short excerpts to find your level again.',
  'action.cancel': 'Cancel',
} as const;

export type PendingKey = keyof typeof PENDING_COPY;
export type SettingsTextKey = CopyKey | PendingKey;

/** Copy by key: the catalogue when it has the key, else the pending text. */
export function text(key: SettingsTextKey, vars: CopyVars = {}): string {
  if (isCopyKey(key)) return copy(key, vars);
  return formatMessage(PENDING_COPY[key as PendingKey], vars);
}
