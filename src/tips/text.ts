/**
 * Text of a chosen tip (02 §6.1 item 7, §6.3, §6.4): placeholder filling for tip text and the evidence line.
 * Pure. `tips/` may import only core, so the direction words and the bar-list join are mirrored here from the copy
 * keys tips.direction.sharp, tips.direction.flat and tips.bars.join in `src/ui/copy/en.json`; copy-sync.test.ts
 * fails if they drift.
 */
import type { PatternDef, PatternResult, TipCatalog } from '../core/types.ts';

/** Direction words for U22-style placeholders (`{direction}`): +1 sharp, −1 flat. */
export const DIRECTION_WORD = { sharp: 'sharp', flat: 'flat' } as const;

/** Mirror of tips.bars.join: joins the comma list of all but the last bar to the last bar. */
export const BARS_JOIN_TEMPLATE = '{list} and {last}';

/** Formats sorted, de-duplicated bar numbers as an English list: "3", "3 and 5", "3, 5 and 7". */
export function formatBars(bars: readonly number[]): string {
  const sorted = [...new Set(bars)].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.map(String).join('');
  return BARS_JOIN_TEMPLATE.replace('{list}', sorted.slice(0, -1).join(', ')).replace('{last}', String(sorted[sorted.length - 1]));
}

function paramText(key: string, params: Readonly<Record<string, number>> | undefined): string | undefined {
  if (!params || !Object.prototype.hasOwnProperty.call(params, key)) return undefined;
  const n = params[key]!;
  if (key === 'direction') {
    if (n > 0) return DIRECTION_WORD.sharp;
    if (n < 0) return DIRECTION_WORD.flat;
    return undefined;
  }
  if (key === 'offset') return String(Math.round(Math.abs(n)));
  return String(n);
}

/**
 * Fills `{name}` placeholders from the pattern's params. Returns null when a placeholder has no value, so the
 * caller can skip the tip rather than show a braces placeholder to the player.
 */
export function fillTipText(text: string, params: Readonly<Record<string, number>> | undefined): string | null {
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = paramText(key, params);
    if (v === undefined) {
      missing = true;
      return '';
    }
    return v;
  });
  return missing ? null : out;
}

/**
 * Evidence line (02 §6.1 item 7): the pattern's own template, else the catalog default, with `{bars}` replaced.
 * A pattern with no bars (the clean read) has no evidence line, so the result is the empty string.
 */
export function evidenceLine(p: PatternResult, def: PatternDef | undefined, catalog: TipCatalog): string {
  if (p.bars.length === 0) return '';
  const template = def?.evidenceTemplate ?? catalog.selection.defaultEvidenceTemplate;
  return template.split('{bars}').join(formatBars(p.bars));
}
