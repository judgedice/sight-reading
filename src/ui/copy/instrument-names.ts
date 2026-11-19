// Player-facing instrument names (05 section 6.2, 13.2). The six voices have their own catalogue strings
// (`instrument.name.<id>` in full, `instrument.short.<id>` for the picker); every other instrument keeps the
// label from config/instruments.json, so callers pass the instrument (or its id plus that label) as the fallback.
import { copy, isCopyKey } from './copy';

/** An instrument id, or anything carrying an id and its config label. */
export type InstrumentRef = string | { readonly id: string; readonly label: string };

function resolve(ref: InstrumentRef, fallbackLabel: string | undefined): { id: string; label: string } {
  return typeof ref === 'string' ? { id: ref, label: fallbackLabel ?? ref } : { id: ref.id, label: fallbackLabel ?? ref.label };
}

/** "Soprano voice", "Mezzo-soprano voice", ...; the config label for every other instrument. */
export function instrumentName(ref: InstrumentRef, fallbackLabel?: string): string {
  const { id, label } = resolve(ref, fallbackLabel);
  const key = `instrument.name.${id}`;
  return isCopyKey(key) ? copy(key) : label;
}

/** "Soprano", "Mezzo", ... in the picker; the config label for every other instrument. */
export function instrumentShortName(ref: InstrumentRef, fallbackLabel?: string): string {
  const { id, label } = resolve(ref, fallbackLabel);
  const key = `instrument.short.${id}`;
  return isCopyKey(key) ? copy(key) : label;
}
