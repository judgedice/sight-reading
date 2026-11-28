/**
 * The native engine's command surface (docs/native/AUDIO-DESIGN.md section 3) and its Tauri implementation.
 *
 * `NativeIpc` is the seam the rest of `platform/native` talks to: one method per command, channels turned into
 * callbacks. `TauriNativeIpc` is the only code that imports `@tauri-apps/api`, so every other file (and every test,
 * through `FakeNativeIpc`) runs without it. Command arguments are flat objects with camelCase keys, as Tauri maps
 * them to the Rust parameter names; raw payloads (`audio_put_buffer`, `audio_decode`) are sent as bytes.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import type { OutputMode } from '../../../core/platform.ts';
import { encodeDecodeRequest, encodePutBuffer, parseDecodeReply } from './wire.ts';

export type VoiceGroup = 'take' | 'sounds';

/** One buffer voice (section 3). `env` holds at most 8 points; a step is two points at the same time. */
export interface VoiceSpec {
  /** Chosen by JS, unique per open. */
  id: number;
  buffer: number;
  /** Engine seconds of the first played sample. */
  t: number;
  /** Linear, applied before the envelope. */
  gain: number;
  /** Against the buffer's own sample rate (default 1). */
  rate?: number;
  /** Start position in the buffer, buffer seconds. */
  offsetSec?: number;
  /** Buffer seconds. */
  loop?: [number, number];
  /** `[engineSec, value]` linear segments; absent means constant 1. */
  env?: [number, number][];
  /** Engine seconds at which the voice is cut. */
  stopAt?: number;
}

export type Transport = 'built-in' | 'wired' | 'usb' | 'bluetooth' | 'hdmi' | 'network' | 'unknown';

export interface RouteFacts {
  inputUid: string;
  outputUid: string;
  inputTransport: Transport;
  outputTransport: Transport;
  processing: { echoCancellation: boolean | null; noiseSuppression: boolean | null; autoGainControl: boolean | null };
}

export type LatencyPart = 'outBuffer' | 'outDevice' | 'outSafety' | 'outStream' | 'inBuffer' | 'inDevice' | 'inSafety' | 'inStream';

export interface LatencyReport {
  outputSec: number | null;
  inputSec: number | null;
  trust: 'A' | 'B' | 'C';
  parts: Record<LatencyPart, number | null>;
}

/** Engine seconds per host second at `hostMs` (the engine's monotonic host clock, not `performance.now()`). */
export interface ClockAnchor {
  engineSec: number;
  hostMs: number;
  rate: number;
}

export interface OpenInfo {
  engineRate: number;
  outFrames: number;
  inFrames: number | null;
  inputRate: number | null;
  route: RouteFacts;
  latency: LatencyReport;
  clock: ClockAnchor;
  sessionType: string | null;
}

export interface ClockCheckReply {
  error: number | null;
  consistent: boolean;
  framesPerSec: number | null;
  expected: number;
  inputDriftPpm: number | null;
}

export interface LoopbackEstimate {
  found: number;
  scheduled: number;
  roundTripMs: number | null;
  madMs: number | null;
  snrDb: number | null;
  predictedMs: number | null;
}

export interface CaptureStartInfo {
  /** Engine frame of the first captured sample. */
  originFrame: number;
  engineRate: number;
  path: 'locked' | 'resampled';
}

export interface CaptureStopInfo {
  packets: number;
  frames: number;
  droppedFrames: number;
  maxRingMs: number;
}

/**
 * Events on the engine's channel. `late` and `rejected` are additions to the design: `late` lists voices found behind
 * the render head after `audio_schedule` returned, `rejected` lists voices the engine refused (64 sounding at most).
 */
export type AudioEvent =
  | { type: 'clock'; anchor: ClockAnchor }
  | { type: 'route'; route: RouteFacts; latency: LatencyReport; engineRate: number }
  | { type: 'interruption'; reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change' }
  | { type: 'ended'; ids: number[] }
  | { type: 'late'; ids: number[] }
  | { type: 'rejected'; ids: number[] }
  | { type: 'xrun'; stream: 'input' | 'output'; count: number };

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Every engine command. Methods reject with an `Error` carrying the engine's message. */
export interface NativeIpc {
  open(a: { input: boolean; outputMode: OutputMode; onEvent: (e: AudioEvent) => void }): Promise<OpenInfo>;
  close(): Promise<void>;
  releaseInput(): Promise<void>;
  permission(a: { request: boolean }): Promise<PermissionState>;
  clockSync(): Promise<{ engineSec: number; hostMs: number }>;
  clockCheck(a: { durSec: number }): Promise<ClockCheckReply>;
  /** Registers a mono buffer under `id` (raw payload). */
  putBuffer(a: { id: number; sampleRate: number; samples: Float32Array }): Promise<void>;
  /** Decodes an MP3 file in the engine, keeps the PCM under `id` and returns it (raw payload both ways). */
  decode(a: { id: number; file: ArrayBuffer }): Promise<{ sampleRate: number; samples: Float32Array }>;
  dropBuffers(a: { ids: number[] }): Promise<void>;
  schedule(a: { group: VoiceGroup; voices: VoiceSpec[] }): Promise<{ late: number[] }>;
  stopVoices(a: { ids: number[]; fadeSec: number }): Promise<void>;
  cancel(a: { group: VoiceGroup; fadeSec: number }): Promise<void>;
  /** Starts capture. Packets (`ArrayBuffer`, section 3 layout) arrive on `onPacket` until `captureStop`. */
  captureStart(a: { packetFrames: number; onPacket: (packet: ArrayBuffer) => void }): Promise<CaptureStartInfo>;
  captureStop(): Promise<CaptureStopInfo>;
  measureLoopback(a: { clicks: number; timbre: 'tick' }): Promise<LoopbackEstimate>;
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
}

async function call<T>(cmd: string, args?: Parameters<typeof invoke>[1]): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw asError(e);
  }
}

/** The Tauri implementation. A channel is registered with the webview's callback table by its constructor and lives until the engine drops it. */
export class TauriNativeIpc implements NativeIpc {
  open(a: { input: boolean; outputMode: OutputMode; onEvent: (e: AudioEvent) => void }): Promise<OpenInfo> {
    const events = new Channel<AudioEvent>(a.onEvent);
    return call<OpenInfo>('audio_open', { input: a.input, outputMode: a.outputMode, events });
  }

  async close(): Promise<void> {
    await call<void>('audio_close');
  }

  async releaseInput(): Promise<void> {
    await call<void>('audio_release_input');
  }

  permission(a: { request: boolean }): Promise<PermissionState> {
    return call<PermissionState>('audio_permission', { request: a.request });
  }

  clockSync(): Promise<{ engineSec: number; hostMs: number }> {
    return call('audio_clock_sync');
  }

  clockCheck(a: { durSec: number }): Promise<ClockCheckReply> {
    return call<ClockCheckReply>('audio_clock_check', { durSec: a.durSec });
  }

  async putBuffer(a: { id: number; sampleRate: number; samples: Float32Array }): Promise<void> {
    await call<void>('audio_put_buffer', encodePutBuffer(a.id, a.sampleRate, a.samples));
  }

  async decode(a: { id: number; file: ArrayBuffer }): Promise<{ sampleRate: number; samples: Float32Array }> {
    return parseDecodeReply(await call<ArrayBuffer>('audio_decode', encodeDecodeRequest(a.id, a.file)));
  }

  async dropBuffers(a: { ids: number[] }): Promise<void> {
    await call<void>('audio_drop_buffers', { ids: a.ids });
  }

  schedule(a: { group: VoiceGroup; voices: VoiceSpec[] }): Promise<{ late: number[] }> {
    return call('audio_schedule', { group: a.group, voices: a.voices });
  }

  async stopVoices(a: { ids: number[]; fadeSec: number }): Promise<void> {
    await call<void>('audio_stop_voices', { ids: a.ids, fadeSec: a.fadeSec });
  }

  async cancel(a: { group: VoiceGroup; fadeSec: number }): Promise<void> {
    await call<void>('audio_cancel', { group: a.group, fadeSec: a.fadeSec });
  }

  captureStart(a: { packetFrames: number; onPacket: (packet: ArrayBuffer) => void }): Promise<CaptureStartInfo> {
    const packets = new Channel<ArrayBuffer>(a.onPacket);
    return call<CaptureStartInfo>('audio_capture_start', { packets, packetFrames: a.packetFrames });
  }

  async captureStop(): Promise<CaptureStopInfo> {
    return call<CaptureStopInfo>('audio_capture_stop');
  }

  measureLoopback(a: { clicks: number; timbre: 'tick' }): Promise<LoopbackEstimate> {
    return call<LoopbackEstimate>('audio_measure_loopback', { clicks: a.clicks, timbre: a.timbre });
  }
}
