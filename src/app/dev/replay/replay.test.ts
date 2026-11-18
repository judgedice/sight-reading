// P20 (01 §13.6): every render stream in fixtures/render/ replays to a well-formed final, an attempt export replays to the
// same overlay state and final alignment as its stored results, and diagnostics exports contain no audio.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AttemptRecord, NoteJudgment } from '../../../core/types.ts';
import { makeAttempt } from '../../../store/test-data.ts';
import { buildDiagnosticsExport, diagnosticsJson, findAudio } from './diagnostics.ts';
import { attemptTimeline, checkAttemptReplay, liveOf, replayTimeline, type TimedEvent } from './reduce.ts';
import { parseReplaySource, pitchPoints, ReplayParseError, type ReplaySource } from './source.ts';

const ROOT = join(process.cwd(), 'fixtures', 'render');
const streams = readdirSync(ROOT).filter((f) => f.endsWith('.events.jsonl')).sort();

function judgment(expectedIdx: number, over: Partial<NoteJudgment> = {}): NoteJudgment {
  return {
    expectedIdx,
    status: 'matched',
    detectedId: expectedIdx + 1,
    timing: 'on-time',
    timingErrorMs: 3.5,
    pitch: 'in-tune',
    playedConcertMidi: 64,
    centsError: 2,
    octaveDisplaced: false,
    duration: 'ok',
    heldRatio: 0.9,
    credit: { p: 1, n: 1, o: 1, d: 1 },
    marginal: false,
    rejudged: false,
    ...over,
  } as NoteJudgment;
}

function record(over: Partial<AttemptRecord> = {}): AttemptRecord {
  const judgments = [judgment(0), judgment(1, { timing: 'late', timingErrorMs: 140, rejudged: true }), judgment(2, { status: 'missed', detectedId: null, timing: null, pitch: null, timingErrorMs: null, playedConcertMidi: null, centsError: null, credit: { p: 0, n: null, o: 0, d: null } }), judgment(3)];
  return makeAttempt(7, {
    judgments,
    detected: [{ id: 1, onset: 0.5, offset: 0.9, provisionalMidi: 64, midi: 64, stableMedianCents: 2, steadyMs: 300, pitchSdCents: 3, clarity: 0.9, altOctaveClarity: null, onsetCause: 'from-silence' } as unknown as AttemptRecord['detected'][number]],
    extras: [{ detectedId: 9, onsetSec: 5.2, concertMidi: 70.1, cents: 10, durSec: 0.2, duringRest: true }],
    displaced: [],
    endReason: 'complete',
    ...over,
  });
}

function fixtureText(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8');
}

describe('render streams (fixtures/render)', () => {
  it('finds the eight fixture streams', () => {
    expect(streams.length).toBe(8);
  });

  for (const name of streams) {
    it(`${name} parses and replays to a well-formed final`, () => {
      const [src] = parseReplaySource(name, fixtureText(name));
      expect(src?.kind).toBe('render');
      const st = replayTimeline(src!.timeline);
      expect(st.problems).toEqual([]);
      expect(st.final).not.toBeNull();
      expect(st.end?.reason).toBe('complete');
      expect(st.applied).toBe(src!.timeline.length);
    });

    it(`${name} is idempotent: re-sent judgments, ghosts and missed events leave the state unchanged`, () => {
      const [src] = parseReplaySource(name, fixtureText(name));
      const tl = src!.timeline;
      const once = replayTimeline(tl);
      const resent: TimedEvent[] = tl.filter((t) => ['judgment', 'ghost', 'missed'].includes(t.event.type));
      const twice = replayTimeline([...tl, ...resent]);
      expect(JSON.stringify([...twice.judgments])).toBe(JSON.stringify([...once.judgments]));
      expect(JSON.stringify([...twice.ghosts])).toBe(JSON.stringify([...once.ghosts]));
      expect([...twice.missed]).toEqual([...once.missed]);
    });

    it(`${name} shows the stream's own final alignment`, () => {
      const [src] = parseReplaySource(name, fixtureText(name));
      const finalLine = src!.timeline.find((t) => t.event.type === 'final');
      const st = replayTimeline(src!.timeline);
      expect(st.final).toBe(finalLine && finalLine.event.type === 'final' ? finalLine.event.alignment : null);
    });
  }

  it('pitch trace has one point per note-start event', () => {
    const [src] = parseReplaySource('le-beau.events.jsonl', fixtureText('le-beau-flute-restart.events.jsonl'));
    const starts = src!.timeline.filter((t) => t.event.type === 'note-start').length;
    expect(pitchPoints(src!).points.length).toBe(starts);
    expect(pitchPoints(src!).xLabel).toBe('score beat');
  });
});

describe('parseReplaySource', () => {
  it('rejects an empty file', () => {
    expect(() => parseReplaySource('e.json', '  \n ')).toThrow(ReplayParseError);
  });

  it('rejects a render stream without a header first', () => {
    const lines = fixtureText('mozart-violin-stop.events.jsonl').split('\n');
    expect(() => parseReplaySource('x.jsonl', lines.slice(1).join('\n'))).toThrow(/header/);
  });

  it('rejects a line that is not a timed event', () => {
    const text = fixtureText('mozart-violin-stop.events.jsonl').split('\n').slice(0, 2).concat('{"kind":"event","event":{"type":"clock"}}').join('\n');
    expect(() => parseReplaySource('x.jsonl', text)).toThrow(/line 3 is not a timed event/);
  });

  it('rejects a JSON object that is neither an export nor an attempt', () => {
    expect(() => parseReplaySource('x.json', '{"hello":1}')).toThrow(/neither/);
  });

  it('rejects an export with an unsupported version', () => {
    expect(() => parseReplaySource('x.json', JSON.stringify({ format: 'sightread-export', version: 2, attempts: [] }))).toThrow(/version 2/);
  });

  it('reads one source per attempt in an export file', () => {
    const exp = { format: 'sightread-export', version: 1, attempts: [record(), record({ id: 'b' })] };
    const srcs = parseReplaySource('export.json', JSON.stringify(exp));
    expect(srcs.map((s) => s.kind)).toEqual(['attempt', 'attempt']);
    expect(srcs[1]!.label).toBe('export.json #2');
  });

  it('reads a single attempt record', () => {
    const [src] = parseReplaySource('one.json', JSON.stringify(record(), null, 2));
    expect(src?.kind).toBe('attempt');
    expect(src!.timeline.at(-1)?.event.type).toBe('final');
  });

  it('reads a single header line as a render stream with no events', () => {
    const [src] = parseReplaySource('h.jsonl', fixtureText('mozart-violin-stop.events.jsonl').split('\n')[0]!);
    expect(src?.kind).toBe('render');
    expect(src!.timeline).toEqual([]);
  });
});

describe('attempt replay (identical to results)', () => {
  it('the attempt timeline replays to the stored judgments and final alignment', () => {
    const r = record();
    expect(checkAttemptReplay(r)).toEqual([]);
    const st = replayTimeline(attemptTimeline(r));
    expect(st.problems).toEqual([]);
    expect([...st.missed]).toEqual([2]);
    expect(st.judgments.get(1)).toEqual(liveOf(r.judgments[1]!));
    expect(st.final).toEqual({ judgments: r.judgments, extras: r.extras, displaced: r.displaced });
  });

  it('a void attempt replays with its void reason', () => {
    const r = record({ endReason: 'void', voidReason: 'interruption' as NonNullable<AttemptRecord['voidReason']> });
    const st = replayTimeline(attemptTimeline(r));
    expect(st.end).toEqual({ type: 'end', reason: 'void', voidReason: 'interruption' });
    expect(checkAttemptReplay(r)).toEqual([]);
  });

  it('reports a duplicated expected note, which the replay cannot show', () => {
    const r = record({ judgments: [judgment(0), judgment(0), judgment(1)] });
    expect(checkAttemptReplay(r)).toContain('replay has 2 notes, the record has 3');
  });

  it('a parsed attempt export gives the same overlay state as the record it came from', () => {
    const r = record();
    const [src] = parseReplaySource('a.json', JSON.stringify(r));
    expect(replayTimeline(src!.timeline).judgments.size).toBe(3);
    expect(replayTimeline((src as Extract<ReplaySource, { kind: 'attempt' }>).timeline).missed.size).toBe(1);
  });
});

describe('diagnostics export', () => {
  it('whitelists fields: settings, detected, judgments, extras, frames, score and the event log', () => {
    const r = { ...record(), debug: { live: [], frames: [{ t: 0.1, midi: 64, clarity: 0.9, rmsDb: -30, flux: 0, inClickWindow: false }] } } as unknown as AttemptRecord;
    const out = buildDiagnosticsExport(r);
    expect(Object.keys(out).sort()).toEqual(['appVersion', 'attemptId', 'configVersion', 'corpusVersion', 'createdAt', 'detected', 'displaced', 'events', 'extras', 'format', 'frames', 'judgments', 'score', 'settings', 'version'].sort());
    expect(out.frames.length).toBe(1);
    expect(out.attemptId).toBe(r.id);
    expect(out.events.at(-1)?.event.type).toBe('final');
  });

  it('never carries an audio field that was added to the record', () => {
    const r = { ...record(), samples: new Float32Array(4000), audioBuffer: { length: 4000 } } as unknown as AttemptRecord;
    const text = diagnosticsJson(r);
    expect(text).not.toContain('samples');
    expect(text).not.toContain('audioBuffer');
    expect(findAudio(JSON.parse(text))).toEqual([]);
  });

  it('findAudio flags typed arrays, buffers, audio data URLs, audio-named keys and long number arrays', () => {
    expect(findAudio(new Float32Array(3))).toEqual(['$']);
    expect(findAudio(new ArrayBuffer(8))).toEqual(['$']);
    expect(findAudio({ a: { samples: [1] } })).toEqual(['$.a.samples']);
    expect(findAudio('data:audio/wav;base64,AAAA')).toEqual(['$']);
    expect(findAudio(Array.from({ length: 2001 }, () => 0.1))).toEqual(['$']);
  });

  it('keeps audioEnv, which describes the device and holds gate results, not samples', () => {
    expect(findAudio({ audioEnv: { gateFailures: [] } })).toEqual([]);
    expect(buildDiagnosticsExport(record()).settings.audioEnv).toBeDefined();
  });

  it('exports a render stream timeline when one is passed', () => {
    const [src] = parseReplaySource('x.jsonl', fixtureText('mozart-violin-stop.events.jsonl'));
    const out = buildDiagnosticsExport(record(), src!.timeline);
    expect(out.events.length).toBe(src!.timeline.length);
  });
});
