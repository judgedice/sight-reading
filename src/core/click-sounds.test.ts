import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CLICK_FADE_SEC,
  CLICK_RECIPES,
  clickArrivalShape,
  clickFoundInHiBand,
  clickLengthSec,
  DEFAULT_METRONOME_SOUND,
  METRONOME_SOUNDS,
  metronomeSoundOf,
  renderClick,
  renderRecipe,
  SOUND_ON_SPEAKERS,
  soundAllowed,
} from './click-sounds.ts';

const SR = 48000;
const sha = (x: Float32Array): string => createHash('sha256').update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)).digest('hex');

/**
 * SHA-256 of the pre-redesign `renderClick` output (src/platform/shared/audio/metronome.ts at the redesign checkpoint),
 * Float32 bytes. Tick and Wood must stay bit-identical: the testkit, the dsp tests and stored templates rely on them.
 */
const LEGACY_SHA: Record<string, string> = {
  '48000 tick false': '1bcfbe491ce83164d2e5bc69d97b06522d5d890ed48ed71872ed1ef682e2e8a6',
  '48000 tick true': 'd889d91bb8ecd3c14b78bb4abfd4b7b9cb34c797e14c81d3a9997ea7d05c6014',
  '48000 wood false': 'd28c6012f897bc23b120695b8f9e23537f063ac57d582eb9380dd115167ab70c',
  '48000 wood true': 'd28c6012f897bc23b120695b8f9e23537f063ac57d582eb9380dd115167ab70c',
  '44100 tick false': '8c08837be310ca92b0ec1b6d749cb3b277484e854f169a0b6f7dcc41a20c28e3',
  '44100 tick true': '4941ce8383a8d3f48fd395d42ad12de642d4d1220c498a835b88276c56ade04f',
  '44100 wood false': '1d033b73910b1c6b10aef2326011f9f5543df715ad3e5586f89b1f51c4c00936',
  '44100 wood true': '1d033b73910b1c6b10aef2326011f9f5543df715ad3e5586f89b1f51c4c00936',
  '16000 tick false': '0e50c8bd93ab6e2ee49de9b401d0f7e958486273efd5109d53a4272427040835',
  '16000 tick true': 'b46f7fba8da5773845c66094abe929de607ebf18766333cdb2876d3ed54f1961',
  '16000 wood false': '42ba96b1c2ab5d58fb5d1d4c92b1a8493ce148dfea7a9f7d183b34f2349f64ce',
  '16000 wood true': '42ba96b1c2ab5d58fb5d1d4c92b1a8493ce148dfea7a9f7d183b34f2349f64ce',
};

/**
 * Energy below `hz` relative to all energy, dB: Hann-windowed DFT (8192 points) of the samples from `fromSec` on.
 * The window keeps the cut at `fromSec` from splattering energy across the spectrum.
 */
function lowBandDb(x: Float32Array, rate: number, hz: number, fromSec: number): number {
  const seg = x.slice(Math.round(fromSec * rate));
  const n = 8192;
  const m = seg.length;
  let low = 0;
  let all = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < m; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (m - 1));
      const a = (-2 * Math.PI * k * i) / n;
      re += (seg[i] as number) * w * Math.cos(a);
      im += (seg[i] as number) * w * Math.sin(a);
    }
    const p = re * re + im * im;
    all += p;
    if ((k * rate) / n < hz) low += p;
  }
  return 10 * Math.log10(low / all);
}

const peakOf = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('legacy Tick and Wood', () => {
  for (const key of Object.keys(LEGACY_SHA)) {
    it(`render bit-identically to the pre-redesign metronome (${key})`, () => {
      const [rate, timbre, accent] = key.split(' ') as [string, 'tick' | 'wood', string];
      expect(sha(renderClick(timbre, accent === 'true', Number(rate)))).toBe(LEGACY_SHA[key]);
    });
  }
});

describe('Classic, Woodblock and Beep (06 section 9)', () => {
  for (const sound of METRONOME_SOUNDS) {
    for (const accent of [false, true]) {
      const name = `${sound} ${accent ? 'accent' : 'offbeat'}`;
      it(`${name}: 60 ms or shorter, peak-normalised, 3 ms fade to zero`, () => {
        for (const rate of [48000, 44100]) {
          const x = renderClick(sound, accent, rate);
          expect(x.length / rate).toBeLessThanOrEqual(0.06 + 1e-9);
          expect(x.length).toBe(Math.round(clickLengthSec(sound, accent) * rate));
          expect(peakOf(x)).toBeCloseTo(1, 6);
          expect(Math.abs(x[x.length - 1] as number)).toBe(0);
          // Inside the fade the level is below the fade curve's bound.
          const fade = Math.round(CLICK_FADE_SEC * rate);
          for (let i = 1; i < fade; i++) expect(Math.abs(x[x.length - 1 - i] as number)).toBeLessThanOrEqual(0.5 - 0.5 * Math.cos((Math.PI * i) / fade) + 1e-6);
        }
      });

      it(`${name}: no energy above -40 dB below 1 kHz after 5 ms`, () => {
        const db = lowBandDb(renderClick(sound, accent, SR), SR, 1000, 0.005);
        expect(db).toBeLessThan(-40);
      });

      it(`${name}: starts with the Tick layer at sample 0, body layers from sample 0 with an attack of 1 ms or less`, () => {
        const r = accent ? CLICK_RECIPES[sound].accent : CLICK_RECIPES[sound].offbeat;
        expect(r.layers[0]?.kind).toBe('tick');
        expect(r.layers.filter((l) => l.kind === 'tick')).toHaveLength(1);
        for (const l of r.layers) {
          if (l.kind === 'partial' || l.kind === 'band') {
            expect(l.attackSec).toBeLessThanOrEqual(0.001);
            expect(l.tauSec).toBeLessThanOrEqual(0.018);
          }
          if (l.kind === 'tone') expect(l.lengthSec).toBeLessThanOrEqual(0.03);
          // Nothing tonal below 1 kHz.
          if (l.kind === 'partial' || l.kind === 'tone') expect(l.hz).toBeGreaterThanOrEqual(1000);
          if (l.kind === 'band') expect(l.f1).toBeGreaterThanOrEqual(1000);
        }
        // The rise starts within the first millisecond: no layer delays the onset edge.
        const x = renderClick(sound, accent, SR);
        const first = x.findIndex((v) => Math.abs(v) > 0.05);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first / SR).toBeLessThan(0.001);
      });

      it(`${name}: its Tick layer is today's Tick (same partials and attack)`, () => {
        // The layer alone at the Tick's own length is the Tick, up to float rounding.
        const t = (accent ? CLICK_RECIPES[sound].accent : CLICK_RECIPES[sound].offbeat).layers[0];
        if (t?.kind !== 'tick') throw new Error('no tick layer');
        const tick = renderClick('tick', false, SR);
        const layer = renderRecipe({ lengthSec: 0.012 + CLICK_FADE_SEC + 0.01, layers: [{ ...t, lengthSec: 0.012 }] }, SR);
        // Same samples as the Tick over its first 5 ms (before any fade), after both are peak-normalised.
        const n5 = Math.round(0.005 * SR);
        const g = peakOf(layer.slice(0, tick.length)) / peakOf(tick);
        for (let i = 0; i < n5; i++) expect(layer[i] as number).toBeCloseTo((tick[i] as number) * g, 5);
      });
    }

    it(`${sound}: the accent recipe differs from the offbeat recipe`, () => {
      const a = renderClick(sound, true, SR);
      const o = renderClick(sound, false, SR);
      expect(sha(a)).not.toBe(sha(o));
    });

    it(`${sound}: renders at a 16 kHz route without aliasing partials (finite, normalised)`, () => {
      for (const accent of [false, true]) {
        const x = renderClick(sound, accent, 16000);
        expect(Array.from(x).every(Number.isFinite)).toBe(true);
        expect(peakOf(x)).toBeCloseTo(1, 6);
      }
    });

    it(`${sound}: is deterministic`, () => {
      expect(sha(renderClick(sound, true, SR))).toBe(sha(renderClick(sound, true, SR)));
    });
  }

  it('arrival envelopes: Tick unchanged, new sounds use their Tick layer, Wood its burst', () => {
    expect(clickArrivalShape('tick', true)).toEqual({ attackSec: 0.002, lengthSec: 0.018 });
    expect(clickArrivalShape('tick', false)).toEqual({ attackSec: 0.002, lengthSec: 0.012 });
    expect(clickArrivalShape('wood', false)).toEqual({ attackSec: 0.001, lengthSec: 0.008 });
    expect(clickArrivalShape('classic', false)).toEqual({ attackSec: 0.002, lengthSec: 0.012 });
    expect(clickArrivalShape('classic', true)).toEqual({ attackSec: 0.002, lengthSec: 0.014 });
    expect(clickArrivalShape('woodblock', false)).toEqual({ attackSec: 0.002, lengthSec: 0.01 });
    expect(clickArrivalShape('beep', true)).toEqual({ attackSec: 0.002, lengthSec: 0.008 });
    expect(METRONOME_SOUNDS.every(clickFoundInHiBand)).toBe(true);
    expect(clickFoundInHiBand('wood')).toBe(false);
  });
});

describe('metronomeSoundOf (08 decision 4)', () => {
  it('maps the legacy names and defaults to Classic', () => {
    expect(DEFAULT_METRONOME_SOUND).toBe('classic');
    expect(metronomeSoundOf('tick')).toBe('classic');
    expect(metronomeSoundOf('wood')).toBe('woodblock');
    expect(metronomeSoundOf('classic')).toBe('classic');
    expect(metronomeSoundOf('woodblock')).toBe('woodblock');
    expect(metronomeSoundOf('beep')).toBe('beep');
    expect(metronomeSoundOf(undefined)).toBe('classic');
    expect(metronomeSoundOf('cowbell')).toBe('classic');
  });
});

describe('speaker gate verdict (06 section 9.5)', () => {
  it('Classic, the default, is allowed on speakers; every sound is allowed in headphone modes', () => {
    expect(SOUND_ON_SPEAKERS.classic).toBe(true);
    for (const sound of METRONOME_SOUNDS) {
      expect(soundAllowed(sound, 'wired')).toBe(true);
      expect(soundAllowed(sound, 'bluetooth')).toBe(true);
      expect(soundAllowed(sound, 'speakers')).toBe(SOUND_ON_SPEAKERS[sound]);
    }
  });
});
