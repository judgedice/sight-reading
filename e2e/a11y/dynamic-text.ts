// Rendered text that is data, not copy: numbers, times, dates, note names and ranges, key names, tempos, and the
// notation font's glyphs. Everything else on a screen has to be a catalogue value (see copy-match.ts).
const NOTE = '[A-G][♯♭]?-?\\d';
const DYNAMIC: readonly RegExp[] = [
  /^[\d\s.,:%+\-–−/·x×]+$/, // numbers, times, ratios
  new RegExp(`^${NOTE}(?: to ${NOTE})?$`), // a note or a range
  /^[A-G][♯♭]? (?:major|minor)$/, // a key
  /^♩ ?= ?\d+$/, // tempo
  /^[\uE000-\uF8FF\s]+$/, // SMuFL notation glyphs
  /^[♩♪]?\s?=?\s?\d+$/, // the tempo fragments "♩" and "= 67"
  /^(?:Space|Enter|Esc|Tab|[A-Z]|[←→↑↓]|Shift|Ctrl)$/, // key caps in the shortcut hints
  /^\d+(?:\.\d+)? ?(?:Hz|ms|bpm|%|dB|s|min|cents?)$/, // a number with its unit
  /^[A-Za-z0-9]+(?:[-.+][A-Za-z0-9.]+)+$/, // a build or version id with no spaces
  /^(?:Today|Yesterday|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*|[A-Z][a-z]{2,8} \d{1,2}(?:, \d{4})?),? ?\d{0,2}:?\d{0,2}$/, // a date and time
];

export function isDynamicText(text: string): boolean {
  return DYNAMIC.some((r) => r.test(text));
}
