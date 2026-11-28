/**
 * The browser surface `WebAudioBackend` touches, as narrow structural interfaces, so tests can run the backend
 * against a scripted fake. `browserAudioDeps()` binds them to the real globals; it is the only place in this
 * folder that reads `AudioContext`, `AudioWorkletNode`, `navigator.*`, `document` or `performance`.
 */
import type { ClickBuffer, ClickSource } from '../../shared/audio/metronome.ts';
import type { TrackSettingsLike } from '../../shared/audio/route.ts';

export interface EventTargetLike {
  addEventListener(type: string, cb: (ev: unknown) => void): void;
  removeEventListener(type: string, cb: (ev: unknown) => void): void;
}

export interface AudioParamLike {
  value: number;
}

export interface AudioNodeLike {
  connect(dest: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface MessagePortHost {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

export interface WorkletNodeLike extends AudioNodeLike {
  readonly port: MessagePortHost;
}

export interface BufferSourceLike extends ClickSource {
  connect(dest: AudioNodeLike): unknown;
}

export interface AudioContextLike extends EventTargetLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly state: string;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  readonly destination: AudioNodeLike;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike;
  createGain(): GainNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): ClickBuffer;
  createBufferSource(): BufferSourceLike;
}

export interface TrackLike extends EventTargetLike {
  readonly label: string;
  readonly readyState: string;
  readonly muted?: boolean;
  getSettings(): TrackSettingsLike;
  stop(): void;
}

export interface MediaStreamLike {
  getAudioTracks(): TrackLike[];
}

export interface MediaDevicesLike extends EventTargetLike {
  getUserMedia(c: { audio: Record<string, unknown> }): Promise<MediaStreamLike>;
}

export interface DocumentLike extends EventTargetLike {
  readonly visibilityState: string;
}

export interface WebAudioDeps {
  createContext(opts: { latencyHint: 'interactive'; sampleRate?: number }): AudioContextLike;
  createWorkletNode(ctx: AudioContextLike, name: string, opts: AudioWorkletNodeOptions): WorkletNodeLike;
  mediaDevices: MediaDevicesLike | undefined;
  /** `navigator.audioSession` where present (Safari 16.4+). */
  audioSession: { type: string } | undefined;
  permissions: { query(d: { name: string }): Promise<{ state: string }> } | undefined;
  document: DocumentLike | undefined;
  window: EventTargetLike | undefined;
  /** Wall clock in ms (`performance.now()`), for the clock-rate check and `getOutputTimestamp`. */
  wallNowMs(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Real browser bindings. Call once, in the composition root or the backend's constructor. */
export function browserAudioDeps(): WebAudioDeps {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const session = nav ? (nav as unknown as { audioSession?: { type: string } }).audioSession : undefined;
  return {
    createContext: (opts) => new AudioContext(opts) as unknown as AudioContextLike,
    createWorkletNode: (ctx, name, opts) => new AudioWorkletNode(ctx as unknown as BaseAudioContext, name, opts) as unknown as WorkletNodeLike,
    mediaDevices: nav?.mediaDevices as unknown as MediaDevicesLike | undefined,
    audioSession: session,
    permissions: nav?.permissions as unknown as WebAudioDeps['permissions'],
    document: typeof document === 'undefined' ? undefined : (document as unknown as DocumentLike),
    window: typeof window === 'undefined' ? undefined : (window as unknown as EventTargetLike),
    wallNowMs: () => performance.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
