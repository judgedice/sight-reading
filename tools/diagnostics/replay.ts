// Replays an exported try (round 2 detection, src/session/diagnostics.ts): `pnpm exec tsx tools/diagnostics/replay.ts`.
//
// Reads a diagnostics file ("Export last try" in the app, or `PracticeSession.exportLastTry()`), rebuilds the try's
// DSP and follow configs with the current config/ files, and re-runs the detector and follower:
// - from the audio when the file has it (the opt-in "include microphone audio"): the low band goes through the DSP
//   worker core as capture blocks, so every segmenter and follower change is exercised;
// - otherwise from the trace: the traced detected notes go through the live follower and the final alignment (the
//   segmenter is not re-run).
// It prints one row per written note (the stored verdict, the replayed one, and the detected notes near it), the
// replayed extras and the ignored notes, and marks every row whose verdict changed.
//
//   tsx tools/diagnostics/replay.ts <file.json> [--try N] [--fixture out.json]
//
// `--fixture` writes the replay's inputs and verdicts as one JSON file, a starting point for a regression test
// (tools/diagnostics/replay.test.ts builds one from a synthetic try).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CaptureBlock, WorkerMessage, WorkerReply } from '../../src/core/platform.ts';
import type { ClockSeconds, DetectedNote, DspConfig, FinalAlignment, FollowConfig, NoteJudgment } from '../../src/core/types.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { LiveFollower, alignFinal, ignoredNote, liveOutcomeOf } from '../../src/follow/index.ts';
import { DspWorkerCore } from '../../src/platform/web/audio/dsp-worker-core.ts';
import { decodePcm16, type DiagnosticsFile, type TryTrace } from '../../src/session/diagnostics.ts';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (midi: number): string => `${NAMES[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
const BLOCK = 128;

export interface ReplayResult {
  source: 'audio' | 'trace';
  follow: FollowConfig;
  detected: DetectedNote[];
  alignment: FinalAlignment;
}

/** Rebuilds the try's follow config with the current configs. */
export function followOf(t: TryTrace): FollowConfig {
  const cfg = configs();
  const f = t.configs.follow;
  if (!f) throw new Error('the try has no follow config (practised without listening)');
  const instrument = cfg.instrumentById[f.instrumentId];
  if (!instrument) throw new Error(`unknown instrument ${f.instrumentId}`);
  const { instrumentId: _id, ...rest } = f;
  return { ...rest, cfg, instrument } as FollowConfig;
}

/** Re-runs the DSP worker core on the try's audio (the analysed low band). */
export function replayAudio(t: TryTrace, follow: FollowConfig): ReplayResult {
  const a = t.audio;
  const d = t.configs.dsp;
  if (!a || !d) throw new Error('the try has no audio');
  const cfg: DspConfig = { ...d, clickTemplate: d.clickTemplate ? Float32Array.from(d.clickTemplate) : null, traceAudio: false };
  const low = decodePcm16(a.data, a.samples);
  let done: Extract<WorkerReply, { type: 'done' }> | null = null;
  const core = new DspWorkerCore({ post: (r) => void (r.type === 'done' && (done = r)), nowMs: () => 0, setTimer: () => () => {} });
  const send = (m: WorkerMessage): void => core.onMessage(m);
  send({ v: 1, type: 'config', cfg, follow });
  let seq = 0;
  for (let i = 0; i < low.length; i += BLOCK) {
    const block: CaptureBlock = { v: 1, startT: (a.startT + i / a.rate) as ClockSeconds, lowband: low.slice(i, i + BLOCK), hiEnergy: new Float32Array(0), analysisRate: a.rate, seq: seq++ };
    send({ v: 1, type: 'block', block });
  }
  send({ v: 1, type: 'end', t: (a.startT + low.length / a.rate) as ClockSeconds, reason: { reason: 'complete' } });
  const r = done as Extract<WorkerReply, { type: 'done' }> | null;
  if (!r || !core.alignment) throw new Error('the DSP worker did not finish');
  return { source: 'audio', follow, detected: r.trace?.detected ?? r.detected, alignment: core.alignment };
}

/** Re-runs the live follower and the final alignment on the traced detected notes. */
export function replayTrace(t: TryTrace, follow: FollowConfig): ReplayResult {
  const detected = t.detected.map(({ ignored: _i, ...d }) => d as DetectedNote).sort((a, b) => a.onset - b.onset);
  const lf = new LiveFollower(follow);
  const events = [];
  // Note-on with the confirming pitch, then the final snapshot at its offset, in time order.
  const timeline: { t: number; kind: 'on' | 'off'; d: DetectedNote }[] = [];
  for (const d of detected) {
    timeline.push({ t: d.onset, kind: 'on', d: { ...d, offset: null, midi: d.provisionalMidi, steadyMs: 0 } });
    timeline.push({ t: d.offset ?? d.onset, kind: 'off', d });
  }
  timeline.sort((a, b) => a.t - b.t || (a.kind === 'off' ? -1 : 1));
  for (const x of timeline) {
    for (const e of lf.onClock(x.t as ClockSeconds)) events.push(e);
    for (const e of lf.onDsp(x.kind === 'on' ? { type: 'note-on', note: x.d } : { type: 'note-off', note: x.d })) events.push(e);
  }
  const end = (timeline.at(-1)?.t ?? 0) + 1;
  for (const e of lf.end(end as ClockSeconds, { reason: 'complete' })) events.push(e);
  return { source: 'trace', follow, detected, alignment: alignFinal(follow, detected, liveOutcomeOf(events)) };
}

const verdict = (j: NoteJudgment | undefined): string =>
  !j ? '-' : j.status === 'missed' ? 'missed' : `${j.timing}${j.pitch && j.pitch !== 'in-tune' && j.pitch !== 'not-graded' ? ` ${j.pitch}` : ''}`;

/** The per-note table as text. */
export function table(t: TryTrace, r: ReplayResult): string {
  const f = r.follow;
  const lines: string[] = [];
  const beat = 60 / f.bpm;
  lines.push(`try ${t.attemptId} ${t.excerpt.instrumentId} L${t.excerpt.level} ${t.excerpt.bpm} bpm, end ${t.endReason}; replayed from the ${r.source}`);
  lines.push(`detected ${r.detected.length} notes (${r.detected.filter((d) => ignoredNote(f, d)).length} ignored), ${f.expected.length} written`);
  lines.push('');
  lines.push(['#', 'beat', 'written', 'stored', 'replayed', 'Δt ms', 'cents', 'detected near it (score s, pitch, length)'].join('\t'));
  const s = (d: DetectedNote): number => d.onset - f.t0 - f.latencyCompensationSec;
  for (const e of f.expected) {
    const was = t.verdicts.judgments[e.idx];
    const now = r.alignment.judgments[e.idx];
    const w = f.tolerances[e.idx]?.matchWindowSec ?? 0.25;
    const near = r.detected
      .filter((d) => Math.abs(s(d) - e.onsetSec) <= w)
      .map((d) => `${d.id}@${s(d).toFixed(2)} ${noteName(d.midi)}${d.stableMedianCents >= 0 ? '+' : ''}${d.stableMedianCents.toFixed(0)} ${(((d.offset ?? d.onset) - d.onset) * 1000).toFixed(0)}ms${ignoredNote(f, d) ? ' ignored' : ''}`);
    const changed = verdict(was) !== verdict(now) ? ' ≠' : '';
    lines.push(
      [
        String(e.idx),
        (e.onsetSec / beat).toFixed(2),
        noteName(e.concertMidi),
        verdict(was),
        verdict(now) + changed,
        now?.timingErrorMs === null || now?.timingErrorMs === undefined ? '' : now.timingErrorMs.toFixed(0),
        now?.centsError === null || now?.centsError === undefined ? '' : now.centsError.toFixed(0),
        near.join('; '),
      ].join('\t'),
    );
  }
  lines.push('');
  lines.push(`extras: stored ${t.verdicts.extras.length}, replayed ${r.alignment.extras.length}`);
  for (const x of r.alignment.extras) lines.push(`  extra at score ${x.onsetSec.toFixed(2)} s, ${noteName(x.concertMidi)}, ${(x.durSec * 1000).toFixed(0)} ms`);
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    process.stderr.write('usage: tsx tools/diagnostics/replay.ts <file.json> [--try N] [--fixture out.json]\n');
    process.exit(2);
  }
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const data = JSON.parse(readFileSync(file, 'utf8')) as DiagnosticsFile;
  const t = data.tries[Number(opt('try') ?? 0)];
  if (!t) throw new Error('no such try in the file');
  const follow = followOf(t);
  const r = t.audio ? replayAudio(t, follow) : replayTrace(t, follow);
  process.stdout.write(`${table(t, r)}\n`);
  const out = opt('fixture');
  if (out) {
    const { cfg: _c, instrument, ...f } = follow;
    writeFileSync(out, `${JSON.stringify({ attemptId: t.attemptId, follow: { ...f, instrumentId: instrument.id }, detected: r.detected, judgments: r.alignment.judgments, extras: r.alignment.extras }, null, 1)}\n`);
    process.stderr.write(`replay: wrote ${out}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
