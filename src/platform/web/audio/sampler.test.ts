import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSoundManifest, type SampleDef, type SoundManifest } from './sample-manifest.ts';
import {
  envelopePoints,
  isSamplerContext,
  loopPoints,
  midiOfHz,
  onsetSec,
  onsetShift,
  pickSample,
  playbackRateFor,
  Sampler,
  stopTimeFor,
  type DecodedBuffer,
  type Decoder,
  type FetchLike,
  type FetchResponseLike,
  type SamplerContext,
  type SamplerGain,
  type SamplerNode,
  type SamplerSource,
} from './sampler.ts';

const raw: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../public/sounds/index.json', import.meta.url)), 'utf8'));
const manifest: SoundManifest = parseSoundManifest(raw);
const set = (id: string) => {
  const s = manifest.sets[id];
  if (!s) throw new Error(`no set ${id}`);
  return s;
};
const sample = (id: string, midi: number): SampleDef => {
  const s = set(id).samples.find((x) => x.midi === midi);
  if (!s) throw new Error(`no sample ${id}/${midi}`);
  return s;
};
const cents = (rate: number): number => 1200 * Math.log2(rate);

describe('the manifest', () => {
  it('reads every set in public/sounds/index.json, ascending, with the fields the sampler needs', () => {
    expect(Object.keys(manifest.sets)).toHaveLength(24);
    for (const [id, s] of Object.entries(manifest.sets)) {
      expect(s.samples.map((x) => x.midi), id).toEqual([...s.samples.map((x) => x.midi)].sort((a, b) => a - b));
      if (s.kind === 'sustain') for (const x of s.samples) expect(x.loopEnd! > x.loopStart!, `${id}/${x.file}`).toBe(true);
    }
    expect(set('piano').kind).toBe('decay');
    expect(set('guitar').kind).toBe('decay');
  });

  it('refuses a file it cannot use, and a sample path that leaves its folder', () => {
    expect(() => parseSoundManifest(null)).toThrow();
    expect(() => parseSoundManifest({ sets: { flute: { kind: 'sustain', samples: [] } } })).toThrow(/no samples/);
    expect(() => parseSoundManifest({ sets: { flute: { kind: 'loop', samples: [{ file: 'C4.mp3', midi: 60 }] } } })).toThrow(/kind/);
    expect(() => parseSoundManifest({ sets: { flute: { kind: 'decay', samples: [{ file: '../x.mp3', midi: 60 }] } } })).toThrow(/leaves/);
  });
});

// The six cases (02-sounds.md "Sampler design", steps 2 to 4), on the shipped manifest values.
describe('pick, rate and loop points', () => {
  it('1. flute C5: the nearest sample is A4 (3 semitones up beats E5, 4 down); rate +3 semitones less its tune', () => {
    const s = pickSample(set('flute').samples, 72);
    expect(s.midi).toBe(69);
    expect(cents(playbackRateFor(72, s))).toBeCloseTo(300 - 0.1, 6);
  });

  it('2. a tie goes to the sample above: bass voice F#2 is between E2 and G#2 and plays G#2 shifted down', () => {
    const s = pickSample(set('voice-bass').samples, 42);
    expect(s.midi).toBe(44);
    expect(cents(playbackRateFor(42, s))).toBeCloseTo(-200, 6);
    // A#2 is two semitones from both G#2 and C3: C3 plays.
    expect(pickSample(set('voice-bass').samples, 46).midi).toBe(48);
    expect(pickSample(set('voice-bass').samples, 45).midi).toBe(44);
  });

  it('3. the tuning pitch moves the rate: A4 = 442 Hz is +7.85 cents on every note', () => {
    const s = sample('violin', 71);
    const at440 = playbackRateFor(71, s, 440);
    const at442 = playbackRateFor(71, s, 442);
    expect(cents(at442 / at440)).toBeCloseTo(1200 * Math.log2(442 / 440), 6);
    expect(cents(at440)).toBeCloseTo(1.6, 6);
  });

  it('4. below the set: tuba D1 plays the F1 sample 3 semitones down, correcting its -16.7 cent tune', () => {
    const s = pickSample(set('tuba').samples, 26);
    expect(s.midi).toBe(29);
    expect(s.tune).toBeCloseTo(-16.7, 6);
    expect(cents(playbackRateFor(26, s))).toBeCloseTo(-300 + 16.7, 6);
  });

  it('5. a stretch-tuned piano C7 (+25.9 cents) plays at its own pitch less the stretch', () => {
    const s = pickSample(set('piano').samples, 96);
    expect(s.midi).toBe(96);
    expect(cents(playbackRateFor(96, s))).toBeCloseTo(-25.9, 6);
  });

  it('6. loop points: sustained sets loop at the manifest points plus the onset shift; one-shots and overlong loops do not loop', () => {
    const fl = sample('flute', 60);
    expect(loopPoints('sustain', fl, 0, 1.908)).toEqual({ loopStart: 0.9, loopEnd: 1.84846 });
    const shifted = loopPoints('sustain', fl, 0.025, 1.95);
    expect(shifted?.loopStart).toBeCloseTo(0.925, 9);
    expect(shifted?.loopEnd).toBeCloseTo(1.87346, 9);
    expect(loopPoints('decay', sample('piano', 60 + 12), 0, 3)).toBeNull();
    // A decoder that trims the tail would wrap into silence: no loop then.
    expect(loopPoints('sustain', fl, 0, 1.8)).toBeNull();
  });

  it('measures the onset at 3% of the peak and never shifts backwards', () => {
    const x = new Float32Array(1000);
    x[100] = 0.01; // below 3% of the peak
    x[200] = 0.5;
    x[300] = -1;
    const buf: DecodedBuffer = { sampleRate: 1000, length: 1000, duration: 1, getChannelData: () => x };
    expect(onsetSec(buf)).toBeCloseTo(0.2, 9);
    expect(onsetShift(0.2, 0.004)).toBeCloseTo(0.196, 9);
    expect(onsetShift(0.001, 0.004)).toBe(0);
    expect(onsetSec({ ...buf, getChannelData: () => new Float32Array(10) })).toBe(0);
  });

  it('shapes the envelope: rise over the attack, hold, fall over the release, stop just after', () => {
    expect(envelopePoints(1, 0.5, 0.03, 0.2, 0.8)).toEqual([
      { at: 1, value: 0, ramp: false },
      { at: 1.03, value: 0.8, ramp: true },
      { at: 1.5, value: 0.8, ramp: false },
      { at: 1.7, value: 0, ramp: true },
    ]);
    // A note shorter than its attack still reaches the top before it falls.
    expect(envelopePoints(0, 0.01, 0.08, 0.25, 1)[2]?.at).toBeCloseTo(0.08, 9);
    expect(stopTimeFor(1, 0.5, 0.03, 0.2)).toBeCloseTo(1.72, 9);
    expect(midiOfHz(440)).toBe(69);
    expect(midiOfHz(261.6255653)).toBeCloseTo(60, 6);
  });
});

// ---- the loader and player against fakes --------------------------------------------------------------

class FakeParam {
  value = 1;
  readonly events: { kind: 'set' | 'ramp' | 'cancel'; v: number; t: number }[] = [];
  setValueAtTime(v: number, t: number): void {
    this.events.push({ kind: 'set', v, t });
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.events.push({ kind: 'ramp', v, t });
  }
  cancelScheduledValues(t: number): void {
    this.events.push({ kind: 'cancel', v: 0, t });
  }
}
class FakeNode implements SamplerNode {
  readonly outs: SamplerNode[] = [];
  connect(d: SamplerNode): unknown {
    this.outs.push(d);
    return d;
  }
  disconnect(): void {
    this.outs.length = 0;
  }
}
class FakeGainNode extends FakeNode implements SamplerGain {
  readonly gain = new FakeParam();
}
class FakeSrc extends FakeNode implements SamplerSource {
  buffer: DecodedBuffer | null = null;
  readonly playbackRate = { value: 1 };
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started: { when: number; offset: number | undefined } | null = null;
  stops: (number | undefined)[] = [];
  start(when: number, offset?: number): void {
    this.started = { when, offset };
  }
  stop(when?: number): void {
    this.stops.push(when);
  }
}
class FakeCtx implements SamplerContext, Decoder {
  currentTime = 0;
  readonly sources: FakeSrc[] = [];
  readonly gains: FakeGainNode[] = [];
  decodes = 0;
  failDecode = false;
  /** Leading silence the "decoder" keeps, seconds (an MP3 decoder that keeps the priming). */
  priming = 0;
  createBufferSource(): SamplerSource {
    const s = new FakeSrc();
    this.sources.push(s);
    return s;
  }
  createGain(): SamplerGain {
    const g = new FakeGainNode();
    this.gains.push(g);
    return g;
  }
  async decodeAudioData(data: ArrayBuffer): Promise<DecodedBuffer> {
    this.decodes++;
    if (this.failDecode) throw new Error('EncodingError');
    const sr = 1000;
    const x = new Float32Array(2000);
    const at = Math.round((0.004 + this.priming) * sr);
    for (let i = at; i < x.length; i++) x[i] = 0.5;
    expect(data.byteLength).toBeGreaterThan(0);
    return { sampleRate: sr, length: x.length, duration: x.length / sr, getChannelData: () => x };
  }
}

function fakeFetch(opts: { missingFiles?: boolean; failManifest?: number; manifest?: unknown } = {}): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  let manifestFails = opts.failManifest ?? 0;
  const res = (ok: boolean, body: unknown): FetchResponseLike => ({
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  const f = (async (url: string) => {
    urls.push(url);
    if (url.endsWith('index.json')) {
      if (manifestFails > 0) {
        manifestFails--;
        throw new TypeError('Failed to fetch');
      }
      return res(true, opts.manifest ?? raw);
    }
    if (opts.missingFiles) return res(false, null);
    return res(true, null);
  }) as FetchLike & { urls: string[] };
  f.urls = urls;
  return f;
}

describe('Sampler loading', () => {
  it('fetches index.json once and a set only on first use, then plays it', async () => {
    const ctx = new FakeCtx();
    const f = fakeFetch();
    const s = new Sampler({ base: 'sounds/', fetch: f, decoder: () => ctx });
    expect(f.urls).toEqual([]);
    expect(s.state('flute')).toBe('idle');
    const p = s.prepare('flute');
    expect(s.state('flute')).toBe('loading');
    expect(s.prepare('flute')).toBe(p);
    await expect(p).resolves.toBe('ready');
    expect(s.state('flute')).toBe('ready');
    await expect(s.prepare('cello')).resolves.toBe('ready');
    expect(f.urls.filter((u) => u.endsWith('index.json'))).toEqual(['sounds/index.json']);
    expect(f.urls.filter((u) => u.startsWith('sounds/flute/'))).toHaveLength(5);
    expect(f.urls).toContain('sounds/cello/E2.mp3');
    await s.prepare('flute');
    expect(ctx.decodes).toBe(11);
  });

  it('a set missing from the manifest falls back, without a throw, and is not fetched again', async () => {
    const ctx = new FakeCtx();
    const f = fakeFetch();
    const s = new Sampler({ base: 'sounds/', fetch: f, decoder: () => ctx });
    await expect(s.prepare('kazoo')).resolves.toBe('fallback');
    expect(s.state('kazoo')).toBe('missing');
    expect(s.ready('kazoo')).toBeNull();
    await expect(s.prepare('kazoo')).resolves.toBe('fallback');
    expect(f.urls).toEqual(['sounds/index.json']);
  });

  it('a failed fetch of the manifest or a file, or a failed decode, falls back without a throw and is tried again later', async () => {
    const ctx = new FakeCtx();
    const offline = fakeFetch({ failManifest: 1 });
    const s = new Sampler({ base: 'sounds/', fetch: offline, decoder: () => ctx });
    await expect(s.prepare('flute')).resolves.toBe('fallback');
    expect(s.state('flute')).toBe('failed');
    await expect(s.prepare('flute')).resolves.toBe('ready');

    const s2 = new Sampler({ base: 'sounds/', fetch: fakeFetch({ missingFiles: true }), decoder: () => ctx });
    await expect(s2.prepare('violin')).resolves.toBe('fallback');
    expect(s2.ready('violin')).toBeNull();

    const bad = new FakeCtx();
    bad.failDecode = true;
    const s3 = new Sampler({ base: 'sounds/', fetch: fakeFetch(), decoder: () => bad });
    await expect(s3.prepare('oboe')).resolves.toBe('fallback');
    bad.failDecode = false;
    await expect(s3.prepare('oboe')).resolves.toBe('ready');

    const s4 = new Sampler({ base: 'sounds/', fetch: fakeFetch(), decoder: () => null });
    await expect(s4.prepare('oboe')).resolves.toBe('fallback');

    const s5 = new Sampler({ base: 'sounds/', fetch: fakeFetch({ manifest: { sets: 7 } }), decoder: () => ctx });
    await expect(s5.prepare('oboe')).resolves.toBe('fallback');
  });

  it('plays a looped note with the rate, loop, onset shift and envelope of the design', async () => {
    const ctx = new FakeCtx();
    ctx.priming = 0.025; // a decoder that keeps 25 ms of priming
    const s = new Sampler({ base: 'sounds/', fetch: fakeFetch(), decoder: () => ctx });
    await s.prepare('flute');
    const loaded = s.ready('flute');
    if (!loaded) throw new Error('not ready');
    const out = new FakeNode();
    s.play(ctx, out, loaded, 72, 2, 1.5, { gain: 0.5 });
    const src = ctx.sources[0] as FakeSrc;
    const g = ctx.gains[0] as FakeGainNode;
    expect(cents(src.playbackRate.value)).toBeCloseTo(299.9, 6);
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBeCloseTo(0.925, 9);
    expect(src.loopEnd).toBeCloseTo(1.84995 + 0.025, 9);
    expect(src.started?.when).toBe(2);
    expect(src.started?.offset).toBeCloseTo(0.025, 9);
    expect(src.stops[0]).toBeCloseTo(2 + 1.5 + 0.2 + 0.02, 9);
    expect(g.gain.events.map((e) => [e.kind, e.v, +e.t.toFixed(6)])).toEqual([
      ['set', 0, 2],
      ['ramp', 0.5, 2.03],
      ['set', 0.5, 3.5],
      ['ramp', 0, 3.7],
    ]);
    expect(src.outs).toEqual([g]);
    expect(g.outs).toEqual([out]);
  });

  it('a one-shot does not loop; attackSec overrides the set attack; stop() fades out and frees the nodes when the source ends', async () => {
    const ctx = new FakeCtx();
    const s = new Sampler({ base: 'sounds/', fetch: fakeFetch(), decoder: () => ctx });
    await s.prepare('piano');
    const v = s.play(ctx, new FakeNode(), s.ready('piano')!, 60, 1, 0.5, { gain: 1, attackSec: 0.08 });
    const src = ctx.sources[0] as FakeSrc;
    const g = ctx.gains[0] as FakeGainNode;
    expect(src.loop).toBe(false);
    expect(g.gain.events[1]).toEqual({ kind: 'ramp', v: 1, t: 1.08 });
    ctx.currentTime = 1.2;
    let ended = 0;
    v.onended = () => ended++;
    v.stop();
    expect(g.gain.events.slice(-3).map((e) => e.kind)).toEqual(['cancel', 'set', 'ramp']);
    expect(src.stops.at(-1)).toBeCloseTo(1.215, 9);
    expect(g.outs).toHaveLength(1);
    src.onended?.();
    expect(ended).toBe(1);
    expect(g.outs).toHaveLength(0);
    v.stop(); // after the end: nothing
    expect(src.stops).toHaveLength(2);
  });

  it('knows a real context from a fake one', () => {
    expect(isSamplerContext(new FakeCtx())).toBe(true);
    expect(isSamplerContext({ createGain() {}, createBufferSource() {} })).toBe(false);
    expect(isSamplerContext(null)).toBe(false);
  });
});
