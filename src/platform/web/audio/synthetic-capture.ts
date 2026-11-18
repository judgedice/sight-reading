/**
 * Synthetic capture source for WebKit tests (05 IOS7, 01 P11). TEST-ONLY: nothing in the production graph may import
 * this module (see `synthetic-capture.test.ts`, which also greps `dist/` for `SYNTHETIC_CAPTURE_MARKER`).
 *
 * Playwright WebKit on Linux has no microphone. This replaces `getUserMedia` with a stream built inside the
 * backend's own `AudioContext`:
 *
 *   OscillatorNode (continuous tone)                 ------------------------> feed
 *   everything the backend plays (the click bus) -> tap -> DelayNode(d ms) --> feed
 *
 * and `feed` stands in for the MediaStreamSource (`createMediaStreamSource` on the proxied context returns it). A
 * real MediaStreamDestination round trip adds a variable 20 to 25 ms of browser buffering, which would swamp the
 * 1 ms loopback accuracy IOS7 needs, so the stream returned by `getUserMedia` carries only a live track (for
 * `ended` and `stop()` semantics) and no audio. The capture worklet, the zero-gain path, port and relay delivery
 * run for real, and the loopback sees every scheduled click d ms late, exactly. The tap sits on a proxied
 * `destination`: the backend connects its click bus and its zero-gain worklet output to the proxy, which feeds the
 * real destination and the delay line. A click can also be injected straight into the delay line with
 * `injectClick` (no output needed).
 *
 * Wiring (test pages only): `const s = createSyntheticCapture(browserAudioDeps(), { delayMs })` then
 * `new WebAudioBackend({ ..., deps: s.deps })`. The flag is `?synthCapture=<delay ms>` in the page URL
 * (`syntheticCaptureFlag`). The composition root must load this module by dynamic `import()` behind a build-time
 * constant that is false in the production build, so the bundler drops it.
 *
 * Limits: a W3 context recreation builds a new rig on the new context but the backend keeps the old stream; tests
 * run at a context rate the track agrees with, so no recreation happens.
 */
import type { AudioContextLike, AudioNodeLike, MediaDevicesLike, MediaStreamLike, WebAudioDeps } from './deps.ts';
import { renderClick } from './metronome.ts';

/** Unique string for the production-bundle grep (`dist/` must not contain it). */
export const SYNTHETIC_CAPTURE_MARKER = 'sr-synthetic-capture-test-only-7f3a';

export interface SyntheticCaptureOptions {
  /** Loopback delay d, milliseconds (IOS7 measures 25, 60 and 110). */
  delayMs: number;
  /** Continuous tone, Hz (default 440). 0 turns the tone off, which loopback measurements want. */
  toneHz?: number;
  /** Tone amplitude, linear (default 0.2). */
  toneGain?: number;
  /** Longest delay the line can be set to, ms (default 500). */
  maxDelayMs?: number;
  /** Label of the synthetic track (default 'Synthetic capture'). */
  label?: string;
}

interface ParamLike {
  value: number;
}
interface OutNode extends AudioNodeLike {
  connect(dest: AudioNodeLike): unknown;
}
interface OscLike extends OutNode {
  readonly frequency: ParamLike;
  type: string;
  start(when?: number): void;
  stop(when?: number): void;
}
interface DelayLike extends OutNode {
  readonly delayTime: ParamLike;
}
interface StreamDestLike extends OutNode {
  readonly stream: MediaStreamLike;
}
interface GainLike extends OutNode {
  readonly gain: ParamLike;
}

/** What a real `AudioContext` offers beyond `AudioContextLike`; the fakes in tests implement it too. */
export interface SyntheticContextLike extends AudioContextLike {
  createOscillator(): OscLike;
  createDelay(maxDelayTime: number): DelayLike;
  createMediaStreamDestination(): StreamDestLike;
}

/** One context's synthetic graph. */
export interface SyntheticRig {
  readonly ctx: SyntheticContextLike;
  readonly tone: OscLike | null;
  readonly delay: DelayLike;
  readonly tap: GainLike;
  /** Stands in for the MediaStreamSource. */
  readonly feed: GainLike;
  /** Source of the live track `getUserMedia` returns; carries no audio. */
  readonly sink: StreamDestLike;
}

export interface SyntheticCapture {
  /** The wrapped deps: pass to `WebAudioBackend`. */
  readonly deps: WebAudioDeps;
  readonly delayMs: number;
  /** Change d. */
  setDelayMs(ms: number): void;
  /** Schedule one click burst straight into the delay line at context time `t` (heard at `t + d`). */
  injectClick(t: number): void;
  /** `getUserMedia` calls served. */
  readonly streamsServed: number;
  /** The rig of the newest context, or null before `unlock()`. */
  rig(): SyntheticRig | null;
}

/** `?synthCapture=60` → `{ delayMs: 60 }`; absent or invalid → null. Takes a `location.search` string. */
export function syntheticCaptureFlag(search: string): { delayMs: number } | null {
  const m = /[?&]synthCapture=([0-9]+(?:\.[0-9]+)?)(?:&|$)/.exec(search);
  if (!m) return null;
  const d = Number(m[1]);
  return Number.isFinite(d) && d >= 0 ? { delayMs: d } : null;
}

export function createSyntheticCapture(base: WebAudioDeps, opts: SyntheticCaptureOptions): SyntheticCapture {
  let delayMs = opts.delayMs;
  let current: SyntheticRig | null = null;
  let served = 0;
  const maxDelaySec = (opts.maxDelayMs ?? 500) / 1000;
  const toneHz = opts.toneHz ?? 440;

  const build = (ctx: SyntheticContextLike): SyntheticRig => {
    const sink = ctx.createMediaStreamDestination();
    const delay = ctx.createDelay(maxDelaySec);
    delay.delayTime.value = delayMs / 1000;
    const feed = ctx.createGain() as unknown as GainLike;
    feed.gain.value = 1;
    delay.connect(feed);
    const tap = ctx.createGain() as unknown as GainLike;
    tap.gain.value = 1;
    tap.connect(ctx.destination);
    tap.connect(delay);
    let tone: OscLike | null = null;
    if (toneHz > 0) {
      tone = ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = toneHz;
      const g = ctx.createGain() as unknown as GainLike;
      g.gain.value = opts.toneGain ?? 0.2;
      tone.connect(g);
      g.connect(feed);
      tone.start();
    }
    return { ctx, tone, delay, tap, feed, sink };
  };

  const wrapContext = (real: AudioContextLike): AudioContextLike => {
    const ctx = real as SyntheticContextLike;
    const rig = build(ctx);
    current = rig;
    // The backend sees the tap as the destination; every other member is the real context's.
    const proxy = new Proxy(real, {
      get(target, prop) {
        if (prop === 'destination') return rig.tap;
        if (prop === 'createMediaStreamSource') return () => rig.feed;
        if (prop === 'createGain') {
          return () => {
            const g = target.createGain();
            // A silent gain wired to the tap (the capture worklet's zero-gain output) would close a cycle through
            // the delay line, and a DelayNode in a cycle is clamped to at least one render quantum. Send silent
            // outputs to the real destination instead; they carry nothing to loop back.
            const connect = g.connect.bind(g) as (d: AudioNodeLike) => unknown;
            g.connect = (d: AudioNodeLike) => connect(d === rig.tap && g.gain.value === 0 ? target.destination : d);
            return g;
          };
        }
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    proxies.set(proxy, real);
    return proxy;
  };

  // Calls that take the context as an argument (the worklet node constructor) need the real one.
  const proxies = new WeakMap<object, AudioContextLike>();
  const unwrap = (ctx: AudioContextLike): AudioContextLike => proxies.get(ctx) ?? ctx;

  const md: MediaDevicesLike = {
    addEventListener: (t, cb) => base.mediaDevices?.addEventListener(t, cb),
    removeEventListener: (t, cb) => base.mediaDevices?.removeEventListener(t, cb),
    getUserMedia: () => {
      if (!current) return Promise.reject(new Error(`${SYNTHETIC_CAPTURE_MARKER}: getUserMedia before a context exists`));
      served++;
      return Promise.resolve(current.sink.stream);
    },
  };

  const deps: WebAudioDeps = {
    ...base,
    createContext: (o) => wrapContext(base.createContext(o)),
    // The backend hands its (proxied) context back to createWorkletNode; the real node constructor needs the real one.
    createWorkletNode: (ctx, name, o) => base.createWorkletNode(unwrap(ctx), name, o),
    mediaDevices: md,
    permissions: { query: () => Promise.resolve({ state: 'granted' }) },
  };

  return {
    deps,
    get delayMs() {
      return delayMs;
    },
    setDelayMs(ms: number) {
      delayMs = ms;
      if (current) current.delay.delayTime.value = ms / 1000;
    },
    injectClick(t: number) {
      if (!current) throw new Error('injectClick before a context exists');
      const { ctx, delay } = current;
      const data = renderClick('tick', false, ctx.sampleRate);
      const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.getChannelData(0).set(data);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(delay);
      src.start(t);
    },
    get streamsServed() {
      return served;
    },
    rig: () => current,
  };
}
