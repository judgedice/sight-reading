import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureBlock, MessagePortLike, PlatformCapabilities, TakeSchedule, WorkerMessage } from '../../../core/platform.ts';
import { renderClick as coreRenderClick } from '../../../core/click-sounds.ts';
import { routeKeyOf } from '../../shared/audio/route.ts';
import { LISTEN_BUS_GAIN } from '../../shared/audio/listen-voice.ts';
import { CUT_FADE_SEC, MAX_LEAD_SEC } from '../../shared/audio/sampler.ts';
import { NativeAudioBackend, type CaptureFault, type InterruptionReason, type NativeAudioBackendOptions } from './native-audio-backend.ts';
import { FakeNativeIpc, type FakeNativeIpcOptions } from './testing/fake-native-ipc.ts';
import { NativeVoiceError } from './voice-context.ts';

const caps = (): PlatformCapabilities => ({
  platform: 'desktop', outputLatencyReported: false, wakeLock: true, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser',
});

const open: (() => void)[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c();
});

function setup(o: FakeNativeIpcOptions = {}, b: Partial<NativeAudioBackendOptions> = {}): { ipc: FakeNativeIpc; be: NativeAudioBackend } {
  const ipc = new FakeNativeIpc(o);
  const be = new NativeAudioBackend({ ipc, capabilities: caps(), perfNow: ipc.perfNow, ...b });
  return { ipc, be };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const takeParams = (over: Partial<TakeSchedule> = {}): TakeSchedule => ({
  leadSec: 0.5, bpm: 120, beatsPerBar: 4, countInBeats: 4, totalBeats: 16, mode: 'audible', timbre: 'tick', accentDb: 5, ...over,
});

const note = (hz: number, startSec: number, durSec: number) => ({ hz, startSec, durSec });

/** A DSP-worker stand-in on a MessageChannel: records the blocks the backend relays. */
function workerPort(): { sink: MessagePortLike; blocks: CaptureBlock[] } {
  const ch = new MessageChannel();
  const blocks: CaptureBlock[] = [];
  ch.port2.onmessage = (ev: MessageEvent) => {
    const m = ev.data as WorkerMessage;
    if (m.type === 'block') blocks.push(m.block);
  };
  open.push(() => {
    ch.port1.close();
    ch.port2.close();
  });
  return { sink: ch.port1 as unknown as MessagePortLike, blocks };
}

const expectContiguous = (blocks: readonly CaptureBlock[]): void => {
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1] as CaptureBlock;
    const b = blocks[i] as CaptureBlock;
    expect(b.seq).toBe(a.seq + 1);
    expect(Math.abs(b.startT - (a.startT + a.lowband.length / a.analysisRate))).toBeLessThan(1e-9);
  }
};

describe('unlock (W1, W2)', () => {
  it('opens the engine, asks for the microphone and reports the route', async () => {
    const { ipc, be } = setup();
    const route = await be.unlock();
    expect(ipc.calls.slice(0, 2)).toEqual(['permission', 'open']);
    expect(ipc.permissionCalls).toEqual([true]);
    expect(ipc.openCalls).toEqual([{ input: true, outputMode: 'speakers' }]);
    expect(be.audioInfo()).toEqual({ contextSampleRate: 48000, contextRecreated: false, audioSessionType: null, clockRateError: null });
    expect(route.appliedProcessing).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(route.inputKind).toBe('built-in');
    expect(route.reportedLatencySec).toBeCloseTo(0.025, 9);
    expect(route.routeKey).toBe(routeKeyOf('fake-in>fake-out@128/128', 'speakers', 48000, 'linux'));
    expect(route.trackSampleRate).toBe(48000);
    expect(be.capabilities.outputLatencyReported).toBe(true);
    expect(be.latencyReport()?.trust).toBe('A');
  });

  it('trust C: no reported latency, outputLatencyReported false', async () => {
    const { be } = setup({ latency: { trust: 'C', outputSec: 0.08 } });
    const route = await be.unlock();
    expect(route.reportedLatencySec).toBeUndefined();
    expect(be.capabilities.outputLatencyReported).toBe(false);
  });

  it('transport types set the input kind; the key follows device ids and buffer sizes, not labels', async () => {
    const usb = setup({ route: { inputTransport: 'usb' } });
    expect((await usb.be.unlock()).inputKind).toBe('usb-interface');
    const bt = setup({ route: { inputTransport: 'bluetooth' } });
    expect((await bt.be.unlock()).inputKind).toBe('bluetooth');
    const a = await setup({ outFrames: 128 }).be.unlock();
    const b = await setup({ outFrames: 256 }).be.unlock();
    const c = await setup({ route: { inputUid: 'other' } }).be.unlock();
    expect(new Set([a.routeKey, b.routeKey, c.routeKey]).size).toBe(3);
  });

  it('a denied microphone rejects unlock with NotAllowedError (the session reads mic-denied)', async () => {
    const { ipc, be } = setup({ permission: 'denied' });
    await expect(be.unlock()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(ipc.openCalls).toEqual([]);
    expect(await be.permissionState()).toBe('denied');
  });

  it('keeps one engine session over ten takes (W2)', async () => {
    const { ipc, be } = setup();
    for (let i = 0; i < 10; i++) {
      await be.unlock();
      const port = workerPort();
      await be.startCapture(port.sink);
      ipc.advance(0.05);
      be.stopCapture();
    }
    expect(ipc.openCalls).toHaveLength(1);
    await be.close();
    expect(ipc.isOpen).toBe(false);
  });

  it('concurrent unlocks share one open', async () => {
    const { ipc, be } = setup();
    const [a, b] = await Promise.all([be.unlock(), be.unlock()]);
    expect(a).toEqual(b);
    expect(ipc.openCalls).toHaveLength(1);
  });

  it('reports permission state from the engine', async () => {
    const { ipc, be } = setup({ permission: 'prompt' });
    expect(await be.permissionState()).toBe('prompt');
    ipc.failNext('permission', 'nope');
    expect(await be.permissionState()).toBe('unknown');
  });

  it('startCapture, scheduleTake and sounds before unlock reject', async () => {
    const { be } = setup();
    await expect(be.startCapture(() => undefined)).rejects.toThrow(/unlock/);
    await expect(be.scheduleTake(takeParams())).rejects.toThrow(/unlock/);
    await expect(be.playClicks([1 as never], 'classic', [true])).rejects.toThrow(/unlock/);
  });
});

describe('the engine clock', () => {
  it('maps performance.now() onto the engine through the shortest of the sync round trips', async () => {
    const rtts = [20, 9, 1, 15, 7];
    const { ipc, be } = setup({ syncRttMs: (i) => rtts[i] ?? 5 });
    await be.unlock();
    expect(Math.abs(be.now() - ipc.engineNow)).toBeLessThan(1e-3);
    ipc.advance(3.25);
    expect(be.now()).toBeCloseTo(ipc.engineNow, 3);
  });

  it('follows the anchors of a device whose clock runs slow', async () => {
    const { ipc, be } = setup({ hostPerEngineSec: 1.01 });
    await be.unlock();
    ipc.advance(20);
    expect(Math.abs(be.now() - ipc.engineNow)).toBeLessThan(0.3 / 48000 * 128 + 0.005);
    expect(be.clockRate()).toBeCloseTo(1 / 1.01, 6);
  });

  it('never moves backwards', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    let last = be.now();
    for (let i = 0; i < 40; i++) {
      ipc.advance(0.1);
      const t = be.now();
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });

  it('audibleNow is the render head minus the reported output latency', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    ipc.advance(3);
    expect(be.audibleNow()).toBeCloseTo(be.now() - 0.025, 9);
  });

  it('is 0 before unlock', () => {
    const { be } = setup();
    expect(be.now()).toBe(0);
    expect(be.audioInfo().contextSampleRate).toBe(0);
  });
});

describe('clock checks (01 §7.8)', () => {
  it('measureClockRate reports frames per second against the engine rate', async () => {
    const { be } = setup({ clockError: 0.0125 });
    await be.unlock();
    const r = await be.measureClockRate(2);
    expect(r.expected).toBe(48000);
    expect(r.framesPerSec).toBeCloseTo(48000 * 1.0125, 6);
  });

  it('an error above the 2% limit is not ok, and nothing is recreated', async () => {
    const { ipc, be } = setup({ clockError: 0.088 });
    await be.unlock();
    const r = await be.checkClockRate();
    expect(r).toMatchObject({ ok: false, error: 0.088, recreated: false, measured: true });
    expect(be.audioInfo().clockRateError).toBe(0.088);
    expect(ipc.openCalls).toHaveLength(1);
  });

  it('a clock that could not be measured is ok with error null, and NaN frames per second', async () => {
    const { be } = setup({ clockError: null });
    await be.unlock();
    expect(await be.checkClockRate()).toMatchObject({ ok: true, error: null, measured: false });
    expect(Number.isNaN((await be.measureClockRate(2)).framesPerSec)).toBe(true);
  });

  it('a small error passes and is stored for audioInfo', async () => {
    const { be } = setup({ clockError: -0.0003 });
    await be.unlock();
    expect(await be.checkClockRate()).toMatchObject({ ok: true, error: -0.0003 });
    expect(be.audioInfo().clockRateError).toBe(-0.0003);
  });
});

describe('capture (section 3)', () => {
  const tone = (frame: number): number => 0.3 * Math.sin((2 * Math.PI * 440 * frame) / 48000);

  it('delivers contiguous blocks over a port; the main thread relays', async () => {
    const { ipc, be } = setup();
    ipc.inputSignal = tone;
    await be.unlock();
    ipc.advance(10);
    const port = workerPort();
    const origin = ipc.engineNow;
    await be.startCapture(port.sink);
    expect(be.captureRelay).toBe(true);
    expect(be.captureOrigin()).toBeCloseTo(origin, 9);
    ipc.advance(2);
    be.stopCapture();
    await tick();
    expect(be.captureOrigin()).toBeNull();
    expect(port.blocks.length).toBeGreaterThan(370);
    expect(port.blocks[0]?.startT).toBeGreaterThanOrEqual(origin);
    expectContiguous(port.blocks);
    expect(be.captureStats()).toMatchObject({ droppedBlocks: 0, relay: true });
    expect(be.captureStats().postedBlocks).toBe(port.blocks.length);
    expect(ipc.calls).toContain('captureStop');
  });

  it('a callback sink receives copies it may keep', async () => {
    const { ipc, be } = setup();
    ipc.inputSignal = tone;
    await be.unlock();
    const got: WorkerMessage[] = [];
    await be.startCapture((m) => got.push(m));
    ipc.advance(0.5);
    be.stopCapture();
    const blocks = got.flatMap((m) => (m.type === 'block' ? [m.block] : []));
    expect(blocks.length).toBeGreaterThan(80);
    const first = Array.from(blocks[0]?.lowband ?? []);
    ipc.advance(1);
    expect(Array.from(blocks[0]?.lowband ?? [])).toEqual(first);
    expect(new Set(blocks.map((b) => b.lowband.buffer)).size).toBe(blocks.length);
  });

  it('reports backlog above 120 ms of queued audio, once', async () => {
    const { ipc, be } = setup();
    ipc.inputSignal = tone;
    await be.unlock();
    const faults: CaptureFault[] = [];
    be.onCaptureFault((f) => faults.push(f));
    await be.startCapture(() => undefined);
    ipc.holdPackets = true;
    ipc.advance(0.4);
    ipc.releasePackets();
    be.stopCapture();
    const backlog = faults.filter((f) => f.kind === 'backlog');
    expect(backlog).toHaveLength(1);
    expect((backlog[0] as { queueMs: number }).queueMs).toBeGreaterThan(120);
    expect(be.captureStats().maxQueueMs).toBeGreaterThan(120);
  });

  it('no backlog while packets arrive as they are made', async () => {
    const { ipc, be } = setup();
    ipc.inputSignal = tone;
    await be.unlock();
    const faults: CaptureFault[] = [];
    be.onCaptureFault((f) => faults.push(f));
    await be.startCapture(() => undefined);
    ipc.advance(2);
    be.stopCapture();
    expect(faults).toEqual([]);
    expect(be.captureStats().maxQueueMs).toBeLessThan(20);
  });

  it('frames lost on the way in are one capture-gap fault and dropped blocks', async () => {
    const { ipc, be } = setup();
    ipc.inputSignal = tone;
    await be.unlock();
    const faults: CaptureFault[] = [];
    be.onCaptureFault((f) => faults.push(f));
    const got: CaptureBlock[] = [];
    await be.startCapture((m) => void (m.type === 'block' && got.push(m.block)));
    ipc.advance(0.2);
    ipc.dropInput(1536);
    ipc.advance(0.5);
    be.stopCapture();
    expect(faults.filter((f) => f.kind === 'capture-gap')).toHaveLength(1);
    expect(be.captureStats().droppedBlocks).toBe(6);
    expectContiguous(got);
  });

  it('a failed capture start rejects and leaves no capture', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    ipc.failNext('captureStart', 'no input');
    await expect(be.startCapture(() => undefined)).rejects.toThrow(/no input/);
    expect(be.captureOrigin()).toBeNull();
    await be.startCapture(() => undefined);
    expect(be.captureOrigin()).not.toBeNull();
  });

  it('testClock-style origin: scheduling a take after capture start uses the engine clock', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    ipc.advance(4);
    await be.startCapture(() => undefined);
    const { t0 } = await be.scheduleTake(takeParams({ leadSec: 0.6 }));
    expect(t0).toBeCloseTo(be.now() + 0.6 + 2, 6);
    expect(be.captureOrigin() as number).toBeLessThan(t0 as number);
  });
});

describe('input switching (R13 practise without listening)', () => {
  it('setInputEnabled(false): unlock opens the output without the microphone; turning it on reopens with it', async () => {
    const { ipc, be } = setup();
    be.setInputEnabled(false);
    const route = await be.unlock();
    expect(ipc.permissionCalls).toEqual([]);
    expect(ipc.openCalls).toEqual([{ input: false, outputMode: 'speakers' }]);
    expect(route.trackSampleRate).toBeNull();
    const { clicks } = await be.scheduleTake(takeParams());
    expect(clicks.length).toBeGreaterThan(0);
    await be.unlock();
    expect(ipc.openCalls).toHaveLength(1);
    be.setInputEnabled(true);
    await be.unlock();
    expect(ipc.openCalls).toEqual([
      { input: false, outputMode: 'speakers' },
      { input: true, outputMode: 'speakers' },
    ]);
  });

  it('reopening restarts engine time and the next take uploads its clicks again', async () => {
    const { ipc, be } = setup();
    be.setInputEnabled(false);
    await be.unlock();
    await be.scheduleTake(takeParams());
    const uploads = ipc.calls.filter((c) => c === 'putBuffer').length;
    be.cancelTake();
    be.setInputEnabled(true);
    await be.unlock();
    expect(be.now()).toBeLessThan(0.1);
    await be.scheduleTake(takeParams());
    expect(ipc.calls.filter((c) => c === 'putBuffer').length).toBeGreaterThan(uploads);
    expect(ipc.liveVoices.every((v) => v.session === 2)).toBe(true);
  });

  it('releaseInput stops capture and the microphone, keeps the output; the next unlock opens it again', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    const port = workerPort();
    await be.startCapture(port.sink);
    be.releaseInput();
    await tick();
    expect(be.captureOrigin()).toBeNull();
    expect(ipc.calls).toContain('releaseInput');
    expect(ipc.isOpen).toBe(true);
    await be.unlock();
    expect(ipc.openCalls).toHaveLength(2);
    expect(ipc.openCalls[1]?.input).toBe(true);
  });

  it('reopenInput stops capture and opens the input afresh', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.startCapture(() => undefined);
    await be.reopenInput();
    expect(ipc.openCalls).toHaveLength(2);
    expect(be.captureOrigin()).toBeNull();
  });
});

describe('metronome on the backend (W9)', () => {
  it('schedules every click of a take at Start, each on its exact engine frame', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    ipc.advance(0.1);
    const now = be.now();
    const { t0, clicks } = await be.scheduleTake(takeParams({ leadSec: 0.6 }));
    expect(t0).toBeCloseTo(now + 0.6 + 2, 3);
    const voices = ipc.voices.filter((v) => v.group === 'take');
    expect(voices).toHaveLength(clicks.length);
    expect(ipc.calls.filter((c) => c === 'schedule:take')).toHaveLength(1);
    voices.forEach((v, k) => {
      expect(v.spec.t).toBe((clicks[k] as { t: number }).t);
      expect(v.startFrame).toBe(Math.round((clicks[k] as { t: number }).t * 48000));
      expect(v.late).toBe(false);
    });
    // Nothing on the main thread moves a click: time passes in the engine only.
    ipc.advance(3);
    expect(voices.map((v) => v.startedAtFrame)).toEqual(voices.map((v) => (v.startFrame <= ipc.headFrame ? v.startFrame : null)));
    expect(be.clickHistory()).toHaveLength(20);
    be.cancelTake();
    await tick();
    expect(ipc.calls).toContain('cancel:take');
    expect(ipc.liveVoices).toHaveLength(0);
  });

  it('the take is 20 clicks with beat one of each bar accented and the take group is never given to sounds', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    const { clicks } = await be.scheduleTake(takeParams());
    expect(clicks.filter((c) => c.accent)).toHaveLength(5);
    expect(ipc.calls.filter((c) => c === 'schedule:sounds')).toHaveLength(0);
  });

  const data = (ipc: FakeNativeIpc, id: number): number[] => Array.from(ipc.bufferData(id));
  const scaled = (x: Float32Array, g: number): number[] => {
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = (x[i] as number) * g;
    return Array.from(out);
  };

  for (const sound of ['classic', 'woodblock', 'beep'] as const) {
    for (const mode of ['wired', 'bluetooth', 'speakers'] as const) {
      const recipe = mode !== 'speakers';
      it(`${sound} on ${mode}: beat one is the ${recipe ? 'accent' : 'offbeat'} recipe at +accentDb, the other beats the offbeat recipe at 0 dB`, async () => {
        const { ipc, be } = setup({}, { outputMode: mode });
        await be.unlock();
        const { clicks } = await be.scheduleTake(takeParams({ timbre: sound, accentDb: 3, totalBeats: 8 }));
        const voices = ipc.voices.filter((v) => v.group === 'take');
        expect(voices).toHaveLength(clicks.length);
        clicks.forEach((c, i) => {
          const want = c.accent ? scaled(coreRenderClick(sound, recipe, 48000), 0.5 * 10 ** (3 / 20)) : scaled(coreRenderClick(sound, false, 48000), 0.5);
          expect(data(ipc, (voices[i] as { spec: { buffer: number } }).spec.buffer)).toEqual(want);
        });
        expect(new Set(voices.map((v) => v.spec.buffer)).size).toBe(2);
        expect(ipc.calls.filter((c) => c === 'putBuffer')).toHaveLength(2);
      });
    }
  }

  it('a declared output mode change is used by the next take', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    be.setOutputMode('wired');
    const { clicks } = await be.scheduleTake(takeParams({ timbre: 'classic', accentDb: 3, totalBeats: 8 }));
    const first = ipc.voices.find((v) => v.group === 'take');
    expect(data(ipc, (first as { spec: { buffer: number } }).spec.buffer)).toEqual(scaled(coreRenderClick('classic', true, 48000), 0.5 * 10 ** (3 / 20)));
    expect(clicks[0]?.accent).toBe(true);
  });

  it('plays calibration clicks (accents, group sounds) and a sanity tone of the asked length', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playCalibrationClicks([1, 1.5].map((t) => t as never), 'wood');
    await be.playTone(440, 0.3, 2 as never);
    const v = ipc.voices;
    expect(v.map((x) => x.spec.t)).toEqual([1, 1.5, 2]);
    expect(v.every((x) => x.group === 'sounds')).toBe(true);
    const tone = ipc.bufferData(v[2]?.spec.buffer as number);
    expect(tone.length).toBe(14400);
    expect(tone[0]).toBe(0);
    let zc = 0;
    for (let i = 2000; i < 12000; i++) if ((tone[i - 1] as number) < 0 !== (tone[i] as number) < 0) zc++;
    expect(zc / 2 / (10000 / 48000)).toBeCloseTo(440, -1);
    expect(be.clickHistory()).toEqual([]);
  });

  it('a tone buffer is dropped from the engine once the tone has played', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playTone(440, 0.2, 0.1 as never);
    const id = ipc.voices[0]?.spec.buffer as number;
    expect(ipc.buffers.has(id)).toBe(true);
    ipc.advance(0.5);
    await tick();
    expect(ipc.droppedBufferIds).toEqual([id]);
    expect(ipc.buffers.has(id)).toBe(false);
  });

  it('a voice already behind the render head is reported late (starts at once)', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    ipc.advance(2);
    await be.playClicks([1 as never, 2.5 as never], 'classic', [true, false]);
    expect(be.voiceStats().late).toBe(1);
    expect(ipc.voices[0]).toMatchObject({ late: true, startedAtFrame: ipc.voices[0]?.scheduledAtFrame });
    expect(ipc.voices[1]?.late).toBe(false);
  });
});

describe('void paths and route changes (01 §7.9, W4, W7)', () => {
  async function live(o: FakeNativeIpcOptions = {}): Promise<{ ipc: FakeNativeIpc; be: NativeAudioBackend; got: InterruptionReason[] }> {
    const { ipc, be } = setup(o);
    await be.unlock();
    const got: InterruptionReason[] = [];
    be.onInterruption((r) => got.push(r));
    return { ipc, be, got };
  }

  it('every engine interruption reaches the callbacks', async () => {
    const { ipc, got } = await live();
    for (const r of ['interrupted', 'hidden', 'track-ended', 'device-change'] as const) ipc.interrupt(r);
    expect(got).toEqual(['interrupted', 'hidden', 'track-ended', 'device-change']);
  });

  it('a route event with a new device recomputes the route and notifies; during capture it is a device-change void', async () => {
    const { ipc, be, got } = await live();
    const routes: string[] = [];
    be.onRouteChange((r) => routes.push(r.inputKind));
    ipc.changeRoute({ inputTransport: 'bluetooth', inputUid: 'airpods' }, { trust: 'C' });
    expect(routes).toEqual(['bluetooth']);
    expect(got).toEqual([]);
    expect(be.capabilities.outputLatencyReported).toBe(false);
    await be.startCapture(() => undefined);
    ipc.changeRoute({ inputTransport: 'built-in', inputUid: 'fake-in' }, { trust: 'A' });
    expect(routes).toEqual(['bluetooth', 'built-in']);
    expect(got).toEqual(['device-change']);
    expect(be.capabilities.outputLatencyReported).toBe(true);
  });

  it('a route event that keeps the key does not notify', async () => {
    const { ipc, be } = await live();
    const routes: string[] = [];
    be.onRouteChange((r) => routes.push(r.routeKey));
    ipc.changeRoute({}, { outputSec: 0.03 });
    expect(routes).toEqual([]);
  });

  it('a declared output mode change changes the route key, once', async () => {
    const { be } = await live();
    const keys: string[] = [];
    be.onRouteChange((r) => keys.push(r.routeKey));
    be.setOutputMode('wired');
    be.setOutputMode('wired');
    expect(keys).toEqual([routeKeyOf('fake-in>fake-out@128/128', 'wired', 48000, 'linux')]);
  });

  it('unsubscribed callbacks are not called', async () => {
    const { ipc, be } = await live();
    const seen: string[] = [];
    const off = be.onInterruption((r) => seen.push(r));
    off();
    ipc.interrupt('hidden');
    expect(seen).toEqual([]);
  });

  it('close() stops capture, closes the engine, reports no interruption and ignores later events', async () => {
    const { ipc, be, got } = await live();
    await be.startCapture(() => undefined);
    const emit = ipc.emit.bind(ipc);
    await be.close();
    expect(got).toEqual([]);
    expect(ipc.isOpen).toBe(false);
    expect(be.captureOrigin()).toBeNull();
    emit({ type: 'interruption', reason: 'hidden' });
    expect(got).toEqual([]);
    // A new session unlocks afresh, on time starting again.
    await be.unlock();
    expect(ipc.openCalls).toHaveLength(2);
    expect(be.now()).toBeLessThan(0.1);
  });

  it('a stale event from an engine session that was replaced is ignored', async () => {
    const { ipc, be, got } = await live();
    const stale = (ipc as unknown as { sink: (e: unknown) => void }).sink;
    be.setInputEnabled(false);
    await be.close();
    await be.unlock();
    stale({ type: 'interruption', reason: 'hidden' });
    expect(got).toEqual([]);
  });
});

describe('Listen sounds (05 §9.2; playback-engine)', () => {
  it('playNotes schedules one voice per note on the Listen bus at -12 dBFS, in group sounds', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 0.5), note(550, 0.5, 0.25)], { at: 3 as never, peak: 1 });
    const v = ipc.voices;
    expect(v.map((x) => x.spec.t)).toEqual([3, 3.5]);
    expect(v.every((x) => x.group === 'sounds')).toBe(true);
    expect(v[0]?.spec.gain).toBeCloseTo(LISTEN_BUS_GAIN, 9);
    expect(v[0]?.spec.env).toBeUndefined();
    const buf = ipc.bufferData(v[0]?.spec.buffer as number);
    expect(buf.length).toBe(Math.ceil((0.5 + 0.06) * 48000));
    expect(Math.max(...Array.from(buf).map(Math.abs))).toBeCloseTo(1, 5);
  });

  it('playClicks schedules clicks with accents', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playClicks([1, 1.5, 2].map((t) => t as never), 'woodblock', [true, false, false]);
    expect(ipc.voices.map((x) => x.spec.t)).toEqual([1, 1.5, 2]);
    const peak = (i: number): number => Math.max(...Array.from(ipc.bufferData(ipc.voices[i]?.spec.buffer as number)).map(Math.abs));
    expect(peak(0)).toBeGreaterThan(peak(1));
  });

  it('stopSounds cancels notes, clicks, tones and calibration clicks at once', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 1)], { at: 5 as never, peak: 1 });
    await be.playClicks([5 as never], 'classic', [true]);
    await be.playTone(440, 0.3, 5 as never);
    await be.playCalibrationClicks([6 as never], 'tick');
    be.stopSounds();
    await tick();
    expect(ipc.voices).toHaveLength(4);
    expect(ipc.voices.every((v) => v.endReason === 'cancelled')).toBe(true);
    expect(ipc.calls).toContain('cancel:sounds');
  });

  it('stopSounds during a take leaves the take clicks; cancelTake then stops them', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    const { clicks } = await be.scheduleTake(takeParams());
    be.stopSounds();
    await tick();
    expect(ipc.liveVoices).toHaveLength(clicks.length);
    expect(ipc.calls).not.toContain('cancel:take');
    be.cancelTake();
    await tick();
    expect(ipc.liveVoices).toHaveLength(0);
  });

  it('stopSounds before a take leaves a later take intact, and a preview then stops while the take plays', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playClicks([1 as never, 1.5 as never], 'classic', [true, false]);
    const { clicks } = await be.scheduleTake(takeParams());
    be.stopSounds();
    await tick();
    const previews = ipc.voices.filter((v) => v.group === 'sounds');
    expect(previews.every((v) => v.endReason === 'cancelled')).toBe(true);
    expect(ipc.liveVoices.filter((v) => v.group === 'take')).toHaveLength(clicks.length);
  });

  it('refuses playNotes, playClicks and playTone while a take is scheduled, and accepts them again after cancelTake', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.scheduleTake(takeParams());
    const n = ipc.voices.length;
    await expect(be.playNotes([note(440, 0, 0.5)], { peak: 1 })).rejects.toThrow(/take is scheduled/);
    await expect(be.playClicks([9 as never], 'classic', [true])).rejects.toThrow(/take is scheduled/);
    await expect(be.playTone(440, 0.2, 9 as never)).rejects.toThrow(/take is scheduled/);
    expect(ipc.voices).toHaveLength(n);
    be.cancelTake();
    await be.playNotes([note(440, 0, 0.5)], { peak: 1 });
    expect(ipc.voices).toHaveLength(n + 1);
  });

  it('accepts sounds on a new session after close, though the old take would still be running on the old clock', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.scheduleTake(takeParams());
    await be.close();
    await be.unlock();
    expect(ipc.openCalls).toHaveLength(2);
    await be.playNotes([note(440, 0, 0.5)], { peak: 1 });
    await be.playClicks([0.5 as never], 'classic', [true]);
  });

  it('accepts sounds once the take has ended on the engine clock', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.scheduleTake(takeParams({ totalBeats: 2 }));
    ipc.advance(8);
    await be.playNotes([note(440, 0, 0.5)], { peak: 1 });
  });

  it('a voice that has played out leaves nothing for stopSounds to stop', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 0.1)], { at: 1 as never, peak: 0.5 });
    ipc.advance(2);
    be.stopSounds();
    await tick();
    expect(ipc.voices[0]?.endReason).toBe('ran-out');
  });

  it('reuses one engine buffer for the same pitch and length', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playNotes([note(440, 0, 0.2), note(440, 0.3, 0.2)], { at: 1 as never, peak: 1 });
    expect(ipc.voices[0]?.spec.buffer).toBe(ipc.voices[1]?.spec.buffer);
    expect(ipc.calls.filter((c) => c === 'putBuffer')).toHaveLength(1);
    expect(ipc.calls.filter((c) => c === 'schedule:sounds')).toHaveLength(1);
  });
});

describe('sampled notes (round 2, 02-sounds.md)', () => {
  const index = { version: 1, sets: { flute: { kind: 'sustain', range: [60, 96], attack: 0.03, release: 0.2, samples: [
    { file: 'C4.mp3', midi: 60, tune: 0, onset: 0.004, loopStart: 0.9, loopEnd: 1.8 },
    { file: 'A4.mp3', midi: 69, tune: 0, onset: 0.004, loopStart: 0.9, loopEnd: 1.8 },
  ] } }, instruments: { flute: { set: 'flute' } } };

  function soundFetch(o: { offline?: boolean } = {}) {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      if (o.offline) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => index, arrayBuffer: async () => new Uint8Array(8).buffer };
    };
    return { urls, f };
  }

  /** What the engine's decoder returns for every file: 2 s of 0.5 at 1 kHz. */
  const decoder = () => ({ sampleRate: 1000, samples: new Float32Array(2000).fill(0.5) });

  it('prepareSound before the engine is open falls back; after unlock the set loads in the engine', async () => {
    const sf = soundFetch();
    const { ipc, be } = setup({ decoder }, { fetchSound: sf.f });
    expect(await be.prepareSound('flute')).toBe('fallback');
    expect(be.soundState('flute')).toBe('failed');
    await be.unlock();
    expect(await be.prepareSound('flute')).toBe('ready');
    expect(be.soundState('flute')).toBe('ready');
    expect(ipc.calls.filter((c) => c === 'decode')).toHaveLength(2);
    expect(sf.urls).toContain('sounds/flute/C4.mp3');
  });

  it('plays the additive voice while the set loads, then the samples on the Listen bus', async () => {
    const sf = soundFetch();
    const { ipc, be } = setup({ decoder }, { fetchSound: sf.f });
    await be.unlock();
    await be.playNotes([note(440, 0, 0.5)], { at: 1 as never, peak: 1, sound: 'flute' });
    expect(ipc.voices).toHaveLength(1);
    expect(ipc.voices[0]?.spec.env).toBeUndefined();
    await be.prepareSound('flute');
    await be.playNotes([note(523.25, 0, 0.5)], { at: 5 as never, peak: 0.8, sound: 'flute' });
    const s = ipc.voices[1] as NonNullable<(typeof ipc.voices)[number]>;
    expect(s.spec.loop).toBeDefined();
    expect(s.spec.gain).toBeCloseTo(LISTEN_BUS_GAIN, 9);
    // 0 at the start, up to the gain over the attack, held to the note's end, down over the release: four points.
    const env = s.spec.env as [number, number][];
    expect(env).toHaveLength(4);
    expect(env[0]).toEqual([s.spec.t, 0]);
    expect(env[3]?.[1]).toBe(0);
    expect(env[1]?.[1]).toBeCloseTo(0.8 * 10 ** (12 / 20), 6);
    expect(env[1]?.[1]).toBe(env[2]?.[1]);
    expect(env[2]?.[0]).toBeGreaterThan(env[1]?.[0] as number);
    expect(s.spec.stopAt).toBeGreaterThan(env[3]?.[0] as number);
    expect(s.spec.t).toBeGreaterThanOrEqual(5 - MAX_LEAD_SEC - 1e-9);
    expect(s.spec.rate).toBeCloseTo(2 ** (3 / 12), 2);
    expect(ipc.voices.every((v) => (v.spec.env?.length ?? 0) <= 8)).toBe(true);
  });

  it('a run of notes with shortened releases keeps every envelope within 8 points', async () => {
    const sf = soundFetch();
    const { ipc, be } = setup({ decoder }, { fetchSound: sf.f });
    await be.unlock();
    await be.prepareSound('flute');
    const run = Array.from({ length: 24 }, (_, i) => note(220 * 2 ** ((i % 12) / 12), i * 0.25, 0.2));
    await be.playNotes(run, { at: 2 as never, peak: 1, sound: 'flute' });
    expect(ipc.voices).toHaveLength(24);
    expect(Math.max(...ipc.voices.map((v) => v.spec.env?.length ?? 0))).toBe(4);
  });

  it('stopSounds cancels sampled notes with the rest, over the cut fade', async () => {
    const sf = soundFetch();
    const { ipc, be } = setup({ decoder }, { fetchSound: sf.f });
    await be.unlock();
    await be.prepareSound('flute');
    await be.playNotes([note(440, 0, 1)], { at: 5 as never, peak: 1, sound: 'flute' });
    be.stopSounds();
    await tick();
    expect(ipc.voices[0]?.endReason).toBe('cancelled');
    expect(ipc.voices[0]?.fadeSec).toBe(CUT_FADE_SEC);
  });

  it('a decoded set survives an engine reopen: its PCM is registered again when a voice needs it', async () => {
    const sf = soundFetch();
    const { ipc, be } = setup({ decoder }, { fetchSound: sf.f });
    be.setInputEnabled(false);
    await be.unlock();
    await be.prepareSound('flute');
    be.setInputEnabled(true);
    await be.unlock();
    const puts = ipc.calls.filter((c) => c === 'putBuffer').length;
    await be.playNotes([note(440, 0, 0.5)], { at: 1 as never, peak: 1, sound: 'flute' });
    expect(ipc.calls.filter((c) => c === 'putBuffer').length).toBe(puts + 1);
    expect(ipc.buffers.has(ipc.voices.at(-1)?.spec.buffer as number)).toBe(true);
  });

  it('a missing set or a failed fetch falls back to the additive voice with no throw', async () => {
    const off = setup({ decoder }, { fetchSound: soundFetch({ offline: true }).f });
    await off.be.unlock();
    await off.be.playNotes([note(440, 0, 0.3)], { at: 1 as never, peak: 1, sound: 'flute' });
    expect(off.ipc.voices).toHaveLength(1);
    expect(await off.be.prepareSound('flute')).toBe('fallback');
    const sf = soundFetch();
    const miss = setup({ decoder }, { fetchSound: sf.f });
    await miss.be.unlock();
    expect(await miss.be.prepareSound('oboe')).toBe('fallback');
    expect(miss.be.soundState('oboe')).toBe('missing');
  });

  it('a failed decode in the engine falls back', async () => {
    const sf = soundFetch();
    const { ipc, be } = setup({ decoder }, { fetchSound: sf.f });
    await be.unlock();
    ipc.failNext('decode', 'audio_decode: bad stream');
    expect(await be.prepareSound('flute')).toBe('fallback');
    expect(be.soundState('flute')).toBe('failed');
    expect(await be.prepareSound('flute')).toBe('ready');
  });
});

describe('latency and the engine loopback', () => {
  it('latencyReport is the engine report and null before unlock', async () => {
    const { be } = setup({ latency: { trust: 'B', inputSec: 0.02 } });
    expect(be.latencyReport()).toBeNull();
    await be.unlock();
    expect(be.latencyReport()).toMatchObject({ trust: 'B', outputSec: 0.025, inputSec: 0.02 });
  });

  it('measureLoopback asks for 8 tick clicks and returns the estimate; not while a take is scheduled', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    expect(await be.measureLoopback()).toMatchObject({ found: 8, roundTripMs: 23.4 });
    expect(ipc.loopbackCalls).toEqual([{ clicks: 8, timbre: 'tick' }]);
    await be.scheduleTake(takeParams());
    await expect(be.measureLoopback()).rejects.toThrow(/take is scheduled/);
  });
});

describe('voices the engine cannot hold', () => {
  it('more than 64 sounding at once is refused, not truncated, and nothing is sent', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    const times = Array.from({ length: 65 }, () => 1 as never);
    await expect(be.playClicks(times, 'classic', times.map(() => false))).rejects.toBeInstanceOf(NativeVoiceError);
    expect(ipc.calls).not.toContain('schedule:sounds');
    await be.playClicks(times.slice(0, 64), 'classic', times.slice(0, 64).map(() => false));
    expect(ipc.voices).toHaveLength(64);
  });

  it('an engine failure on schedule rejects the call and later calls still work', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    ipc.failNext('schedule:sounds', 'audio_schedule: boom');
    await expect(be.playClicks([1 as never], 'classic', [true])).rejects.toThrow(/boom/);
    await be.playClicks([2 as never], 'classic', [true]);
    expect(ipc.voices).toHaveLength(1);
  });

  it('voices the engine rejects arrive as rejected events and are counted', async () => {
    const { ipc, be } = setup();
    await be.unlock();
    await be.playClicks([1 as never], 'classic', [false]);
    ipc.emit({ type: 'rejected', ids: [1] });
    expect(be.voiceStats().rejected).toBe(1);
  });
});
