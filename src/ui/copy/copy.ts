// Copy catalogue access (04 section 10.1): typed keys over src/ui/copy/en.json and a small in-house
// formatter. The formatter supports exactly two forms: {name} placeholders and
// {n, plural, one {...} other {...}} with # standing for the number. No dependency.
import en from './en.json';

/** Every key in en.json. Adding a string means adding its key here automatically. */
export type CopyKey = keyof typeof en;

/** Values for placeholders. Plural placeholders take numbers; others take strings or numbers. */
export type CopyVars = Readonly<Record<string, string | number>>;

const catalogue: Readonly<Record<CopyKey, string>> = en;

export const copyKeys: readonly CopyKey[] = Object.keys(en) as CopyKey[];

export function isCopyKey(key: string): key is CopyKey {
  return Object.prototype.hasOwnProperty.call(catalogue, key);
}

/** Index of the brace that closes the one opened at `open`. Throws when unbalanced. */
function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  throw new Error(`copy: unclosed "{" in "${s}"`);
}

/** Splits "one {...} other {...}" into a selector map. Only "one" and "other" are allowed. */
function parseBranches(s: string): Map<string, string> {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    if (i >= s.length) break;
    const open = s.indexOf('{', i);
    if (open < 0) throw new Error(`copy: plural branch without a body in "${s}"`);
    const selector = s.slice(i, open).trim();
    if (selector !== 'one' && selector !== 'other') throw new Error(`copy: unsupported plural form "${selector}" in "${s}"`);
    const close = matchingBrace(s, open);
    branches.set(selector, s.slice(open + 1, close));
    i = close + 1;
  }
  return branches;
}

function lookup(vars: CopyVars, name: string): string | number {
  if (!Object.prototype.hasOwnProperty.call(vars, name)) throw new Error(`copy: missing variable "${name}"`);
  const value = vars[name];
  if (value === undefined) throw new Error(`copy: missing variable "${name}"`);
  return value;
}

function renderField(inner: string, vars: CopyVars): string {
  const comma = inner.indexOf(',');
  if (comma < 0) return String(lookup(vars, inner.trim()));
  const name = inner.slice(0, comma).trim();
  const rest = inner.slice(comma + 1).trim();
  if (!rest.startsWith('plural,')) throw new Error(`copy: unsupported format "{${inner}}" (only plural is allowed)`);
  const n = Number(lookup(vars, name));
  if (!Number.isFinite(n)) throw new Error(`copy: plural variable "${name}" is not a number`);
  const branches = parseBranches(rest.slice('plural,'.length).trim());
  const body = (n === 1 ? branches.get('one') : undefined) ?? branches.get('other');
  if (body === undefined) throw new Error(`copy: no plural branch for ${n} in "{${inner}}"`);
  return formatMessage(body.replace(/#/g, String(n)), vars);
}

/** Formats one template. Throws on a missing variable, an unbalanced brace or an unsupported form. */
export function formatMessage(template: string, vars: CopyVars = {}): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matchingBrace(template, open);
    out += renderField(template.slice(open + 1, close), vars);
    i = close + 1;
  }
  return out;
}

/** The placeholder names a template needs, plural selectors included. Used by the catalogue tests. */
export function requiredVariables(template: string): string[] {
  const names = new Set<string>();
  const walk = (s: string): void => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const close = matchingBrace(s, open);
      const inner = s.slice(open + 1, close);
      const comma = inner.indexOf(',');
      if (comma < 0) {
        names.add(inner.trim());
      } else {
        names.add(inner.slice(0, comma).trim());
        const rest = inner.slice(comma + 1).trim();
        for (const body of parseBranches(rest.slice('plural,'.length).trim()).values()) walk(body);
      }
      i = close + 1;
    }
  };
  walk(template);
  return [...names];
}

/** The catalogue string for a key, formatted with the given variables. */
export function copy(key: CopyKey, vars: CopyVars = {}): string {
  return formatMessage(catalogue[key], vars);
}

/** The raw template for a key, unformatted. */
export function copyTemplate(key: CopyKey): string {
  return catalogue[key];
}
