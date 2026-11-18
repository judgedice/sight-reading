/**
 * Predicate DSL for the follow and grade fixtures (01 §14 items 9 and 10). Fixtures state expected outcomes as
 * predicates ("note 3 judged late, 140 to 160 ms") instead of exact totals, so independent implementations can be
 * held to the spec without sharing arithmetic.
 *
 * A predicate is `{ path, op, value?, tolerance?, note? }` (`Predicate` in core/types.ts). Path grammar:
 *
 *   path     := head segment*
 *   head     := key                       e.g. `judgments`, `score`
 *   segment  := '.' key                   property (arrays also have `.length`)
 *             | '[' int ']'               index; negative counts from the end (`[-1]` = last)
 *             | '[' int? ':' int? ']'     slice, half-open like Array.prototype.slice
 *             | '[*]'                     every element must satisfy the rest (fails on an empty array)
 *             | '[?]'                     at least one element satisfies the rest
 *             | '[' cond ('&' cond)* ']'  filter, keeps elements where every cond holds; yields an array
 *   cond     := dotted-key ('=' | '!=') literal
 *   literal  := number | true | false | null | bare text (no ']' or '&')
 *
 * Examples: `judgments[3].timing`, `judgments[0:8][*].status`, `events[type=ghost].length`,
 * `events[type=status&kind=come-in-at][0].bar`, `patterns[id=E12][0].notes`.
 *
 * Reading a property of `undefined` or `null` yields `undefined`; it never throws.
 *
 * Ops: `eq` / `ne` (deep JSON equality), `lt` `le` `gt` `ge` (numbers), `approx` (|a − value| ≤ tolerance,
 * default 1e-9), `in` (a deep-equals one of value[]), `includes` / `excludes` (array a contains / lacks value),
 * `length` (array or string length equals value), `exists` (neither undefined nor null), `absent` (undefined or
 * null), `fires` / `not-fires` (path is a pattern id; looks in `subject.patterns`, else `subject.score.patterns`),
 * `only-fires` (the set of fired pattern ids equals value[]; path is ignored, write "patterns").
 */
import type { JsonValue, Predicate } from '../../core/types.ts';

export type Segment =
  | { t: 'key'; key: string }
  | { t: 'index'; i: number }
  | { t: 'slice'; from: number | null; to: number | null }
  | { t: 'all' }
  | { t: 'any' }
  | { t: 'filter'; conds: { path: string[]; neg: boolean; value: JsonValue }[] };

export class PathSyntaxError extends Error {
  constructor(path: string, why: string) {
    super(`bad predicate path "${path}": ${why}`);
    this.name = 'PathSyntaxError';
  }
}

function literal(s: string): JsonValue {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

const KEY = /^[A-Za-z_$][\w$-]*/;

export function parsePath(path: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  const head = KEY.exec(path);
  if (!head) throw new PathSyntaxError(path, 'must start with a key');
  out.push({ t: 'key', key: head[0] });
  i = head[0].length;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      const m = KEY.exec(path.slice(i + 1));
      if (!m) throw new PathSyntaxError(path, `expected a key at ${i + 1}`);
      out.push({ t: 'key', key: m[0] });
      i += 1 + m[0].length;
    } else if (ch === '[') {
      const close = path.indexOf(']', i);
      if (close < 0) throw new PathSyntaxError(path, `unclosed [ at ${i}`);
      const body = path.slice(i + 1, close);
      i = close + 1;
      if (body === '*') out.push({ t: 'all' });
      else if (body === '?') out.push({ t: 'any' });
      else if (/^-?\d+$/.test(body)) out.push({ t: 'index', i: Number(body) });
      else if (/^-?\d*:-?\d*$/.test(body)) {
        const [a, b] = body.split(':') as [string, string];
        out.push({ t: 'slice', from: a === '' ? null : Number(a), to: b === '' ? null : Number(b) });
      } else {
        const conds = body.split('&').map((c) => {
          const m = /^([A-Za-z_$][\w$.-]*?)(!=|=)(.*)$/.exec(c);
          if (!m) throw new PathSyntaxError(path, `bad filter "${c}"`);
          return { path: m[1]!.split('.'), neg: m[2] === '!=', value: literal(m[3]!) };
        });
        out.push({ t: 'filter', conds });
      }
    } else throw new PathSyntaxError(path, `unexpected "${ch}" at ${i}`);
  }
  return out;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, k) => deepEqual(x, bb[k]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function prop(v: unknown, key: string): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v) && key === 'length') return v.length;
  if (typeof v === 'string' && key === 'length') return v.length;
  if (typeof v !== 'object') return undefined;
  return (v as Record<string, unknown>)[key];
}

/** Value of a path with no `[*]` / `[?]` quantifier. Throws PathSyntaxError if the path has one. */
export function resolvePath(subject: unknown, path: string): unknown {
  let v: unknown = subject;
  for (const s of parsePath(path)) {
    if (s.t === 'all' || s.t === 'any') throw new PathSyntaxError(path, 'resolvePath takes no quantifiers');
    v = step(v, s);
  }
  return v;
}

function step(v: unknown, s: Exclude<Segment, { t: 'all' } | { t: 'any' }>): unknown {
  switch (s.t) {
    case 'key':
      return prop(v, s.key);
    case 'index':
      if (!Array.isArray(v)) return undefined;
      return v[s.i < 0 ? v.length + s.i : s.i];
    case 'slice':
      if (!Array.isArray(v)) return undefined;
      return v.slice(s.from ?? undefined, s.to ?? undefined);
    case 'filter':
      if (!Array.isArray(v)) return undefined;
      return v.filter((el) =>
        s.conds.every((c) => {
          const x = c.path.reduce<unknown>((acc, k) => prop(acc, k), el);
          return c.neg ? !deepEqual(x, c.value) : deepEqual(x, c.value);
        }),
      );
  }
}

export interface PredicateFailure {
  predicate: Predicate;
  message: string;
}

const show = (v: unknown): string => (v === undefined ? 'undefined' : JSON.stringify(v));

function firedIds(subject: unknown): string[] | null {
  const pats = prop(subject, 'patterns') ?? prop(prop(subject, 'score'), 'patterns');
  if (!Array.isArray(pats)) return null;
  return pats.map((p) => String(prop(p, 'id')));
}

/** Leaf test; returns null on success or the reason. */
function leaf(actual: unknown, p: Predicate): string | null {
  const v = p.value;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  switch (p.op) {
    case 'eq':
      return deepEqual(actual, v) ? null : `expected ${show(v)}, got ${show(actual)}`;
    case 'ne':
      return !deepEqual(actual, v) ? null : `expected anything but ${show(v)}`;
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge': {
      if (!num(actual) || !num(v)) return `${p.op} needs numbers, got ${show(actual)} vs ${show(v)}`;
      const ok = p.op === 'lt' ? actual < v : p.op === 'le' ? actual <= v : p.op === 'gt' ? actual > v : actual >= v;
      return ok ? null : `expected ${p.op} ${v}, got ${actual}`;
    }
    case 'approx': {
      const tol = p.tolerance ?? 1e-9;
      if (!num(actual) || !num(v)) return `approx needs numbers, got ${show(actual)} vs ${show(v)}`;
      return Math.abs(actual - v) <= tol ? null : `expected ${v} ± ${tol}, got ${actual}`;
    }
    case 'in':
      if (!Array.isArray(v)) return 'in needs an array value';
      return v.some((x) => deepEqual(actual, x)) ? null : `expected one of ${show(v)}, got ${show(actual)}`;
    case 'includes':
    case 'excludes': {
      if (!Array.isArray(actual)) return `${p.op} needs an array at the path, got ${show(actual)}`;
      const has = actual.some((x) => deepEqual(x, v));
      return has === (p.op === 'includes') ? null : `expected ${show(actual)} to ${p.op === 'includes' ? 'include' : 'exclude'} ${show(v)}`;
    }
    case 'length': {
      const len = Array.isArray(actual) || typeof actual === 'string' ? actual.length : undefined;
      if (len === undefined) return `length needs an array or string, got ${show(actual)}`;
      return len === v ? null : `expected length ${show(v)}, got ${len}`;
    }
    case 'exists':
      return actual !== undefined && actual !== null ? null : `expected a value, got ${show(actual)}`;
    case 'absent':
      return actual === undefined || actual === null ? null : `expected no value, got ${show(actual)}`;
    default:
      return `op ${p.op} is not a value op`;
  }
}

function walk(v: unknown, segs: Segment[], p: Predicate): string | null {
  if (segs.length === 0) return leaf(v, p);
  const [s, ...rest] = segs as [Segment, ...Segment[]];
  if (s.t === 'all') {
    if (!Array.isArray(v)) return `[*] on a non-array (${show(v)})`;
    if (v.length === 0) return '[*] on an empty array';
    for (let k = 0; k < v.length; k++) {
      const r = walk(v[k], rest, p);
      if (r) return `element [${k}]: ${r}`;
    }
    return null;
  }
  if (s.t === 'any') {
    if (!Array.isArray(v)) return `[?] on a non-array (${show(v)})`;
    const reasons: string[] = [];
    for (let k = 0; k < v.length; k++) {
      const r = walk(v[k], rest, p);
      if (!r) return null;
      if (reasons.length < 3) reasons.push(`[${k}] ${r}`);
    }
    return `no element satisfies (${v.length} tried${reasons.length ? `; ${reasons.join('; ')}` : ''})`;
  }
  return walk(step(v, s), rest, p);
}

/** Check one predicate; null when it holds. */
export function checkPredicate(subject: unknown, p: Predicate): PredicateFailure | null {
  let msg: string | null;
  try {
    if (p.op === 'fires' || p.op === 'not-fires' || p.op === 'only-fires') {
      const ids = firedIds(subject);
      if (!ids) msg = 'subject has no patterns array';
      else if (p.op === 'only-fires') {
        if (!Array.isArray(p.value)) msg = 'only-fires needs an array of pattern ids';
        else {
          const want = [...new Set(p.value.map(String))].sort();
          const got = [...new Set(ids)].sort();
          msg = deepEqual(want, got) ? null : `expected exactly ${show(want)} to fire, got ${show(got)}`;
        }
      } else {
        const has = ids.includes(p.path);
        msg = has === (p.op === 'fires') ? null : `expected ${p.path} ${p.op === 'fires' ? 'to fire' : 'not to fire'}; fired ${show(ids)}`;
      }
    } else msg = walk(subject, parsePath(p.path), p);
  } catch (e) {
    msg = (e as Error).message;
  }
  return msg === null ? null : { predicate: p, message: `${p.path} ${p.op}: ${msg}` };
}

export function checkPredicates(subject: unknown, ps: readonly Predicate[]): PredicateFailure[] {
  return ps.map((p) => checkPredicate(subject, p)).filter((f): f is PredicateFailure => f !== null);
}

export function formatFailures(fs: readonly PredicateFailure[]): string {
  return fs.map((f) => `  - ${f.message}${f.predicate.note ? `\n      (${f.predicate.note})` : ''}`).join('\n');
}

/** Throws with every failing predicate listed. For use inside Vitest `it` blocks. */
export function assertPredicates(subject: unknown, ps: readonly Predicate[], label = 'predicates'): void {
  const fs = checkPredicates(subject, ps);
  if (fs.length) throw new Error(`${label}: ${fs.length} of ${ps.length} failed\n${formatFailures(fs)}`);
}

/** Builders used by the fixture generator. `note` should cite the spec and show the derivation. */
const mk =
  (op: Predicate['op']) =>
  (path: string, value: JsonValue, note?: string): Predicate =>
    note === undefined ? { path, op, value } : { path, op, value, note };
export const P = {
  eq: mk('eq'),
  ne: mk('ne'),
  lt: mk('lt'),
  le: mk('le'),
  gt: mk('gt'),
  ge: mk('ge'),
  in: mk('in'),
  includes: mk('includes'),
  excludes: mk('excludes'),
  length: mk('length'),
  approx: (path: string, value: number, tolerance: number, note?: string): Predicate =>
    note === undefined ? { path, op: 'approx', value, tolerance } : { path, op: 'approx', value, tolerance, note },
  exists: (path: string, note?: string): Predicate => (note === undefined ? { path, op: 'exists' } : { path, op: 'exists', note }),
  absent: (path: string, note?: string): Predicate => (note === undefined ? { path, op: 'absent' } : { path, op: 'absent', note }),
  fires: (id: string, note?: string): Predicate => (note === undefined ? { path: id, op: 'fires' } : { path: id, op: 'fires', note }),
  notFires: (id: string, note?: string): Predicate => (note === undefined ? { path: id, op: 'not-fires' } : { path: id, op: 'not-fires', note }),
  onlyFires: (ids: string[], note?: string): Predicate =>
    note === undefined ? { path: 'patterns', op: 'only-fires', value: ids } : { path: 'patterns', op: 'only-fires', value: ids, note },
  /** Two predicates: lo ≤ path ≤ hi. */
  between: (path: string, lo: number, hi: number, note?: string): Predicate[] => [mk('ge')(path, lo, note), mk('le')(path, hi, note)],
};
