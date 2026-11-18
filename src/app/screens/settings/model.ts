/** Pure helpers for the settings screen: patches that keep the rest of AppSettings, and profile name rules. */
import type { AppSettings } from '../../../core/types.ts';

/** Replaces some fields of one section of the settings, leaving everything else as it was. */
export function patchSection<K extends keyof AppSettings>(s: AppSettings, key: K, values: Partial<AppSettings[K]>): AppSettings {
  return { ...s, [key]: { ...(s[key] as object), ...values } };
}

/** Longest display name the profile keeps (characters). */
export const NAME_MAX = 40;

/** A trimmed name of 1 to 40 characters, or null when the input is not a usable name. */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim().slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

/** Bytes as KB or MB, for the storage row. */
export function sizeParts(bytes: number): { unit: 'kb' | 'mb'; n: number } {
  if (bytes >= 1_000_000) return { unit: 'mb', n: Math.round(bytes / 100_000) / 10 };
  return { unit: 'kb', n: Math.round(bytes / 1000) };
}

/** The typed word that confirms "Delete all data" (04 5.11). */
export const DELETE_WORD = 'delete';
