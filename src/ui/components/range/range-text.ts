// Formats the range model's text lines with the copy catalogue (05 section 7.5, 13.2).
import { copy, copyTemplate, formatMessage, isCopyKey, type CopyVars } from '../../copy/copy.ts';
import type { RangeTextView } from './types.ts';

function varsOf(t: RangeTextView, extra: CopyVars): Record<string, string | number> {
  const vars: Record<string, string | number> = { ...t.vars, ...extra };
  for (const [name, key] of Object.entries(t.keyVars ?? {})) {
    vars[name] = isCopyKey(key) ? copy(key) : key;
  }
  return vars;
}

/** The whole line as text. Unknown keys render as nothing rather than leaking an id. */
export function formatRangeText(t: RangeTextView, extra: CopyVars = {}): string {
  if (!isCopyKey(t.key)) return '';
  return copy(t.key, varsOf(t, extra));
}

/**
 * The line split where its note names start, so the legend can set "G2 to G4" in 600 (06 section 6.10):
 * "Full range: " + "G2 to G4", "At difficulty 2: " + "C3 to C4". Lines without a `{low}` come back whole as `lead`.
 */
export function splitRangeText(t: RangeTextView, extra: CopyVars = {}): { lead: string; value: string } {
  if (!isCopyKey(t.key)) return { lead: '', value: '' };
  const template = copyTemplate(t.key);
  const vars = varsOf(t, extra);
  const at = template.indexOf('{low}');
  if (at < 0) return { lead: formatMessage(template, vars), value: '' };
  return { lead: formatMessage(template.slice(0, at), vars), value: formatMessage(template.slice(at), vars) };
}

/**
 * The card's short transposition line (06 section 6.11): "Sounds a major 2nd lower", without the concert range the
 * large picture adds after the colon. Taken from the same catalogue string, so the card and the picture agree.
 */
export function shortTranspositionText(t: RangeTextView): string {
  const whole = formatRangeText(t);
  const colon = whole.indexOf(':');
  return colon < 0 ? whole : whole.slice(0, colon);
}
