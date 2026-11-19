// Matching rendered text against the copy catalogue (designer's check: "a test compares each screen's rendered text with
// en.json, so mockup and app copy cannot drift"). Every catalogue value becomes a regular expression: `{name}` matches any
// run of text, `{n, plural, one {..} other {..}}` matches either branch with `#` standing for any number. A rendered text
// run is "from the catalogue" when it matches one value, or when it splits on a joiner the screens use between two copy
// strings (" · ", " – ", ", ") into runs that each do.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const esc = (s: string): string => s.replace(ESCAPE, '\\$&');

function close(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}' && --depth === 0) return k;
  }
  throw new Error(`unbalanced brace in "${s}"`);
}

/** Regular expression source for one catalogue value. */
export function templateSource(template: string): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += esc(template.slice(i));
      break;
    }
    out += esc(template.slice(i, open));
    const end = close(template, open);
    const inner = template.slice(open + 1, end);
    const comma = inner.indexOf(',');
    if (comma < 0) {
      out += '.+?';
    } else {
      // {n, plural, one {a} other {b}}
      const rest = inner.slice(comma + 1).replace(/^\s*plural,\s*/, '');
      const branches: string[] = [];
      let j = 0;
      while (j < rest.length) {
        const b = rest.indexOf('{', j);
        if (b < 0) break;
        const e = close(rest, b);
        branches.push(templateSource(rest.slice(b + 1, e).replace(/#/g, '{n}')));
        j = e + 1;
      }
      out += `(?:${branches.join('|')})`;
    }
    i = end + 1;
  }
  return out;
}

export interface CopyMatcher {
  /** True when the (whitespace-normalised) text is catalogue copy. */
  matches(text: string): boolean;
}

const JOINERS = [' · ', ' – ', ' — ', ', ', ' / ', ': '];

/** Expands `{n, plural, one {a} other {b}}` into the plain variants (`#` becomes `{n}`). */
export function expandPlurals(template: string): string[] {
  const open = template.search(/\{[^{},]+,\s*plural,/);
  if (open < 0) return [template];
  const end = close(template, open);
  const inner = template.slice(open + 1, end);
  const rest = inner.slice(inner.indexOf(',') + 1).replace(/^\s*plural,\s*/, '');
  const out: string[] = [];
  let j = 0;
  while (j < rest.length) {
    const b = rest.indexOf('{', j);
    if (b < 0) break;
    const e = close(rest, b);
    const body = rest.slice(b + 1, e).replace(/#/g, '{n}');
    for (const tail of expandPlurals(template.slice(end + 1))) out.push(template.slice(0, open) + body + tail);
    j = e + 1;
  }
  return out;
}

/** Literal characters of a plain template (placeholders and spaces removed). */
const literalLength = (v: string): number => v.replace(/\{[^{}]*\}/g, '').replace(/\s/g, '').length;

/**
 * Pieces of a catalogue value that a screen may render on their own: the whole value, each plural variant, and every
 * part between the joiners screens put between two strings (the card's "Sounds a major 2nd lower" is the head of
 * "Sounds a {interval} lower: concert {low} to {high}").
 */
function pieces(value: string): string[] {
  const out = new Set<string>();
  // Parts of one line a screen sets in separate boxes ("2" then "of 10"): every run of whole tokens between placeholders.
  const sub = (t: string): void => {
    const tokens = t.split(/(\{[^{}]*\})/).filter((x) => x !== '');
    if (tokens.length < 2 || tokens.length > 9) return;
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i; j < tokens.length; j++) {
        const part = tokens.slice(i, j + 1).join('').trim();
        if (part && part !== t.trim()) out.add(part);
      }
    }
  };
  const add = (t: string, depth: number): void => {
    const trimmed = t.trim();
    if (!trimmed) return;
    out.add(trimmed);
    if (depth > 3) return;
    for (const j of JOINERS) if (trimmed.includes(j)) for (const part of trimmed.split(j)) add(part, depth + 1);
  };
  for (const v of expandPlurals(value)) {
    add(v, 0);
    sub(v);
  }
  return [...out];
}

export function createCopyMatcher(values: readonly string[], data: readonly string[] = [], dynamic: (text: string) => boolean = () => false): CopyMatcher {
  const all = [...new Set([...values, ...data].flatMap(pieces))];
  const exact = new Set(all);
  // A template made of placeholders alone (or with almost no literal text) would match any text: skip it.
  const res = all.filter((v) => v.includes('{') && literalLength(v) >= 2).map((v) => new RegExp(`^${templateSource(v)}$`, 's'));
  const direct = (t: string): boolean => exact.has(t) || dynamic(t) || res.some((r) => r.test(t));
  const split = (t: string, depth: number): boolean => {
    if (direct(t)) return true;
    if (depth > 3) return false;
    for (const j of JOINERS) {
      if (!t.includes(j)) continue;
      const parts = t.split(j).map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1 && parts.every((p) => split(p, depth + 1))) return true;
    }
    return false;
  };
  // Review adds measured figures in brackets after a catalogue sentence: "You sped up slightly by the end (38 ms)."
  const bare = (t: string): string => t.replace(/ \(\d+(?:\.\d+)? ?(?:ms|cents?|¢)\)/g, '');
  return {
    matches: (text) => {
      const t = text.replace(/\s+/g, ' ').trim();
      const b = bare(t);
      return split(t, 0) || split(b, 0) || (b.endsWith('.') && split(b.slice(0, -1), 0));
    },
  };
}

export function loadCatalogue(): string[] {
  const en = JSON.parse(readFileSync(join(process.cwd(), 'src/ui/copy/en.json'), 'utf8')) as Record<string, string>;
  return Object.values(en);
}

/** Instrument names and families from config/instruments.json: data the screens print as they are. */
export function loadInstrumentData(): string[] {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/instruments.json'), 'utf8')) as { instruments: { label: string; family: string }[] };
  const prog = JSON.parse(readFileSync(join(process.cwd(), 'config/progression.json'), 'utf8')) as { ranks: { table: { name: string }[] } };
  return [...new Set([...cfg.instruments.flatMap((i) => [i.label, i.family]), ...prog.ranks.table.map((r) => r.name)])];
}
