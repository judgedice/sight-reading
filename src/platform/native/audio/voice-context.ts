/**
 * `NativeVoiceContext` (docs/native/AUDIO-DESIGN.md section 4): the part of the Web Audio surface that the unchanged
 * `Metronome` (`ClickContext`) and `Sampler` (`SamplerContext`, `Decoder`) use, implemented on the engine's one
 * primitive, a sample-accurate buffer voice. The shared code keeps deciding what to play; this file turns each
 * `createBufferSource()` ... `start()` into one `VoiceSpec`.
 *
 * - Buffers: `createBuffer` and `decodeAudioData` make `NativeBuffer`s. A buffer is registered with the engine
 *   (`audio_put_buffer`) the first time a voice needs it, and again after the engine was reopened (the engine forgets
 *   its buffers on `audio_close`). Decoded buffers already live in the engine (`audio_decode` stores them).
 * - Voices: `start()` queues a voice; every voice queued in the same task goes out as one `audio_schedule`, after
 *   the buffers they need are in. `flush()` resolves when that call has returned.
 * - Gain: a source connected to a gain node with automation takes the node's events as the voice envelope (a
 *   piecewise-linear point list, a step is two points at the same time). Gain nodes without automation multiply the
 *   voice gain by their `value`. The engine holds 8 envelope points and 64 sounding voices; a voice that needs more
 *   is refused with a `NativeVoiceError`, never truncated.
 * - Stopping: `stop(when)` on a queued voice edits the voice (cut time, or cancel before it starts). On a voice the
 *   engine already has, a stop within `MAX_CUT_SEC` is `audio_stop_voices` with that fade (the sampler's note cut);
 *   a later time cannot be expressed after scheduling and is refused.
 * - Groups: a context belongs to one group (`take` or `sounds`); `cancelGroup` is `audio_cancel` for it.
 */
import type { ClickBuffer, ClickSource } from '../../shared/audio/metronome.ts';
import type { DecodedBuffer, SamplerGain, SamplerParam, SamplerSource } from '../../shared/audio/sampler.ts';
import type { NativeIpc, VoiceGroup, VoiceSpec } from './ipc.ts';

/** Envelope points one engine voice holds. */
export const MAX_ENV_POINTS = 8;
/** Voices the engine sounds at once. */
export const MAX_SOUNDING_VOICES = 64;
/** The longest `stop` after scheduling that is treated as a cut with a fade (the sampler cuts over 15 ms). */
export const MAX_CUT_SEC = 0.1;

/** A voice the engine cannot hold, or a Web Audio call this adapter cannot express. */
export class NativeVoiceError extends Error {
  constructor(message: string) {
    super(`NativeVoiceContext: ${message}`);
    this.name = 'NativeVoiceError';
  }
}

// ---- buffers ------------------------------------------------------------------------------------------

export class NativeBuffer implements ClickBuffer, DecodedBuffer {
  readonly id: number;
  readonly sampleRate: number;
  readonly data: Float32Array;
  /** Dropped from the engine when its last voice ends (tones and other one-off buffers). */
  readonly ephemeral: boolean;
  /** The engine generation this buffer is registered in; -1 when it is not. */
  uploadedGen = -1;
  uploading: Promise<void> | null = null;
  /** Voices queued or sounding on this buffer. */
  liveVoices = 0;

  constructor(id: number, sampleRate: number, data: Float32Array, ephemeral: boolean) {
    this.id = id;
    this.sampleRate = sampleRate;
    this.data = data;
    this.ephemeral = ephemeral;
  }

  get length(): number {
    return this.data.length;
  }

  get duration(): number {
    return this.data.length / this.sampleRate;
  }

  getChannelData(_channel = 0): Float32Array {
    return this.data;
  }
}

// ---- gain automation ----------------------------------------------------------------------------------

type GainEvent = { kind: 'set' | 'ramp'; v: number; t: number };

/**
 * The gain events as a piecewise-linear point list. Before the first event the value is the first point's; a set
 * after the last point holds the last value up to its time, then steps (two points at the same time). A ramp with no
 * earlier event starts at `startT` from `initial`.
 */
export function gainPoints(events: readonly GainEvent[], initial: number, startT: number): [number, number][] {
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  const pts: [number, number][] = [];
  for (const ev of sorted) {
    const last = pts[pts.length - 1];
    if (ev.kind === 'ramp') {
      if (!last) pts.push([startT, initial]);
      pts.push([ev.t, ev.v]);
    } else if (!last) {
      pts.push([ev.t, ev.v]);
    } else {
      if (ev.t > last[0]) pts.push([ev.t, last[1]]);
      if ((pts[pts.length - 1] as [number, number])[1] !== ev.v) pts.push([ev.t, ev.v]);
    }
  }
  return pts;
}

function valueOnPoints(pts: readonly [number, number][], t: number, fallback: number): number {
  const first = pts[0];
  if (!first) return fallback;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number];
    const b = pts[i] as [number, number];
    if (t < b[0]) return a[0] === b[0] ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
  }
  return (pts[pts.length - 1] as [number, number])[1];
}

class NativeParam implements SamplerParam {
  private intrinsic = 1;
  readonly events: GainEvent[] = [];
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  get value(): number {
    if (this.events.length === 0) return this.intrinsic;
    const t = this.now();
    return valueOnPoints(gainPoints(this.events, this.intrinsic, t), t, this.intrinsic);
  }

  set value(v: number) {
    this.intrinsic = v;
    if (this.events.length > 0) this.setValueAtTime(v, this.now());
  }

  get initial(): number {
    return this.intrinsic;
  }

  setValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'set', v, t });
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): this {
    this.events.push({ kind: 'ramp', v, t });
    return this;
  }

  cancelScheduledValues(t: number): this {
    for (let i = this.events.length - 1; i >= 0; i--) if ((this.events[i] as GainEvent).t >= t) this.events.splice(i, 1);
    return this;
  }
}

export class NativeGain implements SamplerGain {
  readonly gain: NativeParam;
  /** Where this node's output goes, when that is another gain node. */
  next: NativeGain | null = null;

  constructor(now: () => number) {
    this.gain = new NativeParam(now);
  }

  connect(dest: unknown): unknown {
    this.next = dest instanceof NativeGain ? dest : null;
    return dest;
  }

  disconnect(): void {
    this.next = null;
  }
}

// ---- sources ------------------------------------------------------------------------------------------

type SourceState = 'idle' | 'queued' | 'sent' | 'ended';

export class NativeSource implements ClickSource, SamplerSource {
  buffer: NativeBuffer | null = null;
  readonly playbackRate = { value: 1 };
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;

  /** @internal */ state: SourceState = 'idle';
  /** @internal */ id = 0;
  /** @internal */ startAt = 0;
  /** @internal */ offset = 0;
  /** @internal */ stopAt: number | undefined = undefined;
  /** @internal */ generation = 0;
  /** Set by the context while the source is tracked; called when it ends. @internal */
  release: (() => void) | null = null;
  private gainNode: NativeGain | null = null;
  private readonly ctx: NativeVoiceContext;

  constructor(ctx: NativeVoiceContext) {
    this.ctx = ctx;
  }

  connect(dest: unknown): unknown {
    this.gainNode = dest instanceof NativeGain ? dest : null;
    return dest;
  }

  disconnect(): void {
    this.gainNode = null;
  }

  start(when: number, offset = 0): void {
    if (this.state !== 'idle') throw new NativeVoiceError('start() called twice');
    if (!(this.buffer instanceof NativeBuffer)) throw new NativeVoiceError('the source needs a buffer made by this context');
    this.startAt = when;
    this.offset = offset;
    this.ctx.enqueue(this);
  }

  stop(when?: number): void {
    const w = when ?? 0;
    switch (this.state) {
      case 'idle':
        throw new NativeVoiceError('stop() before start()');
      case 'queued':
        // The last call wins, as in Web Audio.
        this.stopAt = w;
        if (w <= this.startAt) this.ctx.dropQueued(this);
        break;
      case 'sent':
        this.ctx.stopSent(this, w);
        break;
      case 'ended':
        break;
    }
  }

  /** The voice for the engine: the gain chain folded into `gain` and `env`. @internal */
  toSpec(): VoiceSpec {
    const buf = this.buffer as NativeBuffer;
    let gain = 1;
    let env: [number, number][] | undefined;
    for (let n = this.gainNode; n; n = n.next) {
      if (n.gain.events.length > 0) {
        if (env) throw new NativeVoiceError('two gain nodes with automation in one chain');
        env = gainPoints(n.gain.events, n.gain.initial, this.startAt);
        if (env.length > MAX_ENV_POINTS) throw new NativeVoiceError(`the gain envelope needs ${env.length} points; the engine voice holds ${MAX_ENV_POINTS}`);
      } else gain *= n.gain.value;
    }
    const spec: VoiceSpec = { id: this.id, buffer: buf.id, t: this.startAt, gain };
    const rate = this.playbackRate.value;
    if (rate !== 1) spec.rate = rate;
    if (this.offset > 0) spec.offsetSec = this.offset;
    if (this.loop) spec.loop = [this.loopStart, this.loopEnd];
    if (env && env.length > 0) spec.env = env;
    if (this.stopAt !== undefined && this.stopAt > 0) spec.stopAt = this.stopAt;
    return spec;
  }
}

// ---- host and context ---------------------------------------------------------------------------------

export interface VoiceHostStats {
  /** Voices the engine started behind the render head. */
  late: number;
  /** Voices the engine refused. */
  rejected: number;
  /** Voices sent to the engine (`audio_schedule` voices). */
  voices: number;
  /** Voices the engine reported ended (ran out, stopped or cancelled). */
  ended: number;
  /** Buffers registered with `audio_put_buffer`. */
  uploads: number;
  /** `audio_schedule` calls. */
  scheduleCalls: number;
}

/** Everything the contexts of one backend share: ids, buffers, the engine generation, live voices. */
export class NativeVoiceHost {
  readonly ipc: NativeIpc;
  readonly stats: VoiceHostStats = { late: 0, rejected: 0, voices: 0, ended: 0, uploads: 0, scheduleCalls: 0 };
  /** Bumped when the engine is opened or closed: buffers and voices of an older generation are gone. */
  generation = 0;
  engineRate = 48000;
  private readonly clockNow: () => number;
  private nextBufferId = 1;
  private nextVoiceId = 1;
  private readonly byData = new WeakMap<Float32Array, NativeBuffer>();
  private readonly live = new Map<number, NativeSource>();
  /** The engine-time span each sent voice may sound in (its end is infinite while looping without a stop). */
  private readonly sounding = new Map<number, { from: number; to: number }>();
  private readonly toDrop: number[] = [];
  private dropScheduled = false;
  /** The group each sent voice belongs to, until it ends. */
  private readonly groupOf = new Map<number, VoiceGroup>();
  /** Called with the ids of voices the engine started late, grouped (a late `take` click voids the take). */
  onLate: ((ids: readonly number[], group: VoiceGroup | null) => void) | null = null;

  constructor(ipc: NativeIpc, clockNow: () => number) {
    this.ipc = ipc;
    this.clockNow = clockNow;
  }

  now(): number {
    return this.clockNow();
  }

  /** The engine was opened or closed: forget voices and registrations (the engine did). */
  newGeneration(engineRate?: number): void {
    this.generation++;
    if (engineRate !== undefined) this.engineRate = engineRate;
    this.live.clear();
    this.sounding.clear();
    this.toDrop.length = 0;
    this.nextVoiceId = 1;
  }

  voiceId(): number {
    return this.nextVoiceId++;
  }

  newBuffer(data: Float32Array, sampleRate: number, ephemeral = false): NativeBuffer {
    return new NativeBuffer(this.nextBufferId++, sampleRate, data, ephemeral);
  }

  /** The buffer of `data` (made once per array, so a cached rendering is registered once). */
  bufferFor(data: Float32Array, sampleRate: number, ephemeral = false): NativeBuffer {
    let b = this.byData.get(data);
    if (!b || b.ephemeral !== ephemeral) {
      b = this.newBuffer(data, sampleRate, ephemeral);
      this.byData.set(data, b);
    }
    return b;
  }

  /** Registers the buffer with the engine unless it is already there. */
  ensureUploaded(b: NativeBuffer): Promise<void> {
    if (b.uploadedGen === this.generation) return Promise.resolve();
    if (b.uploading) return b.uploading;
    const gen = this.generation;
    this.stats.uploads++;
    const p = this.ipc
      .putBuffer({ id: b.id, sampleRate: b.sampleRate, samples: b.data })
      .then(() => {
        if (gen === this.generation) b.uploadedGen = gen;
      })
      .finally(() => {
        b.uploading = null;
      });
    b.uploading = p;
    return p;
  }

  /** Decodes a file in the engine; the buffer is registered there already. */
  async decode(file: ArrayBuffer): Promise<NativeBuffer> {
    const gen = this.generation;
    const id = this.nextBufferId++;
    const r = await this.ipc.decode({ id, file });
    const b = new NativeBuffer(id, r.sampleRate, r.samples, false);
    if (gen === this.generation) b.uploadedGen = gen;
    return b;
  }

  /** Peak number of voices sounding at once among the sent ones and `extra` (engine seconds intervals). */
  peakOverlap(extra: readonly { from: number; to: number }[]): number {
    const now = this.now();
    const iv = [...extra];
    for (const [id, span] of this.sounding) {
      if (span.to < now) this.sounding.delete(id);
      else iv.push(span);
    }
    const ev: [number, number][] = [];
    for (const i of iv) ev.push([i.from, 1], [i.to, -1]);
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let peak = 0;
    for (const [, d] of ev) {
      cur += d;
      if (cur > peak) peak = cur;
    }
    return peak;
  }

  markSent(s: NativeSource, span: { from: number; to: number }, group: VoiceGroup): void {
    this.groupOf.set(s.id, group);
    this.live.set(s.id, s);
    this.sounding.set(s.id, span);
  }

  /** The engine's `ended` for `ids`: the sources report it. */
  voicesEnded(ids: readonly number[]): void {
    for (const id of ids) {
      const s = this.live.get(id);
      this.live.delete(id);
      this.groupOf.delete(id);
      this.sounding.delete(id);
      if (!s || s.state === 'ended') continue;
      this.stats.ended++;
      this.finish(s, true);
    }
  }

  voicesLate(ids: readonly number[]): void {
    this.stats.late += ids.length;
    if (!this.onLate) return;
    for (const group of ['take', 'sounds', null] as const) {
      const of = ids.filter((id) => (this.groupOf.get(id) ?? null) === group);
      if (of.length > 0) this.onLate(of, group);
    }
  }

  voicesRejected(ids: readonly number[]): void {
    this.stats.rejected += ids.length;
  }

  /** Marks a source ended; its buffer is dropped once nothing plays it (one-off buffers). */
  finish(s: NativeSource, fire: boolean): void {
    if (s.state === 'ended') return;
    s.state = 'ended';
    this.live.delete(s.id);
    this.sounding.delete(s.id);
    const b = s.buffer;
    if (b) {
      b.liveVoices--;
      if (b.ephemeral && b.liveVoices <= 0 && b.uploadedGen === this.generation) {
        b.uploadedGen = -1;
        this.toDrop.push(b.id);
        this.scheduleDrop();
      }
    }
    s.release?.();
    if (fire) s.onended?.();
  }

  private scheduleDrop(): void {
    if (this.dropScheduled) return;
    this.dropScheduled = true;
    queueMicrotask(() => {
      this.dropScheduled = false;
      const ids = this.toDrop.splice(0);
      if (ids.length > 0) void this.ipc.dropBuffers({ ids }).catch(() => undefined);
    });
  }
}

export class NativeVoiceContext {
  readonly group: VoiceGroup;
  private readonly host: NativeVoiceHost;
  private queue: NativeSource[] = [];
  private flushScheduled = false;
  /** Batches go out in order: the tail never rejects, so a refused batch does not hold back the next. */
  private tail: Promise<void> = Promise.resolve();
  /** The latest batch's send until it settles (what `flush` hands to callers). */
  private inflight: Promise<void> | null = null;
  private stops = new Map<number, number[]>();
  private stopScheduled = false;
  private readonly sources = new Set<NativeSource>();

  constructor(host: NativeVoiceHost, group: VoiceGroup) {
    this.host = host;
    this.group = group;
  }

  get sampleRate(): number {
    return this.host.engineRate;
  }

  get currentTime(): number {
    return this.host.now();
  }

  createBuffer(channels: number, length: number, sampleRate: number): NativeBuffer {
    if (channels !== 1) throw new NativeVoiceError('buffers are mono');
    return this.host.newBuffer(new Float32Array(length), sampleRate);
  }

  /** The buffer for a rendered Float32Array (registered once per array); `ephemeral` ones are dropped when played out. */
  bufferFor(data: Float32Array, sampleRate: number = this.sampleRate, ephemeral = false): NativeBuffer {
    return this.host.bufferFor(data, sampleRate, ephemeral);
  }

  createBufferSource(): NativeSource {
    return new NativeSource(this);
  }

  createGain(): NativeGain {
    return new NativeGain(() => this.host.now());
  }

  async decodeAudioData(data: ArrayBuffer): Promise<NativeBuffer> {
    return this.host.decode(data);
  }

  /** Resolves when every voice started so far has been handed to the engine (or refused). */
  flush(): Promise<void> {
    this.runFlush();
    return this.inflight ?? Promise.resolve();
  }

  /** @internal */
  enqueue(s: NativeSource): void {
    s.state = 'queued';
    s.id = this.host.voiceId();
    s.generation = this.host.generation;
    (s.buffer as NativeBuffer).liveVoices++;
    this.queue.push(s);
    this.sources.add(s);
    s.release = () => this.sources.delete(s);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.runFlush());
    }
  }

  /** A queued voice that is cancelled before it starts never reaches the engine. @internal */
  dropQueued(s: NativeSource): void {
    const i = this.queue.indexOf(s);
    if (i >= 0) this.queue.splice(i, 1);
    this.host.finish(s, false);
    queueMicrotask(() => s.onended?.());
  }

  /** `stop(when)` on a voice the engine has: a short cut becomes `audio_stop_voices`. @internal */
  stopSent(s: NativeSource, when: number): void {
    const fade = Math.max(0, when - this.host.now());
    if (fade > MAX_CUT_SEC) throw new NativeVoiceError(`a voice already scheduled cannot be stopped ${fade.toFixed(3)} s ahead (only cuts within ${MAX_CUT_SEC} s)`);
    const key = Math.round(fade * 1e6);
    const ids = this.stops.get(key) ?? [];
    ids.push(s.id);
    this.stops.set(key, ids);
    if (!this.stopScheduled) {
      this.stopScheduled = true;
      queueMicrotask(() => {
        this.stopScheduled = false;
        const batches = [...this.stops];
        this.stops = new Map();
        for (const [k, list] of batches) void this.host.ipc.stopVoices({ ids: list, fadeSec: k / 1e6 }).catch(() => undefined);
      });
    }
  }

  /**
   * `audio_cancel` for this group: voices not yet started never sound, sounding ones fade over `fadeSec`. Sources
   * are marked ended without calling their `onended` (the caller is cancelling them).
   */
  cancelGroup(fadeSec = 0.005): Promise<void> {
    this.cancelGroupLocal();
    return this.host.ipc.cancel({ group: this.group, fadeSec }).catch(() => undefined);
  }

  /** Forgets every source without telling the engine (it is closing or was replaced). */
  cancelGroupLocal(): void {
    this.queue = [];
    for (const s of [...this.sources]) this.host.finish(s, false);
    this.sources.clear();
    this.stops.clear();
  }

  private runFlush(): void {
    this.flushScheduled = false;
    const batch = this.queue;
    if (batch.length === 0) return;
    this.queue = [];
    const p = this.tail.then(() => this.send(batch));
    this.tail = p.catch(() => undefined);
    this.inflight = p;
    const settled = (): void => {
      if (this.inflight === p) this.inflight = null;
    };
    p.then(settled, settled);
  }

  private async send(batch: NativeSource[]): Promise<void> {
    const gen = this.host.generation;
    const live = batch.filter((s) => s.state === 'queued' && s.generation === gen);
    if (live.length === 0) return;
    try {
      await Promise.all([...new Set(live.map((s) => s.buffer as NativeBuffer))].map((b) => this.host.ensureUploaded(b)));
      if (gen !== this.host.generation) return;
      // Voices stopped while the buffers uploaded are not sent; the others are read now, so a late edit counts.
      const sendable = live.filter((s) => s.state === 'queued');
      if (sendable.length === 0) return;
      const specs = sendable.map((s) => s.toSpec());
      const spans = sendable.map((s, k) => ({ from: specs[k]!.t, to: this.endOf(s, specs[k]!) }));
      const peak = this.host.peakOverlap(spans);
      if (peak > MAX_SOUNDING_VOICES) throw new NativeVoiceError(`${peak} voices would sound at once; the engine holds ${MAX_SOUNDING_VOICES}`);
      sendable.forEach((s, k) => {
        s.state = 'sent';
        this.host.markSent(s, spans[k]!, this.group);
      });
      this.host.stats.scheduleCalls++;
      this.host.stats.voices += specs.length;
      const r = await this.host.ipc.schedule({ group: this.group, voices: specs });
      if (r.late.length > 0) this.host.voicesLate(r.late);
    } catch (e) {
      for (const s of live) if (s.state !== 'ended') this.host.finish(s, false);
      throw e;
    }
  }

  /** Engine time at which a voice stops sounding at the latest. */
  private endOf(s: NativeSource, spec: VoiceSpec): number {
    const stop = spec.stopAt ?? Infinity;
    if (spec.loop) return stop;
    const buf = s.buffer as NativeBuffer;
    const rate = spec.rate ?? 1;
    const natural = spec.t + Math.max(0, buf.duration - (spec.offsetSec ?? 0)) / rate;
    return Math.min(stop, natural);
  }
}
