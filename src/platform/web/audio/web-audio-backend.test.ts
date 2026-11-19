import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureBlock, MessagePortLike, PlatformCapabilities, TakeSchedule, WorkerMessage } from '../../../core/platform.ts';
import { FakeAudioBackend } from '../../../testkit/fake-backend.ts';
import { renderMin } from '../../../testkit/synth-min.ts';
import { WebAudioBackend, type CaptureFault, type InterruptionReason, type WebAudioBackendOptions } from './web-audio-backend.ts';
import type { FakeGain, FakeSourceNode, FakeWorkletNode} from './testing/fake-web-audio.ts';
import { FakeAudioWorld, flush, type WorldOptions } from './testing/fake-web-audio.ts';
import { routeKeyOf } from './route.ts';

const caps: PlatformCapabilities = {
  platform: 'web', outputLatencyReported: true, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser',
};

const open: (() => void)[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c();
});

function setup(w: WorldOptions = {}, o: Partial<WebAudioBackendOptions> = {}): { world: FakeAudioWorld; be: WebAudioBackend } {
  const world = new FakeAudioWorld(w);
  const be = new WebAudioBackend({ capabilities: caps, workletUrl: 'capture.worklet.js', deps: world.deps, ...o });
  open.push(() => {
    for (const c of world.contexts) for (const n of c.workletNodes) n.closePorts();
  });
  return { world, be };
}

/** A DSP-worker stand-in on a MessageChannel: records blocks and (optionally) returns buffers. */
function workerPort(opts: { returns?: boolean | ((seq: number) => boolean) } = {}): { sink: MessagePortLike; blocks: CaptureBlock[]; close(): void } {
  const ch = new MessageChannel();
  const blocks: CaptureBlock[] = [];
  const ret = opts.returns ?? true;
  ch.port2.onmessage = (ev: MessageEvent) => {
    const m = ev.data as WorkerMessage;
    if (m.type !== 'block') return;
    blocks.push({ ...m.block, lowband: m.block.lowband.slice(), hiEnergy: m.block.hiEnergy.slice() });
    const give = typeof ret === 'function' ? ret(m.block.seq) : ret;
    if (give) {
      const lb = m.block.lowband.buffer as ArrayBuffer;
      const hb = m.block.hiEnergy.buffer as ArrayBuffer;
      ch.port2.postMessage({ v: 1, type: 'return', lowband: lb, hiEnergy: hb }, [lb, hb]);
    }
  };
  const close = (): void => {
    ch.port1.close();
    ch.port2.close();
  };
  open.push(close);
  return { sink: ch.port1 as unknown as MessagePortLike, blocks, close };
}

const tone = (hz: number, rate: number) => (frame: number, n: number): Float32Array[] => {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * hz * (frame + i)) / rate);
  return [x];
};

const expectContiguous = (blocks: readonly CaptureBlock[]): void => {
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1] as CaptureBlock;
    const b = blocks[i] as CaptureBlock;
    expect(b.seq).toBe(a.seq + 1);
    expect(Math.abs(b.startT - (a.startT + a.lowband.length / a.analysisRate))).toBeLessThan(1e-9);
  }
};

/** Start capture and render until the worklet reports it started. */
async function startRunning(world: FakeAudioWorld, be: WebAudioBackend, sink: Parameters<WebAudioBackend['startCapture']>[0]): Promise<void> {
  let started = false;
  void be.startCapture(sink).then(() => (started = true));
  for (let i = 0; i < 50 && !started; i++) await world.advance(6);
  if (!started) throw new Error('capture did not start');
}

const takeParams = (over: Partial<TakeSchedule> = {}): TakeSchedule => ({
  leadSec: 0.5, bpm: 120, beatsPerBar: 4, countInBeats: 4, totalBeats: 16, mode: 'audible', timbre: 'tick', accentDb: 5, ...over,
});

describe('unlock (W1, W2, W3)', () => {
  it('sets the audio session, creates the context and resumes it synchronously, before getUserMedia', async () => {
    const { world, be } = setup({ audioSession: true });
    const p = be.unlock();
    // Still inside the gesture's task: the synchronous part has run, nothing awaited.
    const syncCalls = [...world.calls];
    expect(syncCalls.slice(0, 3)).toEqual(['audioSession.type=play-and-record', 'createContext', 'resume']);
    expect(syncCalls.indexOf('resume')).toBeLessThan(syncCalls.includes('getUserMedia') ? syncCalls.indexOf('getUserMedia') : Infinity);
    const route = await p;
    expect(world.calls).toEqual(['audioSession.type=play-and-record', 'createContext', 'resume', 'getUserMedia', 'addModule', 'createWorkletNode:sr-capture']);
    expect(be.audioInfo()).toEqual({ contextSampleRate: 48000, contextRecreated: false, audioSessionType: 'play-and-record', clockRateError: null });
    expect(route.appliedProcessing).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(route.inputKind).toBe('built-in');
    expect(route.reportedLatencySec).toBeCloseTo(0.025, 9);
    expect(route.routeKey).toBe(routeKeyOf('Built-in Microphone', 'speakers', 48000, 'linux'));
  });

  it('requests all processing off and mono', async () => {
    const { world, be } = setup();
    let constraints: unknown;
    const gum = world.mediaDevices.getUserMedia.bind(world.mediaDevices);
    world.mediaDevices.getUserMedia = (c) => {
      constraints = c;
      return gum(c);
    };
    await be.unlock();
    expect(constraints).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  });

  it('builds stream -> worklet -> gain(0) -> destination, and a click bus to the destination (01 §7.2)', async () => {
    const { world, be } = setup();
    await be.unlock();
    const ctx = world.ctx;
    const node = ctx.workletNodes[0] as FakeWorkletNode;
    const src = ctx.sources[0] as FakeSourceNode;
    expect(src.outs).toEqual([node]);
    const zero = node.outs[0] as FakeGain;
    expect(zero.gain.value).toBe(0);
    expect(zero.outs).toEqual([ctx.destination]);
    expect(node.options).toMatchObject({ numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const bus = be.clickOutput() as unknown as FakeGain;
    expect(bus.outs).toEqual([ctx.destination]);
  });

  it('keeps one stream and one context over ten takes (W2)', async () => {
    const { world, be } = setup();
    for (let i = 0; i < 10; i++) {
      await be.unlock();
      const port = workerPort();
      await startRunning(world, be, port.sink);
      await world.advance(20);
      be.stopCapture();
    }
    expect(world.gumCount).toBe(1);
    expect(world.contexts).toHaveLength(1);
    await be.close();
    expect(world.tracks.every((t) => t.readyState === 'ended')).toBe(true);
    expect(world.ctx.state).toBe('closed');
  });

  it('a track that ended is replaced on the next unlock, on the same context and module', async () => {
    const { world, be } = setup();
    await be.unlock();
    world.tracks[0]?.end();
    await be.unlock();
    expect(world.gumCount).toBe(2);
    expect(world.contexts).toHaveLength(1);
    expect(world.ctx.modules).toHaveLength(1);
    expect(world.ctx.workletNodes).toHaveLength(2);
    const port = workerPort();
    await startRunning(world, be, port.sink);
    await world.advance(50);
    expect(port.blocks.length).toBeGreaterThan(5);
  });

  it('concurrent unlocks share one getUserMedia', async () => {
    const { world, be } = setup();
    const [a, b] = await Promise.all([be.unlock(), be.unlock()]);
    expect(a).toEqual(b);
    expect(world.gumCount).toBe(1);
  });

  it('recreates a 44.1 kHz context once when the track reports 48 kHz (W3)', async () => {
    const { world, be } = setup({ contextRate: 44100, trackSettings: { sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const route = await be.unlock();
    expect(world.calls.filter((c) => c.startsWith('createContext'))).toEqual(['createContext', 'createContext@48000']);
    expect(world.contexts[0]?.state).toBe('closed');
    expect(route.sampleRate).toBe(48000);
    expect(be.audioInfo().contextRecreated).toBe(true);
    expect(be.sampleRateCheck()).toEqual({ trackSampleRate: 48000, contextSampleRate: 48000, matches: true });
    await be.unlock();
    expect(world.contexts).toHaveLength(2);
    expect(world.gumCount).toBe(1);
  });

  it('does not recreate when the track reports no rate', async () => {
    const { world, be } = setup({ contextRate: 44100, trackSettings: {} });
    await be.unlock();
    expect(world.contexts).toHaveLength(1);
    expect(be.sampleRateCheck().matches).toBe(true);
    expect((await be.unlock()).appliedProcessing).toEqual({ echoCancellation: null, noiseSuppression: null, autoGainControl: null });
  });

  it('reports permission state', async () => {
    const { be } = setup({ permission: 'denied' });
    expect(await be.permissionState()).toBe('denied');
    await be.unlock();
    expect(await be.permissionState()).toBe('granted');
  });
});

describe('clock checks (01 §7.8, W3)', () => {
  async function check(errors: number[]): Promise<{ world: FakeAudioWorld; be: WebAudioBackend; result: Awaited<ReturnType<WebAudioBackend['checkClockRate']>> }> {
    const { world, be } = setup({ clockRateErrors: errors });
    await be.unlock();
    const p = be.checkClockRate(1.5);
    let result: Awaited<typeof p> | undefined;
    void p.then((r) => (result = r));
    for (let i = 0; i < 20 && !result; i++) await world.advance(500, { flushEvery: 4 });
    if (!result) throw new Error('checkClockRate did not finish');
    return { world, be, result };
  }

  it('passes an exact clock', async () => {
    const { be, result } = await check([0]);
    expect(result.ok).toBe(true);
    expect(result.recreated).toBe(false);
    // The fake renders in 5.3 ms steps, so the 1.5 s measurement is quantised to about 0.7%.
    expect(Math.abs(result.error)).toBeLessThan(0.012);
    expect(Math.abs(be.audioInfo().clockRateError as number)).toBeLessThan(0.012);
  });

  it('catches a clock running 8.8% fast and recreates the context once; a second failure is fatal', async () => {
    const { world, result } = await check([0.088, 0.088]);
    expect(result.ok).toBe(false);
    expect(result.recreated).toBe(true);
    expect(result.error).toBeGreaterThan(0.08);
    expect(world.contexts).toHaveLength(2);
  });

  it('recovers when the recreated context runs at the right rate', async () => {
    const { world, be, result } = await check([0.088, 0]);
    expect(result).toMatchObject({ ok: true, recreated: true });
    expect(world.contexts).toHaveLength(2);
    expect(be.audioInfo().contextRecreated).toBe(true);
    // The recreated context is fully wired: capture still works.
    const port = workerPort();
    await startRunning(world, be, port.sink);
    await world.advance(50);
    expect(port.blocks.length).toBeGreaterThan(5);
  });

  it('measureClockRate reports frames per wall second against the context rate', async () => {
    const { world, be } = setup({ clockRateErrors: [-0.03] });
    await be.unlock();
    const p = be.measureClockRate(1.5);
    let r: Awaited<typeof p> | undefined;
    void p.then((x) => (r = x));
    for (let i = 0; i < 10 && !r; i++) await world.advance(500, { flushEvery: 4 });
    expect(r?.expected).toBe(48000);
    expect(Math.abs((r?.framesPerSec as number) / 48000 - 1 + 0.03)).toBeLessThan(0.012);
  });

  it('a suspended context counts no frames', async () => {
    const { world, be } = setup();
    await be.unlock();
    world.ctx.setState('suspended');
    const p = be.measureClockRate(0.5);
    let r: Awaited<typeof p> | undefined;
    void p.then((x) => (r = x));
    await world.advance(700);
    expect(r?.framesPerSec).toBe(0);
  });

  it('fails measureClockRate when the worklet does not answer', async () => {
    const { world, be } = setup();
    await be.unlock();
    (world.ctx.workletNodes[0] as unknown as { inner: MessagePort }).inner.onmessage = null;
    const p = be.measureClockRate(0.1);
    let err: unknown;
    p.catch((e: unknown) => (err = e));
    await world.advance(2500);
    expect(String(err)).toMatch(/not running/);
  });
});

describe('capture (01 §7.2)', () => {
  it('delivers the same blocks as FakeAudioBackend over a transferred port, returning buffers to the pool', async () => {
    const rate = 48000;
    const { world, be } = setup({ input: tone(440, rate) });
    await be.unlock();
    world.ctx.frame = 10 * rate; // Context clock at 10 s, like the fake backend's default.
    const port = workerPort();
    await startRunning(world, be, port.sink);
    const origin = Math.round((be.captureOrigin() as number) * rate);
    expect((be.captureOrigin() as number) * rate).toBeCloseTo(origin, 6);
    expect(origin).toBeGreaterThan(10 * rate);
    await world.advance(2000, { flushEvery: 2 });
    be.stopCapture();
    await flush();
    expect(be.captureRelay).toBe(false);
    expect(be.captureStats()).toMatchObject({ droppedBlocks: 0, relay: false });
    expect(port.blocks.length).toBeGreaterThan(370);
    expectContiguous(port.blocks);
    // Same arithmetic as the fake backend fed the same samples from the same origin.
    const src = new Float32Array(port.blocks.length * 256);
    tone(440, rate)(origin, src.length).forEach((c) => src.set(c));
    const fake = new FakeAudioBackend({ source: src, sampleRate: rate, startClockSec: origin / rate });
    const fb: CaptureBlock[] = [];
    await fake.startCapture((m) => void (m.type === 'block' && fb.push(m.block)));
    await fake.run({ tailSec: 0 });
    expect(fb.length).toBe(port.blocks.length);
    port.blocks.forEach((b, i) => {
      const f = fb[i] as CaptureBlock;
      expect(b.seq).toBe(f.seq);
      expect(b.startT).toBeCloseTo(f.startT, 10);
      expect(b.lowband).toEqual(f.lowband);
      expect(b.hiEnergy).toEqual(f.hiEnergy);
    });
    // The worklet pool was in use: no allocation beyond warm-up, no backlog.
    expect(be.captureStats().maxQueueMs).toBeLessThan(20);
  });

  it('falls back to the main-thread relay when no buffer comes back within 500 ms, without a gap', async () => {
    const { world, be } = setup();
    await be.unlock();
    const port = workerPort({ returns: false });
    await startRunning(world, be, port.sink);
    await world.advance(450, { flushEvery: 4 });
    expect(be.captureRelay).toBe(false);
    await world.advance(600, { flushEvery: 4 });
    expect(be.captureRelay).toBe(true);
    be.stopCapture();
    await flush();
    expect(be.captureStats()).toMatchObject({ relay: true, droppedBlocks: 0 });
    expect(port.blocks.length).toBeGreaterThan(180);
    expectContiguous(port.blocks);
    expect(port.blocks[0]?.seq).toBe(0);
  });

  it('forced relay with a port sink delivers contiguous blocks (01 §7.2 fallback)', async () => {
    const { world, be } = setup({}, { forceRelay: true });
    await be.unlock();
    const port = workerPort({ returns: false });
    await startRunning(world, be, port.sink);
    await world.advance(1000, { flushEvery: 2 });
    be.stopCapture();
    await flush();
    expect(be.captureRelay).toBe(true);
    expect(port.blocks.length).toBeGreaterThan(180);
    expectContiguous(port.blocks);
    expect(be.captureStats().droppedBlocks).toBe(0);
  });

  it('a callback sink is relayed; it receives copies it may keep', async () => {
    const { world, be } = setup({ input: tone(1000, 48000) });
    await be.unlock();
    const blocks: CaptureBlock[] = [];
    await startRunning(world, be, (m) => void (m.type === 'block' && blocks.push(m.block)));
    await world.advance(1000, { flushEvery: 2 });
    be.stopCapture();
    expect(be.captureRelay).toBe(true);
    expect(blocks.length).toBeGreaterThan(180);
    expectContiguous(blocks);
    // Copies stay intact after the worklet reused the pooled buffers 6 times over.
    expect(blocks.every((b) => b.lowband.length >= 85 && b.lowband.length <= 86)).toBe(true);
    expect(Math.max(...Array.from(blocks[10]?.lowband ?? []).map(Math.abs))).toBeGreaterThan(0.1);
  });

  it('reports backlog above 120 ms of queued audio, then pool-empty drops as a capture gap (R32)', async () => {
    const { world, be } = setup();
    await be.unlock();
    const faults: CaptureFault[] = [];
    be.onCaptureFault((f) => faults.push(f));
    // A worker that returns only the first buffer (proving the port), then stalls.
    const port = workerPort({ returns: (seq) => seq === 0 });
    await startRunning(world, be, port.sink);
    await world.advance(400, { flushEvery: 1 });
    be.stopCapture();
    const backlog = faults.find((f) => f.kind === 'backlog');
    const gap = faults.find((f) => f.kind === 'capture-gap');
    expect(backlog).toBeDefined();
    expect((backlog as { queueMs: number }).queueMs).toBeGreaterThan(120);
    expect((backlog as { queueMs: number }).queueMs).toBeLessThan(170);
    expect(gap).toBeDefined();
    expect(faults.indexOf(backlog as CaptureFault)).toBeLessThan(faults.indexOf(gap as CaptureFault));
    const stats = be.captureStats();
    expect(stats.droppedBlocks).toBeGreaterThan(0);
    expect(stats.maxQueueMs).toBeGreaterThan(120);
    expect(be.captureRelay).toBe(false);
  });

  it('testClock: t0 is the first captured frame plus the offset (01 §13.4)', async () => {
    const { world, be } = setup({}, { testClockT0AfterCaptureSec: 2 });
    await be.unlock();
    world.ctx.frame = 4800;
    const port = workerPort();
    await startRunning(world, be, port.sink);
    const origin = be.captureOrigin() as number;
    const { t0, clicks } = await be.scheduleTake(takeParams());
    expect(t0).toBeCloseTo(origin + 2, 12);
    expect(clicks[4]?.t).toBeCloseTo(origin + 2, 12);
  });
});

describe('input switching (R13 practise without listening; 01 §13.4 test clock)', () => {
  it('setInputEnabled(false): unlock builds the output path without asking for the microphone', async () => {
    const { world, be } = setup();
    be.setInputEnabled(false);
    const route = await be.unlock();
    expect(world.gumCount).toBe(0);
    expect(route.inputKind).toBe('unknown');
    const { clicks } = await be.scheduleTake(takeParams());
    expect(clicks.length).toBeGreaterThan(0);
    // Back on: the next unlock opens the microphone and keeps the context.
    be.setInputEnabled(true);
    await be.unlock();
    expect(world.gumCount).toBe(1);
    expect(world.contexts.length).toBe(1);
  });

  it('reopenInput stops the old track and opens a fresh stream on the same context', async () => {
    const { world, be } = setup();
    await be.unlock();
    expect(world.gumCount).toBe(1);
    const first = world.tracks[0]!;
    await be.reopenInput();
    expect(world.gumCount).toBe(2);
    expect(first.readyState).toBe('ended');
    expect(world.tracks[1]!.readyState).toBe('live');
    expect(world.contexts.length).toBe(1);
    const port = workerPort();
    await startRunning(world, be, port.sink);
    expect(be.captureOrigin()).not.toBeNull();
  });
});

describe('metronome on the backend (W9)', () => {
  it('schedules every click at Start on the context clock; a 200 ms stall moves nothing', async () => {
    const { world, be } = setup();
    await be.unlock();
    await world.advance(100);
    const now = be.now();
    const { t0, clicks } = await be.scheduleTake(takeParams({ leadSec: 0.6 }));
    expect(t0).toBeCloseTo(now + 0.6 + 2, 12);
    const timers = world.pendingTimers();
    // Main-thread stall: wall time passes, the audio clock runs on, the main thread does nothing.
    world.wallMs += 200;
    world.ctx.frame += 9600;
    await world.advance(3000, { flushEvery: 8 });
    expect(world.pendingTimers()).toBeLessThanOrEqual(timers);
    const srcs = world.ctx.bufferSources;
    expect(srcs).toHaveLength(clicks.length);
    srcs.forEach((s, k) => expect(s.startedAt).toBeCloseTo(t0 + (k - 4) * 0.5, 9));
    expect(be.clickHistory()).toHaveLength(20);
    be.cancelTake();
    expect(srcs.every((s) => s.stopped)).toBe(true);
  });

  it('plays calibration clicks and a sanity tone through the click bus', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playCalibrationClicks([1, 1.5].map((t) => t as never), 'wood');
    await be.playTone(440, 0.3, 2 as never);
    const srcs = world.ctx.bufferSources;
    expect(srcs.map((s) => s.startedAt)).toEqual([1, 1.5, 2]);
    const tone = srcs[2]?.buffer?.getChannelData(0) as Float32Array;
    expect(tone.length).toBe(14400);
    expect(tone[0]).toBe(0);
    // About 440 Hz: count zero crossings over the steady middle.
    let zc = 0;
    for (let i = 2000; i < 12000; i++) if ((tone[i - 1] as number) < 0 !== (tone[i] as number) < 0) zc++;
    expect(zc / 2 / (10000 / 48000)).toBeCloseTo(440, -1);
    expect(srcs.every((s) => s.outs[0] === (be.clickOutput() as unknown))).toBe(true);
  });

  it('audibleNow uses getOutputTimestamp, else currentTime minus base and output latency', async () => {
    const { world, be } = setup();
    await be.unlock();
    world.ctx.frame = 48000 * 3;
    expect(be.audibleNow()).toBeCloseTo(3 - 0.025, 9);
    world.ctx.outputTimestamp = { contextTime: 2.9, performanceTime: world.wallMs - 10 };
    expect(be.audibleNow()).toBeCloseTo(2.91, 9);
  });
});

describe('void paths and route changes (01 §7.9, W4, W7)', () => {
  async function live(): Promise<{ world: FakeAudioWorld; be: WebAudioBackend; got: InterruptionReason[] }> {
    const { world, be } = setup();
    await be.unlock();
    const got: InterruptionReason[] = [];
    be.onInterruption((r) => got.push(r));
    return { world, be, got };
  }

  it('context interrupted, or suspended/closed by the system, is an interruption', async () => {
    const { world, got } = await live();
    world.ctx.setState('interrupted');
    world.ctx.setState('running');
    world.ctx.setState('suspended');
    world.ctx.setState('closed');
    expect(got).toEqual(['interrupted', 'interrupted', 'interrupted']);
  });

  it('track ended and track muted', async () => {
    const { world, got } = await live();
    world.tracks[0]?.dispatch('mute');
    world.tracks[0]?.end();
    expect(got).toEqual(['interrupted', 'track-ended']);
  });

  it('page hidden, pagehide and freeze', async () => {
    const { world, got } = await live();
    world.document.visibilityState = 'hidden';
    world.document.dispatch('visibilitychange');
    world.window.dispatch('pagehide');
    world.document.dispatch('freeze');
    world.document.visibilityState = 'visible';
    world.document.dispatch('visibilitychange');
    expect(got).toEqual(['hidden', 'hidden', 'hidden']);
  });

  it('devicechange recomputes the route; during capture it is a device-change void', async () => {
    const { world, be, got } = await live();
    const routes: string[] = [];
    be.onRouteChange((r) => routes.push(r.inputKind));
    (world.tracks[0] as { label: string }).label = 'AirPods Pro';
    world.mediaDevices.dispatch('devicechange');
    expect(routes).toEqual(['bluetooth']);
    expect(got).toEqual([]);
    const port = workerPort();
    await startRunning(world, be, port.sink);
    world.mediaDevices.dispatch('devicechange');
    expect(got).toEqual(['device-change']);
    expect(routes).toEqual(['bluetooth']);
  });

  it('a declared output mode change changes the route key', async () => {
    const { be } = await live();
    const keys: string[] = [];
    be.onRouteChange((r) => keys.push(r.routeKey));
    be.setOutputMode('wired');
    be.setOutputMode('wired');
    expect(keys).toEqual([routeKeyOf('Built-in Microphone', 'wired', 48000, 'linux')]);
  });

  it('close() stops tracks, closes the context, removes listeners and reports no interruption', async () => {
    const { world, be, got } = await live();
    await be.close();
    expect(got).toEqual([]);
    expect(world.tracks[0]?.readyState).toBe('ended');
    expect(world.ctx.state).toBe('closed');
    expect(world.document.listenerCount('visibilitychange')).toBe(0);
    expect(world.mediaDevices.listenerCount('devicechange')).toBe(0);
    // A new session unlocks afresh.
    await be.unlock();
    expect(world.gumCount).toBe(2);
    expect(world.contexts).toHaveLength(2);
  });

  it('startCapture before unlock throws', () => {
    const { be } = setup();
    expect(() => be.startCapture(() => undefined)).toThrow(/unlock/);
  });
});

describe('route key stability', () => {
  it('a 48 kHz fixture take source renders through the real backend', async () => {
    // Sanity: renderMin output is valid input for the fake world too.
    const r = renderMin({ sampleRate: 48000, notes: [{ midi: 69, onsetSec: 0, durSec: 0.2 }], durationSec: 0.25 });
    const { world, be } = setup({ input: (f, n) => [r.samples.slice(f % r.samples.length, (f % r.samples.length) + n)] });
    await be.unlock();
    const port = workerPort();
    await startRunning(world, be, port.sink);
    await world.advance(100);
    expect(port.blocks.length).toBeGreaterThan(10);
  });
});

describe('Listen sounds (05 §9.2; playback-engine)', () => {
  const note = (hz: number, startSec: number, durSec: number) => ({ hz, startSec, durSec });

  it('playNotes schedules one source per note on its own bus at -12 dBFS, apart from the click bus', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 0.5), note(550, 0.5, 0.25)], { at: 3 as never, peak: 1 });
    const srcs = world.ctx.bufferSources;
    expect(srcs.map((s) => s.startedAt)).toEqual([3, 3.5]);
    const bus = srcs[0]?.outs[0] as unknown as FakeGain;
    expect(bus).not.toBe(be.clickOutput());
    expect(srcs.every((s) => s.outs[0] === bus)).toBe(true);
    expect(bus.gain.value).toBeCloseTo(10 ** (-12 / 20), 9);
    expect(be.clickOutput()?.gain.value).toBe(1);
    expect(srcs[0]?.buffer?.getChannelData(0).length).toBe(Math.ceil((0.5 + 0.06) * 48000));
    const peak = Math.max(...(srcs[0]?.buffer?.getChannelData(0) ?? []).map(Math.abs));
    expect(peak).toBeCloseTo(1, 5);
  });

  it('playClicks schedules clicks with accents on the click bus', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playClicks([1, 1.5, 2].map((t) => t as never), 'woodblock', [true, false, false]);
    const srcs = world.ctx.bufferSources;
    expect(srcs.map((s) => s.startedAt)).toEqual([1, 1.5, 2]);
    expect(srcs.every((s) => s.outs[0] === (be.clickOutput() as unknown))).toBe(true);
    const accentPeak = Math.max(...(srcs[0]?.buffer?.getChannelData(0) ?? []).map(Math.abs));
    const plainPeak = Math.max(...(srcs[1]?.buffer?.getChannelData(0) ?? []).map(Math.abs));
    expect(accentPeak).toBeGreaterThan(plainPeak);
  });

  it('stopSounds stops notes, clicks, tones and calibration clicks at once', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 1)], { at: 5 as never, peak: 1 });
    await be.playClicks([5 as never], 'classic', [true]);
    await be.playTone(440, 0.3, 5 as never);
    await be.playCalibrationClicks([6 as never], 'tick');
    be.stopSounds();
    expect(world.ctx.bufferSources).toHaveLength(4);
    expect(world.ctx.bufferSources.every((s) => s.stopped)).toBe(true);
  });

  it('stopSounds during a take leaves the take clicks', async () => {
    const { world, be } = setup();
    await be.unlock();
    const { clicks } = await be.scheduleTake(takeParams());
    const takeSrcs = world.ctx.bufferSources.slice();
    expect(takeSrcs).toHaveLength(clicks.length);
    be.stopSounds();
    expect(takeSrcs.every((s) => !s.stopped)).toBe(true);
    be.cancelTake();
    expect(takeSrcs.every((s) => s.stopped)).toBe(true);
  });

  it('stopSounds before a take leaves a later take intact, and a preview then stops while the take plays', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playClicks([1 as never, 1.5 as never], 'classic', [true, false]);
    const previews = world.ctx.bufferSources.slice();
    await be.scheduleTake(takeParams());
    const take = world.ctx.bufferSources.slice(previews.length);
    be.stopSounds();
    expect(previews.every((s) => s.stopped)).toBe(true);
    expect(take.every((s) => !s.stopped)).toBe(true);
  });

  it('refuses playNotes, playClicks and playTone while a take is scheduled, and accepts them again after cancelTake', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.scheduleTake(takeParams());
    const n = world.ctx.bufferSources.length;
    await expect(be.playNotes([note(440, 0, 0.5)], { peak: 1 })).rejects.toThrow(/take is scheduled/);
    await expect(be.playClicks([9 as never], 'classic', [true])).rejects.toThrow(/take is scheduled/);
    await expect(be.playTone(440, 0.2, 9 as never)).rejects.toThrow(/take is scheduled/);
    expect(world.ctx.bufferSources).toHaveLength(n);
    be.cancelTake();
    await be.playNotes([note(440, 0, 0.5)], { peak: 1 });
    expect(world.ctx.bufferSources).toHaveLength(n + 1);
  });

  it('accepts sounds once the take has ended on the audio clock', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.scheduleTake(takeParams({ totalBeats: 2 }));
    await world.advance(8000);
    await be.playNotes([note(440, 0, 0.5)], { peak: 1 });
  });

  it('a played source that ends leaves nothing for stopSounds to stop', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 0.1)], { at: 1 as never, peak: 0.5 });
    world.ctx.bufferSources[0]?.onended?.();
    be.stopSounds();
    expect(world.ctx.bufferSources[0]?.stopped).toBe(false);
  });

  it('reuses the rendered buffer data for the same pitch and length', async () => {
    const { world, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 0.2), note(440, 0.3, 0.2)], { at: 1 as never, peak: 1 });
    const [a, b] = world.ctx.bufferSources.map((s) => s.buffer?.getChannelData(0) as Float32Array);
    expect(Array.from(a ?? []).slice(1000, 1010)).toEqual(Array.from(b ?? []).slice(1000, 1010));
  });
});
