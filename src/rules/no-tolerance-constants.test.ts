// P2 acceptance (01 §15): "no tolerance constants in follow/ or grade/". Every timing, cents and live threshold
// must come from config through rules/. This scans the non-test sources of follow/, grade/ and the rules files
// written in P2 for numeric literals that equal a tolerance value in config/grading-config.json.
//
// Allowed: unit conversions and small structural numbers (0, 1, 2, 12, 60, 100, 1000, 60000, 0.5 ...). A line
// that genuinely needs a listed number for another reason can carry the comment `tolerance-literal-ok: <why>`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';

const cfg = configs();
const g = cfg.grading;

/** Numbers that are units or structure, never tolerances, even when a config value happens to equal them. */
const STRUCTURAL = new Set([0, 1, 2, 3, 4, 10, 12, 60, 100, 1000, 60000, 0.5, 1e-6, 1e-9, 1e6, 1e9]);

function toleranceValues(): Set<number> {
  const out = new Set<number>();
  const add = (x: number | null): void => {
    if (x !== null && !STRUCTURAL.has(x)) out.add(x);
  };
  for (const b of g.timing.levelBands) {
    for (const t of [b.good, b.red, b.bad]) {
      add(t.absMs);
      add(t.fracBeat);
    }
  }
  for (const v of Object.values(g.timing.ioiCap)) add(v);
  for (const f of Object.values(g.timing.onsetClassFloors)) [f.goodMs, f.redMs, f.badMs].forEach(add);
  add(g.matchWindow.minMs);
  for (const b of g.intonation.bands) [b.goodCents, b.redCents].forEach(add);
  for (const v of Object.values(g.intonation.minSteadyMs)) add(v);
  add(g.intonation.vibratoWiden.belowSteadyMs);
  add(g.intonation.vibratoWiden.minGoodCents);
  add(g.intonation.vibratoWiden.minRedCents);
  add(g.intonation.wrongPitchAboveCents);
  add(g.live.provisionalMs);
  add(g.live.hysteresisCents);
  add(g.live.wrongAtConfirmMinCents);
  add(g.voice.maxOffsetCents);
  add(g.voice.maxStepCents);
  add(g.tuning.maxOffsetCents);
  return out;
}

function sources(dir: URL): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = new URL(name, dir);
    if (statSync(p).isDirectory()) out.push(...sources(new URL(`${name}/`, dir)));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p.pathname);
  }
  return out;
}

/** Numeric literals outside comments and strings, with their line numbers. */
function literals(src: string): { value: number; line: number; text: string }[] {
  const lines = src.split('\n');
  const out: { value: number; line: number; text: string }[] = [];
  let inBlock = false;
  lines.forEach((raw, i) => {
    let s = raw;
    if (inBlock) {
      const end = s.indexOf('*/');
      if (end < 0) return;
      s = s.slice(end + 2);
      inBlock = false;
    }
    s = s.replace(/\/\*.*?\*\//g, ' ');
    const open = s.indexOf('/*');
    if (open >= 0) {
      s = s.slice(0, open);
      inBlock = true;
    }
    s = s.replace(/\/\/.*$/, '');
    s = s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
    if (raw.includes('tolerance-literal-ok')) return;
    for (const m of s.matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)(?![\w$])/gi)) {
      out.push({ value: Number(m[1]!.replace(/_/g, '')), line: i + 1, text: raw.trim() });
    }
  });
  return out;
}

const root = new URL('../../', import.meta.url);
const targets = [
  ...sources(new URL('src/follow/', root)),
  ...sources(new URL('src/grade/', root)),
  ...['resolve-tolerances.ts', 'voice-drift.ts', 'pitch-policy.ts', 'live-verdict.ts', 'index.ts'].map((f) => new URL(f, import.meta.url).pathname),
];

describe('no tolerance constants outside config (P2 acceptance)', () => {
  const values = toleranceValues();

  it('knows the tolerance values it is looking for', () => {
    for (const v of [40, 55, 85, 90, 120, 0.12, 0.3, 250, 150, 180, 360, 45, 35, 80, 15, 25]) expect(values.has(v), String(v)).toBe(true);
  });

  it('the scanner finds literals and ignores comments and strings', () => {
    const found = literals("const a = 40; // 55\n/* 85\n 90 */ const b = '120' + x150 + 0.3;").map((l) => l.value);
    expect(found).toEqual([40, 0.3]);
  });

  it.each(targets.map((t) => [t.slice(root.pathname.length), t]))('%s has no tolerance literal', (_rel, file) => {
    const hits = literals(readFileSync(file, 'utf8')).filter((l) => values.has(l.value));
    expect(hits.map((h) => `line ${h.line}: ${h.value} in "${h.text}"`)).toEqual([]);
  });
});
