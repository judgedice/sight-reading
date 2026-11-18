/**
 * The 6 reference WAVs (01 section 14 item 12). Their specs live here; the rendered files and their SHA-256
 * checksums are committed in `ref/`. A test re-renders each spec on the current Node and compares both.
 * Regenerate (only when the synth changes on purpose): `pnpm tsx src/testkit/ref/generate-refs.ts`.
 */
import { encodeWav } from './wav.ts';
import { renderMin, type SynthClick, type SynthResult, type SynthSpec } from './synth-min.ts';

export const REF_SAMPLE_RATE = 48000;

const beat = (b: number, bpm: number): number => 0.5 + (b * 60) / bpm;
const clicksAt = (bpm: number, count: number): SynthClick[] =>
  Array.from({ length: count }, (_, i) => ({ t: beat(i, bpm), accent: i % 4 === 0 }));

export const REF_SPECS: Record<string, SynthSpec> = {
  /** One sustained A4, harmonic stack, no noise. */
  'single-a4': {
    sampleRate: REF_SAMPLE_RATE,
    notes: [{ midi: 69, onsetSec: 0.25, durSec: 1.5 }],
    durationSec: 2.2,
  },
  /** C major scale, detached notes, 120 bpm eighth notes. */
  'scale-detached': {
    sampleRate: REF_SAMPLE_RATE,
    notes: [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, onsetSec: 0.2 + i * 0.25, durSec: 0.2 })),
    durationSec: 2.6,
  },
  /** Legato run with glides: the pitch-change onset case. */
  'legato-run': {
    sampleRate: REF_SAMPLE_RATE,
    notes: [67, 69, 71, 72, 71, 69, 67].map((midi, i) => ({ midi, onsetSec: 0.2 + i * 0.3, durSec: 0.3, legato: i > 0 })),
    glideSec: 0.04,
    durationSec: 2.8,
  },
  /** Four repeated notes with 6 dB tonguing dips: the repeated-onset case. */
  'tongued-repeats': {
    sampleRate: REF_SAMPLE_RATE,
    notes: [0, 1, 2, 3].map((i) => ({ midi: 64, onsetSec: 0.2 + i * 0.4, durSec: 0.4, tongueDipDb: i === 0 ? 0 : 6 })),
    durationSec: 2.2,
  },
  /** Tick click bleed at -20 dB under a short phrase, count-in then notes. */
  'bleed-tick': {
    sampleRate: REF_SAMPLE_RATE,
    notes: [60, 64, 67, 72].map((midi, i) => ({ midi, onsetSec: beat(4 + i, 90), durSec: 0.55 })),
    clicks: clicksAt(90, 8),
    clickTimbre: 'tick',
    bleedDb: -20,
    durationSec: 5.2,
  },
  /** Wood click bleed at -10 dB, vibrato and a -45 dBFS noise floor. */
  'bleed-wood-noise': {
    sampleRate: REF_SAMPLE_RATE,
    notes: [69, 72, 76, 72].map((midi, i) => ({ midi, onsetSec: beat(4 + i, 90), durSec: 0.55, cents: i === 1 ? 20 : 0 })),
    clicks: clicksAt(90, 8),
    clickTimbre: 'wood',
    bleedDb: -10,
    vibrato: { hz: 5.5, cents: 30 },
    noiseDbfs: -45,
    seed: 7,
    durationSec: 5.2,
  },
};

export const REF_NAMES = Object.keys(REF_SPECS);

export function renderRef(name: string): SynthResult {
  const spec = REF_SPECS[name];
  if (!spec) throw new Error(`Unknown reference WAV: ${name}`);
  return renderMin(spec);
}

export function renderRefWavBytes(name: string): Uint8Array {
  const r = renderRef(name);
  return encodeWav({ sampleRate: r.sampleRate, channels: [r.samples] }, { format: 'pcm16' });
}
