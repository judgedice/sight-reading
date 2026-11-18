// Contract tests for fixtures/render/ (01 §14 item 11, P0f row): 8 time-stamped FollowerEvent streams plus a
// final alignment, on 8 different fixture-corpus excerpts, ordered, idempotent per note, ending in `final`.
import Ajv from 'ajv';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FollowerEvent, RenderStreamLine } from '../../src/core/types.ts';
import { reduceOverlay, streamViolations } from '../../src/testkit/predicates/index.ts';
import { buildRenderFiles } from '../follow/gen/build.ts';
import { RENDER_SCENARIOS } from '../follow/gen/render-scenarios.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.events.jsonl')).sort();
const read = (f: string): string => readFileSync(new URL(f, dir), 'utf8');
const streams = files.map((f) => [f, read(f).trimEnd().split('\n').map((l) => JSON.parse(l) as RenderStreamLine)] as const);
const events = (lines: readonly RenderStreamLine[]): FollowerEvent[] => lines.flatMap((l) => (l.kind === 'event' ? [l.event] : []));

let built: Record<string, string>;
beforeAll(() => {
  built = buildRenderFiles();
}, 120_000);

describe('fixtures/render', () => {
  it('holds 8 streams on 8 different excerpts and covers 4 clefs of instruments', () => {
    expect(files).toEqual(RENDER_SCENARIOS.map((s) => `${s.id}.events.jsonl`).sort());
    expect(files).toHaveLength(8);
    const heads = streams.map(([, l]) => l[0]!).filter((h): h is Extract<RenderStreamLine, { kind: 'header' }> => h.kind === 'header');
    expect(new Set(heads.map((h) => h.excerptId)).size).toBe(8);
    expect(new Set(heads.map((h) => h.instrumentId))).toEqual(new Set(['flute', 'voice-soprano', 'clarinet-bb', 'cello', 'violin', 'sax-alto']));
  });

  it.each(files)('%s is byte-identical to the generator output', (f) => {
    expect(read(f)).toBe(built[f]);
  });

  it.each(streams)('%s: every line validates against render-stream-line.schema.json', (_f, lines) => {
    const schema = JSON.parse(readFileSync(new URL('../../schemas/render-stream-line.schema.json', import.meta.url), 'utf8')) as object;
    const v = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true }).compile(schema);
    for (const l of lines) expect(v(l), JSON.stringify(v.errors?.slice(0, 3))).toBe(true);
  });

  it.each(streams)('%s: ordered, idempotent per note, ends in end then final', (_f, lines) => {
    const ev = events(lines);
    const fin = reduceOverlay(ev).final!;
    expect(fin).not.toBeNull();
    expect(streamViolations(lines, ev, fin.judgments.length)).toEqual([]);
    expect(fin.judgments.map((j) => j.expectedIdx)).toEqual(fin.judgments.map((_, k) => k));
  });

  it.each(streams)('%s: shows something to draw (ghosts, missed or status) and a playhead', (_f, lines) => {
    const ev = events(lines);
    expect(ev.filter((e) => e.type === 'clock').length).toBeGreaterThan(100);
    expect(ev.some((e) => e.type === 'ghost' || e.type === 'missed')).toBe(true);
    expect(ev.filter((e) => e.type === 'judgment').length).toBeGreaterThan(10);
  });
});
