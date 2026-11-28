// The replay tool (round 2 detection): a synthetic untrained-voice try is traced as the session would trace it, then
// replayed from its audio and from its trace; both reproduce the try's verdicts.
import { describe, expect, it } from 'vitest';
import type { WorkerMessage, WorkerReply } from '../../src/core/platform.ts';
import type { ClockSeconds } from '../../src/core/types.ts';
import { DspWorkerCore } from '../../src/platform/shared/audio/dsp-worker-core.ts';
import { encodePcm16, TRACE_FORMAT, type TryTrace } from '../../src/session/diagnostics.ts';
import { captureBlocks, gateDspConfig } from '../../src/testkit/gates/run-take.ts';
import { renderUntrained, untrainedPlans } from '../../src/testkit/untrained/run.ts';
import { withOwnPlayback } from '../../src/follow/index.ts';
import { resolveOneNote, resolveTolerances } from '../../src/rules/index.ts';
import { scenarioConfigs } from '../../src/testkit/scenarios/index.ts';
import { followOf, replayAudio, replayTrace, table } from './replay.ts';

function syntheticTrace(): TryTrace {
  const p = untrainedPlans(1)[0]!;
  const r = renderUntrained(p);
  const cfg = scenarioConfigs();
  const base = p.base;
  const tolerances = resolveTolerances(base.expected, { instrument: base.inst, level: base.level, bpm: base.bpm, meter: base.meter }, cfg);
  const dsp = { ...gateDspConfig(r, tolerances, 16000, cfg), traceAudio: true };
  const follow = withOwnPlayback(
    { expected: base.expected, tolerances, t0: r.t0Sec as ClockSeconds, latencyCompensationSec: 0, bpm: base.bpm, beatsPerBar: base.beatsPerBar, instrument: base.inst, cfg, voiceReferenceCents: 0, analysisRate: 16000, writtenKey: base.writtenKey, oneNote: resolveOneNote(cfg, base.inst, base.level) },
    r.clicks.map((k) => ({ t: k.t as ClockSeconds, durSec: 0.04, hz: null })),
  );
  let done: Extract<WorkerReply, { type: 'done' }> | null = null;
  const core = new DspWorkerCore({ post: (x) => void (x.type === 'done' && (done = x)), nowMs: () => 0, setTimer: () => () => {} });
  const send = (m: WorkerMessage): void => core.onMessage(m);
  send({ v: 1, type: 'config', cfg: dsp, follow });
  const endT = r.t0Sec + p.timeline.endScoreSec;
  for (const block of captureBlocks(r.samples, r.sampleRate)) {
    if ((block.startT as number) >= endT) break;
    send({ v: 1, type: 'block', block });
  }
  send({ v: 1, type: 'end', t: endT as ClockSeconds, reason: { reason: 'complete' } });
  const d = done as unknown as Extract<WorkerReply, { type: 'done' }>;
  const a = d.trace!.audio!;
  const { cfg: _c, instrument, ...f } = follow;
  return {
    format: TRACE_FORMAT,
    version: 1,
    attemptId: 'synthetic-0001',
    excerpt: { excerptId: base.excerptId, instrumentId: base.instrumentId, level: base.level, bpm: base.bpm },
    endReason: 'complete',
    configs: { dsp: { ...dsp, clickTemplate: dsp.clickTemplate ? Array.from(dsp.clickTemplate) : null }, follow: { ...f, instrumentId: instrument.id } },
    frames: d.trace!.frames,
    detected: d.trace!.detected.map((x) => ({ ...x, ignored: false })),
    verdicts: { judgments: core.alignment!.judgments, extras: core.alignment!.extras, displaced: core.alignment!.displaced, score: null },
    audio: { rate: a.rate, startT: a.startT, encoding: 'pcm16le-base64', samples: a.samples.length, data: encodePcm16(a.samples) },
  } as unknown as TryTrace;
}

describe('tools/diagnostics/replay', () => {
  const t = syntheticTrace();
  const key = (j: TryTrace['verdicts']['judgments'][number]): string => `${j.expectedIdx}:${j.status}:${j.timing}:${j.pitch}`;

  it('replays from the audio: the same verdicts as the try', () => {
    const r = replayAudio(t, followOf(t));
    expect(r.alignment.judgments.map(key)).toEqual(t.verdicts.judgments.map(key));
    expect(r.alignment.extras.length).toBe(t.verdicts.extras.length);
    expect(table(t, r)).toContain('replayed from the audio');
  }, 60_000);

  it('replays from the trace alone: the same final verdicts', () => {
    const { audio: _a, ...noAudio } = t;
    const r = replayTrace(noAudio as TryTrace, followOf(t));
    expect(r.alignment.judgments.map(key)).toEqual(t.verdicts.judgments.map(key));
    const text = table(noAudio as TryTrace, r);
    expect(text.split('\n').filter((l) => l.includes('≠'))).toEqual([]);
  }, 60_000);

  it('the trace without audio stays small (under 200 KB a try)', () => {
    const { audio: _a, ...noAudio } = t;
    const bytes = JSON.stringify(noAudio).length;
    expect(bytes).toBeLessThan(200_000);
    expect(bytes / (t.frames!.t.at(-1)! - t.frames!.t[0]!)).toBeLessThan(5000); // under 5 KB a second of capture
  });
});
