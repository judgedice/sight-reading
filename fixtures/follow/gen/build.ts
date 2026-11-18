/**
 * Builds every file in fixtures/follow/, fixtures/grade/ and fixtures/render/ as text. Deterministic: the same
 * inputs (config/, fixtures/corpus/, this code) give byte-identical output; `gen.test.ts` and the fixture tests
 * regenerate and compare.
 *
 * Regenerate with: pnpm tsx fixtures/follow/gen/main.ts
 */
import type { FollowFixture, GradeFixture, RenderStreamLine } from '../../../src/core/types.ts';
import { FOLLOW_SCENARIOS, runFollowScenario } from './follow-scenarios.ts';
import { GRADE_SCENARIOS, gradeInput, runGradeScenario } from './grade-scenarios.ts';
import { RENDER_SCENARIOS } from './render-scenarios.ts';
import { run } from './scenario.ts';

/** JSON with chosen arrays written one element per line, everything else compact. */
export function fmt(v: unknown, lineArrays: ReadonlySet<string>, key = '', indent = ''): string {
  if (Array.isArray(v) && lineArrays.has(key)) {
    if (v.length === 0) return '[]';
    const inner = indent + ' ';
    return `[\n${v.map((x) => inner + JSON.stringify(x)).join(',\n')}\n${indent}]`;
  }
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.some(([k, x]) => lineArrays.has(k) || (x !== null && typeof x === 'object' && !Array.isArray(x) && containsLine(x, lineArrays)))) return JSON.stringify(v);
    const inner = indent + ' ';
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${fmt(x, lineArrays, k, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v);
}
function containsLine(v: object, la: ReadonlySet<string>): boolean {
  return Object.entries(v).some(([k, x]) => la.has(k) || (x !== null && typeof x === 'object' && !Array.isArray(x) && containsLine(x, la)));
}

const FOLLOW_LINES = new Set(['expected', 'stream', 'expectLive', 'expectFinal']);
const GRADE_LINES = new Set(['expected', 'judgments', 'detected', 'expect', 'extras']);

export function buildFollowFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of FOLLOW_SCENARIOS) {
    const r = runFollowScenario(s);
    const fx: FollowFixture = {
      schemaVersion: 1,
      id: s.id,
      description: `${s.description} Expected notes: ${r.base.provenance}. Stream conventions: fixtures/follow/gen/perform.ts.`,
      excerptId: r.base.excerptId,
      instrumentId: r.base.instrumentId,
      level: r.base.level,
      bpm: r.base.bpm,
      writtenKey: r.base.writtenKey,
      expected: r.base.expected,
      t0: r.t0 as FollowFixture['t0'],
      latencyCompensationSec: r.rtl,
      voiceReferenceCents: r.tuningCents,
      stream: r.stream,
      expectLive: s.live(r),
      expectFinal: s.final(r),
    };
    out[`${s.id}.json`] = fmt(fx, FOLLOW_LINES) + '\n';
  }
  return out;
}

export function buildGradeFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of GRADE_SCENARIOS) {
    const r = runGradeScenario(s);
    const fx: GradeFixture = {
      schemaVersion: 1,
      id: s.id,
      case: s.case,
      description: `${s.description} Expected notes: ${r.base.provenance}. The alignment is the reference follower's final alignment for the scripted performance (fixtures/follow/gen/).`,
      excerptId: r.base.excerptId,
      instrumentId: r.base.instrumentId,
      input: gradeInput(s, r),
      expect: s.expect(r),
    };
    out[`${s.id}.json`] = fmt(fx, GRADE_LINES) + '\n';
  }
  return out;
}

export function buildRenderFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of RENDER_SCENARIOS) {
    const r = run(s.base(), s.spec);
    const lines: RenderStreamLine[] = [
      { kind: 'header', schemaVersion: 1, excerptId: r.base.excerptId, instrumentId: r.base.instrumentId, writtenKey: r.base.writtenKey, bpm: r.base.bpm, level: r.base.level, description: s.description },
    ];
    let last = -Infinity;
    for (const { t, ev } of r.timed) {
      const atMs = Math.round((t - r.t0 - r.rtl) * 1e4) / 10;
      last = atMs;
      lines.push({ kind: 'event', atMs, event: ev });
    }
    lines.push({ kind: 'event', atMs: last, event: { type: 'final', alignment: r.final } });
    out[`${s.id}.events.jsonl`] = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  }
  return out;
}

