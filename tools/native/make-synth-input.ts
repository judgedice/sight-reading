// Renders a synthetic performance to a raw little-endian mono f32 file, the format of the fake audio device's input
// (`SR_FAKE_INPUT_F32` and the `audio_debug_signal` hook, src-tauri/crates/sr-audio-device/src/fake_io.rs).
//
// It makes the same performance as the web loop e2e (e2e/loop/loop.spec.ts): the P3 flute synth plays the excerpt's
// expected notes through `perform` with one note two semitones sharp (e2e/loop/node-helpers.ts, `loopNotes`), so
// the graded result of a native try and of a web try can be compared note by note.
//
//   pnpm exec tsx tools/native/make-synth-input.ts take --plan plan.json --out take.f32 [--rate 48000] [--lead 0.5] [--meta meta.json]
//   pnpm exec tsx tools/native/make-synth-input.ts tone --midi 72 --sec 4 --out tone.f32 [--rate 48000]
//
// `take`: `plan.json` is what the page reports (`{ instrumentId, bpm, beatsPerBar, endSec, expected }`, see
// `PagePlan`). Sample 0 of the file is `lead` seconds before bar 1 beat 1 of the performance, so the engine must start
// the file at (the take's `t0` + the round trip - `lead`) for the music to land on the take's timeline. `meta.json`
// gets `{ rate, leadSec, durationSec, wrongIdx, noteCount }`.
// `tone`: a steady flute note (the onboarding's "Hear you" stage).
import { readFileSync, writeFileSync } from 'node:fs';
import { loopNotes, wrongNoteIdx, type PagePlan } from '../../e2e/loop/node-helpers.ts';
import { renderPerformance } from '../../src/testkit/synth/index.ts';

function args(argv: string[]): { cmd: string; opt: Map<string, string> } {
  const [cmd = '', ...rest] = argv;
  const opt = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    const v = rest[i + 1];
    if (!k?.startsWith('--') || v === undefined) throw new Error(`bad argument near ${k ?? '(end)'}`);
    opt.set(k.slice(2), v);
  }
  return { cmd, opt };
}

const { cmd, opt } = args(process.argv.slice(2));
const need = (k: string): string => {
  const v = opt.get(k);
  if (v === undefined) throw new Error(`missing --${k}`);
  return v;
};
const num = (k: string, d: number): number => {
  const v = opt.get(k);
  return v === undefined ? d : Number(v);
};

function writeRaw(path: string, samples: Float32Array): void {
  writeFileSync(path, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
}

const rate = num('rate', 48000);
if (cmd === 'take') {
  const plan = JSON.parse(readFileSync(need('plan'), 'utf8')) as PagePlan;
  if (plan.instrumentId !== 'flute') throw new Error(`the synthetic performance is a flute's (the page chose ${plan.instrumentId})`);
  const lead = num('lead', 0.5);
  const durationSec = lead + plan.endSec + 1.5;
  const samples = renderPerformance({ timbre: 'flute', notes: loopNotes(plan, lead), sampleRate: rate, durationSec, seed: 11 }).samples;
  writeRaw(need('out'), samples);
  const meta = { rate, leadSec: lead, durationSec, wrongIdx: wrongNoteIdx(plan.expected), noteCount: plan.expected.length };
  if (opt.has('meta')) writeFileSync(need('meta'), JSON.stringify(meta));
  process.stdout.write(`${JSON.stringify(meta)}\n`);
} else if (cmd === 'tone') {
  const midi = num('midi', 72);
  const sec = num('sec', 4);
  const samples = renderPerformance({ timbre: 'flute', notes: [{ midi, cents: 0, onsetSec: 0.2, durSec: sec - 0.4, slur: false, ref: 0 }], sampleRate: rate, durationSec: sec, seed: 3 }).samples;
  writeRaw(need('out'), samples);
  process.stdout.write(`${JSON.stringify({ rate, midi, durationSec: sec })}\n`);
} else {
  throw new Error('usage: make-synth-input.ts take|tone ... (see the file header)');
}
