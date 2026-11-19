/**
 * Generates `src/ui/tokens.css` and `src/ui/tokens.ts` from `design/tokens.json` (04 section 7, section 12).
 *
 *   npx tsx tools/generate-tokens.ts           write both files
 *   npx tsx tools/generate-tokens.ts --check   exit 1 if a committed file differs from the generator output
 *
 * Output is deterministic: the same JSON always produces byte-identical files. Keys starting with `$`
 * are documentation and are never emitted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOKENS_JSON = join(root, 'design/tokens.json');
export const TOKENS_CSS = join(root, 'src/ui/tokens.css');
export const TOKENS_TS = join(root, 'src/ui/tokens.ts');

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
type ThemeValue = { light: string; dark: string };

/** Removes `$`-prefixed documentation keys, recursively. */
export function stripComments(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value !== null && typeof value === 'object') {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) if (!k.startsWith('$')) out[k] = stripComments(v);
    return out;
  }
  return value;
}

const isThemeValue = (v: Json): v is ThemeValue =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && 'light' in v && 'dark' in v;

const asObj = (v: Json | undefined, where: string): Obj => {
  if (v === undefined || v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`tokens: ${where} must be an object`);
  return v;
};

const px = (n: number): string => `${n}px`;

/** One CSS declaration line, indented by two spaces. */
const decl = (name: string, value: string): string => `  --${name}: ${value};`;

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/** Wraps rule blocks in a media query, indenting their contents. */
function media(query: string, rules: string[]): string {
  const body = rules.map((r) => r.split('\n').map((l) => (l === '' ? l : `  ${l}`)).join('\n')).join('\n\n');
  return `@media ${query} {\n${body}\n}`;
}

function themeLines(group: Obj, theme: 'light' | 'dark', where: string): string[] {
  const lines: string[] = [];
  for (const [name, v] of Object.entries(group)) {
    if (!isThemeValue(v)) throw new Error(`tokens: ${where}.${name} must be { light, dark }`);
    lines.push(decl(name, v[theme]));
  }
  return lines;
}

const isRecord = (v: Json | undefined): v is Obj => v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

/** Names whose number is a ratio, not a length: staff spaces and line heights are emitted unitless. */
const isUnitless = (name: string): boolean => /(?:staff-space|line-height)$/.test(name);

/** One component value as CSS text: a number is px (or unitless for ratio names), a string is as written. */
function componentValue(name: string, v: Json): string | null {
  if (typeof v === 'number') return isUnitless(name) ? String(v) : px(v);
  if (typeof v === 'string') return v;
  return null;
}

/**
 * Component sizes. A plain number is px, a string is as written, `{ fine, coarse }` is px with a coarse-pointer
 * override and `{ desktop, phone }` is the desktop value with a phone override below breakpoints.phoneMax.
 * Arrays and other objects are read from tokens.ts only.
 */
function componentFine(component: Obj): string[] {
  const lines: string[] = [];
  for (const [name, v] of Object.entries(component)) {
    if (isRecord(v) && 'fine' in v) lines.push(decl(name, px(Number(v.fine))));
    else if (isRecord(v) && 'desktop' in v && 'phone' in v) lines.push(decl(name, componentValue(name, v.desktop as Json) ?? ''));
    else {
      const text = componentValue(name, v);
      if (text !== null) lines.push(decl(name, text));
    }
  }
  return lines;
}

function componentCoarse(component: Obj): string[] {
  const lines: string[] = [];
  for (const [name, v] of Object.entries(component)) {
    if (isRecord(v) && 'coarse' in v) lines.push(decl(name, px(Number(v.coarse))));
  }
  return lines;
}

function componentPhone(component: Obj): string[] {
  const lines: string[] = [];
  for (const [name, v] of Object.entries(component)) {
    if (isRecord(v) && 'desktop' in v && 'phone' in v) lines.push(decl(name, componentValue(name, v.phone as Json) ?? ''));
  }
  return lines;
}

/** The stack without its first family: what text falls back to when the web font misses the 300 ms cap. */
const withoutFirstFamily = (stack: string): string => stack.replace(/^"[^"]+",\s*/, '');

/** @font-face rules for the self-hosted faces. Relative URLs, so Vite hashes them and the service worker precaches them. */
function fontFaces(font: Obj): string[] {
  const display = String(font.fontDisplay ?? 'block');
  const faces = font.faces;
  if (!Array.isArray(faces)) throw new Error('tokens: font.faces must be an array');
  return faces.map((f, i) => {
    const face = asObj(f, `font.faces.${i}`);
    const lines = [
      `  font-family: "${String(face.family)}";`,
      `  src: url("./fonts/${String(face.file)}") format("woff2");`,
      `  font-weight: ${String(face.weight)};`,
      '  font-style: normal;',
      `  font-display: ${display};`,
    ];
    if (typeof face.unicodeRange === 'string') lines.push(`  unicode-range: ${face.unicodeRange};`);
    return block('@font-face', lines);
  });
}

/** Produces the CSS and TS text from a parsed (and comment-stripped) token file. */
export function generateTokens(rawSource: unknown): { css: string; ts: string } {
  const source = stripComments(rawSource as Json);
  const src = asObj(source, 'root');
  const color = asObj(src.color, 'color');
  const ui = asObj(color.ui, 'color.ui');
  const paper = asObj(color.paper, 'color.paper');
  const hc = asObj(color.highContrast, 'color.highContrast');
  const hcUi = asObj(hc.ui, 'color.highContrast.ui');
  const hcPaper = asObj(hc.paper, 'color.highContrast.paper');
  const forced = asObj(color.forced, 'color.forced');
  const opacity = asObj(color.opacity, 'color.opacity');
  const font = asObj(src.font, 'font');
  const type = asObj(src.type, 'type');
  const space = asObj(src.space, 'space');
  const radius = asObj(src.radius, 'radius');
  const zIndex = asObj(src.zIndex, 'zIndex');
  const elevation = asObj(src.elevation, 'elevation');
  const breakpoints = asObj(src.breakpoints, 'breakpoints');
  const motion = asObj(src.motion, 'motion');
  const pointer = asObj(src.pointer, 'pointer');
  const component = asObj(src.component, 'component');

  // Base sizes, type, spacing and motion do not depend on theme or pointer except where noted.
  const phoneMax = Number(breakpoints.phoneMax);
  if (!Number.isFinite(phoneMax)) throw new Error('tokens: breakpoints.phoneMax must be a number');
  const fontDisplay = String(font.display);
  const fontUi = String(font.ui);
  const base: string[] = [
    '  color-scheme: light dark;',
    decl('font-display', fontDisplay),
    decl('font-ui', fontUi),
    decl('font-text', 'var(--font-ui)'),
    decl('font-music', String(font.music)),
    decl('font-features', String(font.featureSettings)),
  ];
  const phoneType: string[] = [];
  for (const [name, t] of Object.entries(type)) {
    const s = asObj(t, `type.${name}`);
    base.push(decl(`type-${name}-size`, px(Number(s.size))));
    base.push(decl(`type-${name}-line`, String(s.line)));
    base.push(decl(`type-${name}-weight`, String(s.weight)));
    base.push(decl(`type-${name}-family`, `var(--font-${s.face === 'display' ? 'display' : 'ui'})`));
    if (typeof s.tracking === 'string') base.push(decl(`type-${name}-tracking`, s.tracking));
    if (s.case === 'upper') base.push(decl(`type-${name}-transform`, 'uppercase'));
    if (typeof s.phoneSize === 'number') phoneType.push(decl(`type-${name}-size`, px(s.phoneSize)));
  }
  for (const [n, v] of Object.entries(space)) base.push(decl(`space-${n}`, px(Number(v))));
  for (const [n, v] of Object.entries(radius)) base.push(decl(`radius-${n}`, px(Number(v))));
  for (const [n, v] of Object.entries(zIndex)) base.push(decl(`z-${n}`, String(v)));
  for (const [n, v] of Object.entries(asObj(motion.dur, 'motion.dur'))) base.push(decl(`dur-${n}`, `${Number(v)}ms`));
  for (const [n, v] of Object.entries(asObj(motion.ease, 'motion.ease'))) base.push(decl(`ease-${n}`, String(v)));
  for (const [n, v] of Object.entries(opacity)) base.push(decl(`opacity-${n}`, String(v)));
  const targetMin = asObj(pointer.targetMin, 'pointer.targetMin');
  base.push(decl('target-min', px(Number(targetMin.fine))));
  base.push(...componentFine(component));

  const phone: string[] = [...phoneType, ...componentPhone(component)];
  const coarse: string[] = [decl('target-min', px(Number(targetMin.coarse))), ...componentCoarse(component)];

  const elevationLines = (theme: 'light' | 'dark'): string[] => themeLines(elevation, theme, 'elevation');
  const light = themeLines(ui, 'light', 'color.ui').concat(themeLines(paper, 'light', 'color.paper'), elevationLines('light'));
  const dark = themeLines(ui, 'dark', 'color.ui').concat(themeLines(paper, 'dark', 'color.paper'), elevationLines('dark'));
  const paperLight = themeLines(paper, 'light', 'color.paper');
  const paperDark = themeLines(paper, 'dark', 'color.paper');
  const hcLight = themeLines(hcUi, 'light', 'color.highContrast.ui').concat(themeLines(hcPaper, 'light', 'color.highContrast.paper'));
  const hcDark = themeLines(hcUi, 'dark', 'color.highContrast.ui').concat(themeLines(hcPaper, 'dark', 'color.highContrast.paper'));
  const forcedLines = Object.entries(forced).map(([name, v]) => {
    if (typeof v !== 'string') throw new Error(`tokens: color.forced.${name} must be a system colour keyword`);
    return decl(name, v);
  });

  const rules: string[] = [];
  rules.push(...fontFaces(font));
  rules.push(block(':root', base));
  rules.push(media(`(max-width: ${phoneMax}px)`, [block(':root', phone)]));
  rules.push(media('(pointer: coarse)', [block(':root', coarse)]));
  // The 300 ms cap (06 section 2.1): src/ui/fonts/font-loading.ts sets data-fonts="fallback" on the root when a web font
  // misses the cap and removes it when the fonts arrive, so text shows in the fallback stack in between.
  rules.push(
    block(':root[data-fonts="fallback"]', [decl('font-display', withoutFirstFamily(fontDisplay)), decl('font-ui', withoutFirstFamily(fontUi))]),
  );
  rules.push(block('html', ['  font-family: var(--font-ui);', '  font-feature-settings: var(--font-features);']));
  // Titles are set in the display face (06 section 2.2) wherever a screen has not chosen otherwise: :where() keeps the
  // specificity at zero, so a component rule always wins.
  rules.push(block(':where(h1)', ['  font-family: var(--type-h1-family);', '  letter-spacing: var(--type-h1-tracking);']));
  rules.push(block(':where(h2)', ['  font-family: var(--type-h2-family);']));
  rules.push(block('.tabular-nums', ['  font-variant-numeric: tabular-nums;']));
  // Reduced motion (04 section 7.3): every duration token is 0 under the media query or the
  // in-app setting (data-motion="reduced" on the root). Stylelint requires every transition and
  // animation to take its duration from a --dur-* token, so this is the reduced-motion gate
  // (04 section 13.1 item 1). The 100 ms ghost opacity fade is owned by the overlay (visual-states.ts).
  const reduced = Object.keys(asObj(motion.dur, 'motion.dur')).map((n) => decl(`dur-${n}`, '0ms'));
  // Reduce motion "Off" in settings (data-motion="full") restores the durations even when the system asks
  // for reduced motion; the attribute selector outranks the bare :root inside the media query.
  const full = Object.entries(asObj(motion.dur, 'motion.dur')).map(([n, v]) => decl(`dur-${n}`, `${Number(v)}ms`));
  rules.push(media('(prefers-reduced-motion: reduce)', [block(':root', reduced), block(':root[data-motion="full"]', full)]));
  rules.push(block(':root[data-motion="reduced"]', reduced));
  rules.push(block(':root, :root[data-theme="light"]', light));
  rules.push(block(':root[data-theme="dark"]', dark));
  rules.push(media('(prefers-color-scheme: dark)', [block(':root:not([data-theme="light"])', dark)]));
  rules.push(block(':root[data-paper="light"]', paperLight));
  rules.push(block(':root[data-paper="dark"]', paperDark));
  rules.push(block(':root[data-contrast="high"], :root[data-contrast="high"][data-theme="light"]', hcLight));
  rules.push(block(':root[data-contrast="high"][data-theme="dark"]', hcDark));
  rules.push(media('(prefers-color-scheme: dark)', [block(':root[data-contrast="high"]:not([data-theme="light"])', hcDark)]));
  // Forced colours win over every theme and contrast rule; the triple :root gives them the highest specificity here.
  rules.push(media('(forced-colors: active)', [block(':root:root:root', forcedLines)]));

  const css =
    [
      '/* Generated by tools/generate-tokens.ts from design/tokens.json. Do not edit by hand. */',
      '/* Hex and px values are allowed only in this file (stylelint, 04 section 13.1). */',
      '',
      rules.join('\n\n'),
      '',
    ].join('\n');

  const ts = [
    '// Generated by tools/generate-tokens.ts from design/tokens.json. Do not edit by hand.',
    '// Typed constants for the overlay and tests (04 section 7). CSS custom properties are in tokens.css.',
    '',
    `export const tokens = ${JSON.stringify(source, null, 2)} as const;`,
    '',
    'export type Tokens = typeof tokens;',
    'export type UiColourToken = keyof typeof tokens.color.ui;',
    'export type PaperColourToken = keyof typeof tokens.color.paper;',
    'export const breakpoints = tokens.breakpoints;',
    'export const contrastPairs = tokens.contrast.pairs;',
    'export const score = tokens.score;',
    'export const ui = tokens.ui;',
    'export const zIndex = tokens.zIndex;',
    'export const motion = tokens.motion;',
    'export const component = tokens.component;',
    '',
  ].join('\n');

  return { css, ts };
}

/** Parses design/tokens.json from disk. */
export function loadTokenSource(path: string = TOKENS_JSON): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Returns the paths whose committed content differs from the generator output. */
export function checkTokenFiles(source: unknown = loadTokenSource()): string[] {
  const out = generateTokens(source);
  const stale: string[] = [];
  const committed = (p: string): string | null => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };
  if (committed(TOKENS_CSS) !== out.css) stale.push(TOKENS_CSS);
  if (committed(TOKENS_TS) !== out.ts) stale.push(TOKENS_TS);
  return stale;
}

function main(argv: string[]): number {
  const source = loadTokenSource();
  if (argv.includes('--check')) {
    const stale = checkTokenFiles(source);
    if (stale.length > 0) {
      process.stderr.write(`tokens out of date, run tools/generate-tokens.ts: ${stale.join(', ')}\n`);
      return 1;
    }
    return 0;
  }
  const out = generateTokens(source);
  writeFileSync(TOKENS_CSS, out.css);
  writeFileSync(TOKENS_TS, out.ts);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
