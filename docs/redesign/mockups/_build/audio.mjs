// Renders one bar at quarter = 90 of each metronome sound in 06-design-spec.md section 9, plus today's Tick,
// as 16-bit mono WAV files in docs/redesign/audio/. Run: node docs/redesign/mockups/_build/audio.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'audio');
const SR = 48000;
const BPM = 90;
const CLICK_GAIN = 0.5; // clickGain today, about -6 dBFS
const ACCENT_DB = 3;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 40 seeded random-phase partials spread uniformly over [f1, f2]; partials above 0.475 x rate dropped.
function band(f1, f2, seed) {
  const r = rng(seed);
  const ps = [];
  for (let k = 0; k < 40; k++) {
    const f = f1 + r() * (f2 - f1);
    const ph = r() * 2 * Math.PI;
    if (f < 0.475 * SR) ps.push({ f, ph });
  }
  return ps;
}
const TICK = band(5500, 9000, 0x71c4);
// layer kinds: tick {A, L}, noise {f1,f2,A,att,tau,seed}, partial {f,A,att,tau}, tone {f,A,ramp,len}
function render(layers, lenMs) {
  const n = Math.round((lenMs / 1000) * SR);
  const out = new Float64Array(n);
  for (const L of layers) {
    if (L.f && L.f >= 0.475 * SR) continue;
    const ps = L.kind === 'tick' ? TICK : L.kind === 'noise' ? band(L.f1, L.f2, L.seed) : null;
    // normalise multi-partial layers so A means the layer's own peak
    const layer = new Float64Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let env, s;
      if (L.kind === 'tick') {
        env = Math.min(1, t / 0.002) * Math.exp((-5 * t) / (L.L / 1000));
      } else if (L.kind === 'tone') {
        const ramp = L.ramp / 1000, len = L.len / 1000;
        env = t > len ? 0 : t < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ramp) : t > len - ramp ? 0.5 - 0.5 * Math.cos((Math.PI * (len - t)) / ramp) : 1;
      } else {
        const att = (L.att ?? 0.5) / 1000;
        const a = L.halfCos ? (t < att ? 0.5 - 0.5 * Math.cos((Math.PI * t) / att) : 1) : Math.min(1, t / att);
        env = a * Math.exp(-t / (L.tau / 1000));
      }
      if (ps) { s = 0; for (const p of ps) s += Math.sin(2 * Math.PI * p.f * t + p.ph); }
      else s = Math.sin(2 * Math.PI * L.f * t);
      layer[i] = s * env;
      peak = Math.max(peak, Math.abs(layer[i]));
    }
    for (let i = 0; i < n; i++) out[i] += (layer[i] / (peak || 1)) * L.A;
  }
  // 3 ms raised-cosine fade at the end, peak-normalise to 1
  const fade = Math.round(0.003 * SR);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  return out.map((v) => v / pk);
}

const SOUNDS = {
  classic: {
    off: { len: 45, layers: [{ kind: 'tick', A: 0.5, L: 12 }, { kind: 'noise', f1: 1800, f2: 3200, A: 1, att: 0.5, tau: 6, seed: 0x300d }, { kind: 'partial', f: 1180, A: 0.45, att: 0.5, tau: 8 }, { kind: 'partial', f: 3050, A: 0.2, att: 0.5, tau: 4 }] },
    acc: { len: 60, layers: [{ kind: 'tick', A: 0.55, L: 14 }, { kind: 'noise', f1: 2200, f2: 3800, A: 1, att: 0.5, tau: 6, seed: 0x300d }, { kind: 'partial', f: 1575, A: 0.5, att: 0.5, tau: 9 }, { kind: 'partial', f: 4065, A: 0.22, att: 0.5, tau: 4 }, { kind: 'partial', f: 2362, A: 0.22, att: 1, tau: 18 }] },
  },
  woodblock: {
    off: { len: 55, layers: [{ kind: 'tick', A: 0.35, L: 10 }, { kind: 'partial', f: 1250, A: 1, att: 1, halfCos: true, tau: 14 }, { kind: 'partial', f: 3150, A: 0.32, att: 1, halfCos: true, tau: 6 }, { kind: 'partial', f: 5800, A: 0.15, att: 1, halfCos: true, tau: 2.5 }] },
    acc: { len: 60, layers: [{ kind: 'tick', A: 0.4, L: 12 }, { kind: 'partial', f: 1670, A: 1, att: 1, halfCos: true, tau: 14 }, { kind: 'partial', f: 4205, A: 0.32, att: 1, halfCos: true, tau: 6 }, { kind: 'partial', f: 7740, A: 0.15, att: 1, halfCos: true, tau: 2.5 }] },
  },
  beep: {
    off: { len: 30, layers: [{ kind: 'tick', A: 0.3, L: 8 }, { kind: 'tone', f: 2000, A: 0.8, ramp: 2, len: 30 }] },
    acc: { len: 30, layers: [{ kind: 'tick', A: 0.3, L: 8 }, { kind: 'tone', f: 3000, A: 0.8, ramp: 2, len: 30 }] },
  },
  // Today's Tick (renderClick in src/platform/web/audio/metronome.ts): the burst alone, 12 ms, accent 18 ms.
  'tick-today': {
    off: { len: 12, layers: [{ kind: 'tick', A: 1, L: 12 }] },
    acc: { len: 18, layers: [{ kind: 'tick', A: 1, L: 18 }] },
  },
};

function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}

mkdirSync(OUT, { recursive: true });
const beat = 60 / BPM;
const total = Math.round((4 * beat + 0.4) * SR);
for (const [name, s] of Object.entries(SOUNDS)) {
  const off = render(s.off.layers, s.off.len);
  const acc = render(s.acc.layers, s.acc.len);
  const bar = new Float64Array(total);
  // 200 ms of silence first, then one bar of four beats, accent on beat one
  for (let k = 0; k < 4; k++) {
    const src = k === 0 ? acc : off;
    const g = k === 0 ? Math.min(0.99, CLICK_GAIN * 10 ** (ACCENT_DB / 20)) : CLICK_GAIN;
    const at = Math.round((0.2 + k * beat) * SR);
    for (let i = 0; i < src.length; i++) bar[at + i] += src[i] * g;
  }
  writeFileSync(join(OUT, `${name}-bar-q90.wav`), wav(bar));
}
console.log('wrote', Object.keys(SOUNDS).map((n) => `${n}-bar-q90.wav`).join(', '));
