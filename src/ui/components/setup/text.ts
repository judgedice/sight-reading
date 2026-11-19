import { copy, isCopyKey, type CopyKey, type CopyVars } from '../../copy/copy.ts';

/**
 * A line of player-facing text as the setup model hands it over: a copy key and its variables, plus variables whose
 * value is itself a copy key (the range lines). The app's `SetupText` and `RangeText` both fit this shape, so the
 * controls take the model's rows as they are and format them here.
 */
export interface TextLine {
  key: string;
  vars: Readonly<Record<string, string | number>>;
  keyVars?: Readonly<Record<string, string>>;
}

/** Formats a `TextLine` with the copy catalogue. Throws on an unknown key, like `copy`. */
export function lineText(line: TextLine): string {
  if (!isCopyKey(line.key)) throw new RangeError(`unknown copy key ${line.key}`);
  const vars: Record<string, string | number> = { ...line.vars };
  for (const [name, key] of Object.entries(line.keyVars ?? {})) {
    if (!isCopyKey(key)) throw new RangeError(`unknown copy key ${key}`);
    vars[name] = copy(key);
  }
  return copy(line.key, vars);
}

const MARK = '\u0000';

/**
 * Splits a formatted template at one placeholder, so a component can style that part on its own ("2" and "of 10",
 * "♩" and "= 72") while the words still come from the catalogue.
 */
export function splitAt(key: CopyKey, vars: CopyVars, name: string): [string, string] {
  const text = copy(key, { ...vars, [name]: MARK });
  const i = text.indexOf(MARK);
  if (i < 0) return [text, ''];
  return [text.slice(0, i), text.slice(i + MARK.length)];
}
