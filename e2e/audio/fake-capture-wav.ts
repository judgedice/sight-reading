// Renders the fake-capture WAV for the Chromium audio specs with the testkit synth: a sustained A4 (pure sine,
// -12 dBFS) for 4 s, looped by Chromium's fake device (no %noloop), so any capture length has signal.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMin } from '../../src/testkit/synth-min.ts';
import { encodeWav } from '../../src/testkit/wav.ts';

export const FAKE_WAV_HZ = 440;
export const FAKE_WAV_RATE = 48000;

export function writeFakeCaptureWav(dir: string): string {
  const r = renderMin({
    sampleRate: FAKE_WAV_RATE,
    notes: [{ midi: 69, onsetSec: 0, durSec: 4 }],
    harmonics: [1],
    adsr: { attackSec: 0.001, releaseSec: 0.001 },
    levelDb: -12,
    durationSec: 4,
  });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'a4-sine-48k.wav');
  writeFileSync(path, encodeWav({ sampleRate: r.sampleRate, channels: [r.samples] }));
  return path;
}
