/**
 * Messages between the main thread, the capture worklet and the DSP worker (01 §7.2). These are internal
 * to the web backend except `CaptureReturn`, which the DSP worker posts back on the capture port so the
 * worklet can reuse its pooled buffers (zero allocation after warm-up).
 *
 * Capture port protocol (worklet <-> DSP worker, a `MessagePort` the session hands to `startCapture`):
 *   worklet -> worker: `WorkerMessage` `{ v: 1, type: 'block', block }`, with `block.lowband.buffer` and
 *                      `block.hiEnergy.buffer` transferred.
 *   worker -> worklet: `CaptureReturn` with both buffers transferred back once the worker has copied or
 *                      consumed the samples. The first return proves the port path works end to end; until
 *                      then the worklet posts freshly allocated copies, and if no return arrives within
 *                      `relayFallbackMs` the backend switches to the main-thread relay.
 */
import type { CaptureBlock, CaptureReturn } from '../../../core/platform.ts';

/** The registered AudioWorkletProcessor name. */
export const CAPTURE_PROCESSOR_NAME = 'sr-capture';

/** Input frames per capture post: 2 render quanta (01 §7.2). */
export const FRAMES_PER_BLOCK = 256;

/** Worker -> worklet on the capture port: give the block's buffers back to the pool (defined in core/platform.ts). */
export type { CaptureReturn } from '../../../core/platform.ts';

/** Main -> worklet, on `node.port`. */
export type ToWorklet =
  | {
      type: 'start';
      /** The DSP worker's capture port, or null in relay mode. */
      port: MessagePort | null;
      relay: boolean;
      poolSize: number;
      /** Post a `stats` message every this many blocks. */
      statsEvery: number;
    }
  | { type: 'stop' }
  /** Leave the port path: the worklet sends the port back (`port-back`) and posts blocks on `node.port`. */
  | { type: 'relay' }
  /** Relay mode: buffers handed back by the main thread. */
  | { type: 'return'; lowband: ArrayBuffer; hiEnergy: ArrayBuffer }
  /** Clock-rate check (01 §7.8): reply with the latest clock stamp and the input-presence counters. */
  | { type: 'clock'; id: number };

/** Worklet -> main, on `node.port`. */
export type FromWorklet =
  /** Capture began; `originFrame` is the context frame of the first captured input sample. */
  | { type: 'started'; originFrame: number; analysisRate: number }
  /** Relay mode: one block, buffers transferred to the main thread. */
  | { type: 'block'; block: CaptureBlock }
  /** The DSP worker returned a buffer: the port path works. */
  | { type: 'port-ok' }
  /** Reply to `relay`: the capture port handed back (null if the worklet never received it). */
  | { type: 'port-back'; port: MessagePort | null }
  /** Pool state: `outstanding` buffer pairs are with the worker (port mode) or the main thread (relay). */
  | { type: 'stats'; posted: number; dropped: number; outstanding: number; maxOutstanding: number }
  /** The pool was empty and block `seq` was dropped (a capture gap). */
  | { type: 'drop'; seq: number; dropped: number }
  /**
   * Reply to `clock`. `frame` and `wallMs` were read together in the first quantum of the latest render burst
   * (`currentFrame`, `Date.now()` in the worklet), so the pair is exact whenever the reply arrives; -1 before the
   * first quantum. The counters are cumulative render quanta: all, those with no input channels, and those whose
   * input was all exact zeros.
   */
  | { type: 'clock'; id: number; frame: number; wallMs: number; quanta: number; missingInput: number; silentInput: number };

export function isCaptureReturn(m: unknown): m is CaptureReturn {
  if (typeof m !== 'object' || m === null) return false;
  const r = m as Partial<CaptureReturn>;
  return r.type === 'return' && r.lowband instanceof ArrayBuffer && r.hiEnergy instanceof ArrayBuffer;
}
