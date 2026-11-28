import { describe, expect, it } from 'vitest';
import { FakeNativeIpc } from './testing/fake-native-ipc.ts';
import { gainPoints, MAX_CUT_SEC, MAX_ENV_POINTS, NativeVoiceContext, NativeVoiceError, NativeVoiceHost } from './voice-context.ts';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function setup(): Promise<{ ipc: FakeNativeIpc; host: NativeVoiceHost; ctx: NativeVoiceContext; sounds: NativeVoiceContext }> {
  const ipc = new FakeNativeIpc();
  await ipc.open({ input: false, outputMode: 'speakers', onEvent: (e) => host.handle(e) });
  const host = new NativeVoiceHost(ipc, () => ipc.engineNow) as NativeVoiceHost & { handle(e: { type: string; ids?: number[] }): void };
  host.handle = (e) => {
    if (e.type === 'ended') host.voicesEnded(e.ids ?? []);
    else if (e.type === 'late') host.voicesLate(e.ids ?? []);
    else if (e.type === 'rejected') host.voicesRejected(e.ids ?? []);
  };
  host.newGeneration(48000);
  return { ipc, host, ctx: new NativeVoiceContext(host, 'take'), sounds: new NativeVoiceContext(host, 'sounds') };
}

/** A plain one-shot source on a fresh 0.1 s buffer. */
function source(ctx: NativeVoiceContext, at: number, seconds = 0.1) {
  const src = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.round(seconds * 48000), 48000);
  buf.getChannelData(0).fill(0.25);
  src.buffer = buf;
  src.start(at);
  return { src, buf };
}

describe('gainPoints (Web Audio automation as engine envelope points)', () => {
  it('is the sampler envelope: set 0, ramp up, set (hold), ramp down, in four points', () => {
    const pts = gainPoints(
      [
        { kind: 'set', v: 0, t: 1 },
        { kind: 'ramp', v: 2, t: 1.03 },
        { kind: 'set', v: 2, t: 1.5 },
        { kind: 'ramp', v: 0, t: 1.7 },
      ],
      1,
      1,
    );
    expect(pts).toEqual([[1, 0], [1.03, 2], [1.5, 2], [1.7, 0]]);
  });

  it('a step to a different value is two points at the same time', () => {
    expect(gainPoints([{ kind: 'set', v: 1, t: 0 }, { kind: 'set', v: 0.5, t: 2 }], 1, 0)).toEqual([[0, 1], [2, 1], [2, 0.5]]);
    expect(gainPoints([{ kind: 'set', v: 1, t: 2 }, { kind: 'set', v: 0.5, t: 2 }], 1, 0)).toEqual([[2, 1], [2, 0.5]]);
    expect(gainPoints([{ kind: 'set', v: 1, t: 2 }, { kind: 'set', v: 1, t: 2 }], 1, 0)).toEqual([[2, 1]]);
  });

  it('a ramp with no earlier event starts at the voice start from the initial value', () => {
    expect(gainPoints([{ kind: 'ramp', v: 0, t: 3 }], 0.8, 1)).toEqual([[1, 0.8], [3, 0]]);
  });

  it('orders events by time, then by the order they were made', () => {
    expect(gainPoints([{ kind: 'ramp', v: 0, t: 3 }, { kind: 'set', v: 1, t: 1 }], 1, 0)).toEqual([[1, 1], [3, 0]]);
  });

  it('no events is no points', () => {
    expect(gainPoints([], 1, 0)).toEqual([]);
  });
});

describe('buffers', () => {
  it('are registered with the engine on first use, once, and again after the engine session changes', async () => {
    const { ipc, host, ctx } = await setup();
    const { buf } = source(ctx, 1);
    await ctx.flush();
    expect(ipc.calls.filter((c) => c === 'putBuffer')).toHaveLength(1);
    expect(Array.from(ipc.bufferData(buf.id).subarray(0, 3))).toEqual([0.25, 0.25, 0.25]);
    const again = ctx.createBufferSource();
    again.buffer = buf;
    again.start(2);
    await ctx.flush();
    expect(ipc.calls.filter((c) => c === 'putBuffer')).toHaveLength(1);
    await ipc.open({ input: false, outputMode: 'speakers', onEvent: () => undefined });
    host.newGeneration(48000);
    const third = ctx.createBufferSource();
    third.buffer = buf;
    third.start(3);
    await ctx.flush();
    expect(ipc.calls.filter((c) => c === 'putBuffer')).toHaveLength(2);
    expect(ipc.buffers.has(buf.id)).toBe(true);
  });

  it('bufferFor registers one buffer per array', async () => {
    const { ctx } = await setup();
    const data = new Float32Array(100);
    expect(ctx.bufferFor(data)).toBe(ctx.bufferFor(data));
    expect(ctx.bufferFor(new Float32Array(100))).not.toBe(ctx.bufferFor(data));
  });

  it('an ephemeral buffer is dropped from the engine when its last voice ends, and a shared one only then', async () => {
    const { ipc, ctx } = await setup();
    const buf = ctx.bufferFor(new Float32Array(4800).fill(0.5), 48000, true);
    for (const at of [0.1, 0.5]) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.start(at);
    }
    await ctx.flush();
    ipc.advance(0.3);
    await tick();
    expect(ipc.droppedBufferIds).toEqual([]);
    ipc.advance(0.5);
    await tick();
    expect(ipc.droppedBufferIds).toEqual([buf.id]);
  });

  it('decodeAudioData keeps the PCM the engine returned and the buffer needs no upload', async () => {
    const { ipc, ctx } = await setup();
    const b = await ctx.decodeAudioData(new Uint8Array([1, 2, 3]).buffer);
    expect(b.sampleRate).toBe(44100);
    expect(b.length).toBe(17640);
    expect(b.duration).toBeCloseTo(0.4, 9);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.start(1);
    await ctx.flush();
    expect(ipc.calls).not.toContain('putBuffer');
    expect(ipc.voices).toHaveLength(1);
  });
});

describe('a source becomes a VoiceSpec', () => {
  it('carries start time, offset, rate and loop points', async () => {
    const { ipc, ctx } = await setup();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 48000, 48000);
    src.playbackRate.value = 1.5;
    src.loop = true;
    src.loopStart = 0.2;
    src.loopEnd = 0.8;
    src.start(2, 0.1);
    src.stop(3);
    await ctx.flush();
    expect(ipc.voices[0]?.spec).toEqual({ id: expect.any(Number), buffer: expect.any(Number), t: 2, gain: 1, rate: 1.5, offsetSec: 0.1, loop: [0.2, 0.8], stopAt: 3 });
    expect(ipc.voices[0]?.group).toBe('take');
  });

  it('omits what is default: rate 1, offset 0, no loop, no envelope', async () => {
    const { ipc, ctx } = await setup();
    source(ctx, 1);
    await ctx.flush();
    expect(Object.keys(ipc.voices[0]?.spec ?? {}).sort()).toEqual(['buffer', 'gain', 'id', 't']);
  });

  it('voice ids are unique and every voice queued in one task goes out in one schedule call', async () => {
    const { ipc, ctx } = await setup();
    for (let i = 0; i < 30; i++) source(ctx, 1 + i * 0.2);
    await ctx.flush();
    expect(ipc.calls.filter((c) => c === 'schedule:take')).toHaveLength(1);
    expect(new Set(ipc.voices.map((v) => v.spec.id)).size).toBe(30);
  });

  it('calls in another task are another call, in order', async () => {
    const { ipc, ctx } = await setup();
    source(ctx, 1);
    await tick();
    source(ctx, 2);
    await ctx.flush();
    expect(ipc.calls.filter((c) => c === 'schedule:take')).toHaveLength(2);
    expect(ipc.voices.map((v) => v.spec.t)).toEqual([1, 2]);
  });

  it('multiplies the gain of nodes without automation and takes automation as the envelope', async () => {
    const { ipc, ctx } = await setup();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 4800, 48000);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 5);
    g.gain.linearRampToValueAtTime(1, 5.01);
    const bus = ctx.createGain();
    bus.gain.value = 0.25;
    const bus2 = ctx.createGain();
    bus2.gain.value = 0.5;
    src.connect(g);
    g.connect(bus);
    bus.connect(bus2);
    src.start(5);
    await ctx.flush();
    expect(ipc.voices[0]?.spec.gain).toBeCloseTo(0.125, 9);
    expect(ipc.voices[0]?.spec.env).toEqual([[5, 0], [5.01, 1]]);
  });

  it('refuses two gain nodes with automation in one chain', async () => {
    const { ipc, ctx } = await setup();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 4800, 48000);
    const a = ctx.createGain();
    const b = ctx.createGain();
    a.gain.setValueAtTime(0, 1);
    b.gain.setValueAtTime(0, 1);
    src.connect(a);
    a.connect(b);
    src.start(1);
    await expect(ctx.flush()).rejects.toBeInstanceOf(NativeVoiceError);
    expect(ipc.voices).toHaveLength(0);
  });

  it(`refuses an envelope of more than ${MAX_ENV_POINTS} points instead of truncating it, and sends nothing`, async () => {
    const { ipc, ctx } = await setup();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 48000, 48000);
    const g = ctx.createGain();
    for (let i = 0; i <= MAX_ENV_POINTS; i++) g.gain.linearRampToValueAtTime(i % 2, 1 + i * 0.1);
    src.connect(g);
    src.start(1);
    await expect(ctx.flush()).rejects.toThrow(/10 points/);
    expect(ipc.calls).not.toContain('schedule:take');
    // The context still works afterwards.
    source(ctx, 3);
    await ctx.flush();
    expect(ipc.voices).toHaveLength(1);
  });

  it('exactly 8 points go through', async () => {
    const { ipc, ctx } = await setup();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 48000, 48000);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 1);
    for (let i = 1; i < MAX_ENV_POINTS; i++) g.gain.linearRampToValueAtTime(i % 2, 1 + i * 0.1);
    src.connect(g);
    src.start(1);
    await ctx.flush();
    expect(ipc.voices[0]?.spec.env).toHaveLength(MAX_ENV_POINTS);
  });

  it('refuses a source with no buffer, a start twice, and a stop before start', async () => {
    const { ctx } = await setup();
    expect(() => ctx.createBufferSource().start(1)).toThrow(NativeVoiceError);
    const { src } = source(ctx, 1);
    expect(() => src.start(2)).toThrow(/twice/);
    expect(() => ctx.createBufferSource().stop()).toThrow(/before start/);
  });

  it('createBuffer is mono', async () => {
    const { ctx } = await setup();
    expect(() => ctx.createBuffer(2, 10, 48000)).toThrow(NativeVoiceError);
  });
});

describe('the param value reads the automation at the current time', () => {
  it('follows set and ramp events, and a cancel removes the later ones', async () => {
    const { ipc, ctx } = await setup();
    const g = ctx.createGain();
    expect(g.gain.value).toBe(1);
    g.gain.setValueAtTime(0, 1);
    g.gain.linearRampToValueAtTime(2, 3);
    ipc.advance(2);
    expect(g.gain.value).toBeCloseTo(1, 3);
    g.gain.cancelScheduledValues(2);
    expect(g.gain.value).toBe(0);
  });
});

describe('stopping', () => {
  it('a queued voice stopped at or before its start never reaches the engine; its onended still fires (async)', async () => {
    const { ipc, ctx } = await setup();
    const { src } = source(ctx, 1);
    let ended = 0;
    src.onended = () => ended++;
    src.stop(0.5);
    await ctx.flush();
    await tick();
    expect(ipc.voices).toHaveLength(0);
    expect(ended).toBe(1);
  });

  it('a queued voice stopped later keeps the last stop time', async () => {
    const { ipc, ctx } = await setup();
    const { src } = source(ctx, 1);
    src.stop(2);
    src.stop(1.5);
    await ctx.flush();
    expect(ipc.voices[0]?.spec.stopAt).toBe(1.5);
  });

  it('a voice the engine has, stopped within the cut limit, is audio_stop_voices with that fade', async () => {
    const { ipc, ctx } = await setup();
    const { src } = source(ctx, 5, 1);
    await ctx.flush();
    src.stop(ctx.currentTime + 0.015);
    await tick();
    expect(ipc.stopRequests).toHaveLength(1);
    expect(ipc.stopRequests[0]?.ids).toEqual([ipc.voices[0]?.spec.id]);
    expect(ipc.stopRequests[0]?.fadeSec).toBeCloseTo(0.015, 3);
    expect(ipc.voices[0]?.endReason).toBe('stopped');
  });

  it('stops in one task are batched by fade', async () => {
    const { ipc, ctx } = await setup();
    const a = source(ctx, 5, 1);
    const b = source(ctx, 5, 1);
    const c = source(ctx, 5, 1);
    await ctx.flush();
    a.src.stop();
    b.src.stop();
    c.src.stop(ctx.currentTime + 0.02);
    await tick();
    expect(ipc.stopRequests).toHaveLength(2);
    expect(ipc.stopRequests.map((r) => r.ids.length).sort()).toEqual([1, 2]);
  });

  it(`a stop further ahead than ${MAX_CUT_SEC} s after scheduling cannot be expressed and is refused`, async () => {
    const { ctx } = await setup();
    const { src } = source(ctx, 5, 1);
    await ctx.flush();
    expect(() => src.stop(ctx.currentTime + 2)).toThrow(NativeVoiceError);
  });

  it('the engine reporting the end calls onended once, and a stop after that is a no-op', async () => {
    const { ipc, ctx } = await setup();
    const { src } = source(ctx, 0.1, 0.1);
    let ended = 0;
    src.onended = () => ended++;
    await ctx.flush();
    ipc.advance(0.5);
    expect(ended).toBe(1);
    src.stop();
    await tick();
    expect(ipc.stopRequests).toEqual([]);
    expect(ended).toBe(1);
  });

  it('cancelGroup drops queued voices, ends sent ones silently and asks the engine to cancel the group only', async () => {
    const { ipc, ctx, sounds } = await setup();
    const sent = source(ctx, 5, 1);
    const other = source(sounds, 5, 1);
    await Promise.all([ctx.flush(), sounds.flush()]);
    const queued = source(ctx, 6);
    let ended = 0;
    sent.src.onended = () => ended++;
    queued.src.onended = () => ended++;
    await ctx.cancelGroup(0.01);
    await tick();
    expect(ended).toBe(0);
    expect(ipc.calls).toContain('cancel:take');
    expect(ipc.calls).not.toContain('cancel:sounds');
    expect(ipc.voices.filter((v) => v.group === 'take')).toHaveLength(1);
    expect(ipc.voices.find((v) => v.group === 'take')?.endReason).toBe('cancelled');
    expect(ipc.liveVoices.map((v) => v.group)).toEqual(['sounds']);
    // A stop on a cancelled source does nothing (the shared Metronome.cancel calls it).
    sent.src.stop();
    other.src.stop();
    await tick();
    expect(ipc.stopRequests).toHaveLength(1);
  });
});

describe('the engine limits', () => {
  it('64 voices sounding at once go through; 65 are refused whole', async () => {
    const { ipc, ctx } = await setup();
    for (let i = 0; i < 64; i++) source(ctx, 1);
    await ctx.flush();
    expect(ipc.voices).toHaveLength(64);
    source(ctx, 1.05);
    await expect(ctx.flush()).rejects.toThrow(/65 voices/);
    expect(ipc.voices).toHaveLength(64);
  });

  it('voices that do not overlap in time are not counted together, however many', async () => {
    const { ipc, ctx } = await setup();
    for (let i = 0; i < 300; i++) source(ctx, 1 + i * 0.2, 0.1);
    await ctx.flush();
    expect(ipc.voices).toHaveLength(300);
  });

  it('a looped voice without a stop sounds for ever and counts so', async () => {
    const { ctx } = await setup();
    for (let i = 0; i < 64; i++) {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 4800, 48000);
      s.loop = true;
      s.loopStart = 0;
      s.loopEnd = 0.1;
      s.start(1);
    }
    await ctx.flush();
    source(ctx, 500);
    await expect(ctx.flush()).rejects.toThrow(/65 voices/);
  });

  it('voices late at the call are returned by the engine and counted', async () => {
    const { ipc, host, ctx } = await setup();
    ipc.advance(2);
    source(ctx, 1);
    source(ctx, 3);
    await ctx.flush();
    expect(host.stats.late).toBe(1);
  });
});
