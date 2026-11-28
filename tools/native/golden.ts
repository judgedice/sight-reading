// Golden vectors for the Rust ports in src-tauri/crates/sr-audio-core/src/synth.rs.
//
// Renders clicks (renderClick), Listen notes (renderListenNote) and the sanity tone (renderTone) with the
// TypeScript implementations at 44.1 and 48 kHz and writes each as raw little-endian float32 samples to
// src-tauri/crates/sr-audio-core/tests/golden/<name>-<rate>.f32. The Rust tests `synth_click_golden`,
// `synth_listen_golden` and `synth_tone_golden` render the same cases and compare (max difference 1e-6).
// The case list here and `GOLDEN_*` in synth.rs must stay the same.
//
// Run: pnpm exec tsx tools/native/golden.ts            (writes the files)
//      pnpm exec tsx tools/native/golden.ts --check    (exits 1 when a file differs from a fresh render)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderClick } from '../../src/core/click-sounds.ts';
import type { ClickTimbre } from '../../src/core/types.ts';
import { renderListenNote } from '../../src/platform/shared/audio/listen-voice.ts';
import { renderTone } from '../../src/platform/shared/audio/render-tone.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/crates/sr-audio-core/tests/golden');
const RATES = [44100, 48000] as const;

const CLICKS: readonly (readonly [ClickTimbre, boolean])[] = [
  ['tick', false],
  ['tick', true],
  ['wood', false],
  ['classic', false],
  ['classic', true],
  ['woodblock', true],
  ['beep', false],
];
/** [name, hz, durSec, peak]. The last one has its third harmonic above Nyquist. */
const LISTEN: readonly (readonly [string, number, number, number])[] = [
  ['listen-c4', 261.6255653005986, 0.05, 1],
  ['listen-high', 9000, 0.02, 0.5],
];
/** [name, hz, durSec, peak]. The second is shorter than two fades. */
const TONES: readonly (readonly [string, number, number, number])[] = [
  ['tone-1k', 1000, 0.04, 0.25],
  ['tone-short', 440, 0.012, 1],
];

function vectors(): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  for (const rate of RATES) {
    for (const [timbre, accent] of CLICKS) out.set(`click-${timbre}-${accent ? 'accent' : 'offbeat'}-${rate}`, renderClick(timbre, accent, rate));
    for (const [name, hz, dur, peak] of LISTEN) out.set(`${name}-${rate}`, renderListenNote(hz, dur, rate, peak));
    for (const [name, hz, dur, peak] of TONES) out.set(`${name}-${rate}`, renderTone(hz, dur, rate, peak));
  }
  return out;
}

const check = process.argv.includes('--check');
mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
let stale = 0;
for (const [name, samples] of vectors()) {
  const bytes = Buffer.alloc(samples.length * 4);
  samples.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  const file = join(OUT_DIR, `${name}.f32`);
  total += bytes.length;
  if (check) {
    let same = false;
    try {
      same = readFileSync(file).equals(bytes);
    } catch {
      same = false;
    }
    if (!same) {
      stale += 1;
      console.error(`stale: ${name}.f32`);
    }
  } else {
    writeFileSync(file, bytes);
  }
}
process.stdout.write(`${check ? 'checked' : 'wrote'} ${vectors().size} vectors, ${total} bytes, in ${OUT_DIR}\n`);
if (stale > 0) process.exit(1);
