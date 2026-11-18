import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioContextLike, AudioNodeLike, WebAudioDeps } from './deps.ts';
import { FakeAudioWorld, FakeNode, flush, type FakeBufferSource, type FakeContext, type FakeGain } from './testing/fake-web-audio.ts';
import { SYNTHETIC_CAPTURE_MARKER, createSyntheticCapture, syntheticCaptureFlag, type SyntheticContextLike } from './synthetic-capture.ts';
import { WebAudioBackend } from './web-audio-backend.ts';

const caps: PlatformCapabilities = {
  platform: 'web', outputLatencyReported: false, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'ios', displayMode: 'browser',
};

class FakeParam {
  value = 0;
}
class FakeOsc extends FakeNode {
  readonly frequency = new FakeParam();
  type = 'sine';
  startedAt: number | null = null;
  constructor() {
    super('oscillator');
  }
  start(when = 0): void {
    this.startedAt = when;
  }
  stop(): void {
    // not needed
  }
}
class FakeDelay extends FakeNode {
  readonly delayTime = new FakeParam();
  constructor(readonly max: number) {
    super('delay');
  }
}
class FakeStreamDest extends FakeNode {
  readonly track = { readyState: 'live', label: 'dest', getSettings: () => ({}), stop() {}, addEventListener() {}, removeEventListener() {}, muted: false };
  readonly stream = { getAudioTracks: () => [this.track] };
  constructor() {
    super('stream-dest');
  }
}

/** The fake world's context, given the extra members of a real AudioContext that IOS7 needs. */
function augment(c: FakeContext): SyntheticContextLike {
  const oscs: FakeOsc[] = [];
  const delays: FakeDelay[] = [];
  const dests: FakeStreamDest[] = [];
  Object.assign(c, {
    createOscillator: () => {
      const o = new FakeOsc();
      oscs.push(o);
      return o;
    },
    createDelay: (max: number) => {
      const d = new FakeDelay(max);
      delays.push(d);
      return d;
    },
    createMediaStreamDestination: () => {
      const d = new FakeStreamDest();
      dests.push(d);
      return d;
    },
    oscs,
    delays,
    dests,
  });
  return c as unknown as SyntheticContextLike;
}

function setup(delayMs: number, extra: { toneHz?: number } = {}) {
  const world = new FakeAudioWorld();
  const base: WebAudioDeps = {
    ...world.deps,
    createContext: (o) => augment(world.deps.createContext(o) as FakeContext) as unknown as AudioContextLike,
    // The worklet node factory of the world reads the real FakeContext; unwrapping must hand it that.
  };
  const synth = createSyntheticCapture(base, { delayMs, ...extra });
  const be = new WebAudioBackend({ capabilities: caps, workletUrl: 'w.js', deps: synth.deps });
  return { world, synth, be };
}

const open: (() => void)[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c();
});

type Aug = FakeContext & { oscs: FakeOsc[]; delays: FakeDelay[]; dests: FakeStreamDest[] };

describe('synthetic capture source (IOS7)', () => {
  it('replaces getUserMedia: the backend unlocks without the real device being asked', async () => {
    const { world, synth, be } = setup(60);
    open.push(() => world.contexts.forEach((c) => c.workletNodes.forEach((n) => n.closePorts())));
    const route = await be.unlock();
    await flush();
    expect(world.gumCount).toBe(0);
    expect(synth.streamsServed).toBe(1);
    expect(route.sampleRate).toBe(48000);
    expect(world.calls).toContain('createWorkletNode:sr-capture');
  });

  it('builds tone -> stream and tap -> delay(d) -> stream, and the backend sees the tap as destination', async () => {
    const { world, synth, be } = setup(110);
    open.push(() => world.contexts.forEach((c) => c.workletNodes.forEach((n) => n.closePorts())));
    await be.unlock();
    await flush();
    const ctx = world.ctx as Aug;
    const rig = synth.rig()!;
    expect(ctx.delays).toHaveLength(1);
    expect(ctx.delays[0]!.delayTime.value).toBeCloseTo(0.11, 9);
    expect(ctx.delays[0]!.outs).toEqual([rig.feed]);
    expect(rig.tap.connect).toBeDefined();
    const tapNode = rig.tap as unknown as FakeGain;
    expect(tapNode.outs).toContain(ctx.destination);
    expect(tapNode.outs).toContain(ctx.delays[0]);
    expect(ctx.oscs[0]!.frequency.value).toBe(440);
    expect(ctx.oscs[0]!.startedAt).toBe(0);
    // The capture worklet is fed by the synthetic feed, not by a MediaStreamSource.
    expect((rig.feed as unknown as FakeGain).outs.some((n) => (n as FakeNode).kind === 'worklet')).toBe(true);
    expect(world.ctx.sources).toHaveLength(0);
    // The click bus feeds the tap. The silent zero-gain output goes to the real destination, so no cycle runs
    // through the delay line (a delay in a cycle is clamped to one render quantum).
    const feeds = (n: AudioNodeLike): boolean => (n as FakeNode).outs.includes(tapNode);
    const bus = ctx.gains.filter((g) => g !== tapNode && g !== (rig.feed as unknown as FakeGain) && feeds(g));
    expect(bus).toHaveLength(1);
    expect(bus[0]!.gain.value).toBe(1);
    const zero = ctx.gains.filter((g) => g.gain.value === 0 && g.outs.includes(ctx.destination));
    expect(zero).toHaveLength(1);
    expect(zero[0]!.outs).not.toContain(tapNode);
  });

  it('toneHz 0 builds no oscillator; setDelayMs moves the delay line', async () => {
    const { world, synth, be } = setup(25, { toneHz: 0 });
    open.push(() => world.contexts.forEach((c) => c.workletNodes.forEach((n) => n.closePorts())));
    await be.unlock();
    const ctx = world.ctx as Aug;
    expect(ctx.oscs).toHaveLength(0);
    expect(ctx.delays[0]!.delayTime.value).toBeCloseTo(0.025, 9);
    synth.setDelayMs(60);
    expect(synth.delayMs).toBe(60);
    expect(ctx.delays[0]!.delayTime.value).toBeCloseTo(0.06, 9);
  });

  it('injectClick schedules a click buffer into the delay line at time t', async () => {
    const { world, synth, be } = setup(60);
    open.push(() => world.contexts.forEach((c) => c.workletNodes.forEach((n) => n.closePorts())));
    await be.unlock();
    const ctx = world.ctx as Aug;
    synth.injectClick(1.25);
    const src = ctx.bufferSources[ctx.bufferSources.length - 1] as FakeBufferSource;
    expect(src.startedAt).toBe(1.25);
    expect(src.outs).toEqual([ctx.delays[0]]);
    expect((src.buffer as { getChannelData(c: number): Float32Array }).getChannelData(0).some((v) => v !== 0)).toBe(true);
  });

  it('getUserMedia before a context exists is an error naming the marker', async () => {
    const world = new FakeAudioWorld();
    const synth = createSyntheticCapture(world.deps, { delayMs: 25 });
    await expect(synth.deps.mediaDevices!.getUserMedia({ audio: {} })).rejects.toThrow(SYNTHETIC_CAPTURE_MARKER);
  });
});

describe('test-only flag', () => {
  it('parses ?synthCapture=<ms>', () => {
    expect(syntheticCaptureFlag('?synthCapture=60')).toEqual({ delayMs: 60 });
    expect(syntheticCaptureFlag('?a=1&synthCapture=25.5&b=2')).toEqual({ delayMs: 25.5 });
    expect(syntheticCaptureFlag('')).toBeNull();
    expect(syntheticCaptureFlag('?synthCapture=')).toBeNull();
    expect(syntheticCaptureFlag('?synthCapture=abc')).toBeNull();
    expect(syntheticCaptureFlag('?xsynthCapture=5')).toBeNull();
  });
});

describe('absent from the production bundle', () => {
  const root = process.cwd();
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };

  it('no non-test source file in src/ imports synthetic-capture', () => {
    const offenders = walk(join(root, 'src'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('synthetic-capture.ts'))
      .filter((f) => /synthetic-capture/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the marker is not in dist/ (checked when a build exists)', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return; // nothing built yet; the check runs after `pnpm build`
    const hits = walk(dist).filter((f) => /\.(js|mjs|html|css|map)$/.test(f) && readFileSync(f, 'utf8').includes(SYNTHETIC_CAPTURE_MARKER));
    expect(hits).toEqual([]);
  });
});
