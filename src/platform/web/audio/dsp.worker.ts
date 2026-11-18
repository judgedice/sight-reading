/**
 * DSP worker entry (01 §3 bundling, §5.2, §7.2). Load it with `createDspWorker()` (dsp-worker-factory.ts):
 * `new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' })`. The logic lives in
 * `dsp-worker-core.ts`; this file only binds it to the worker global and the capture port.
 *
 * The capture port is the first transferred port of any message on the worker port (the session sends it with
 * 'config', or earlier). Blocks on it are answered with `CaptureReturn`s on the same port.
 */
import type { CaptureReturn, WorkerMessage, WorkerReply } from '../../../core/platform.ts';
import { DspWorkerCore } from './dsp-worker-core.ts';

interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

const core = new DspWorkerCore({
  post: (reply: WorkerReply, transfer?: ArrayBuffer[]) => scope.postMessage(reply, transfer ?? []),
  nowMs: () => performance.now(),
  setTimer: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
});

let capturePort: MessagePort | null = null;

function adoptPort(port: MessagePort): void {
  if (capturePort === port) return;
  capturePort = port;
  core.setCapturePort({
    postMessage: (m: CaptureReturn, transfer: ArrayBuffer[]) => port.postMessage(m, transfer),
  });
  port.onmessage = (ev: MessageEvent) => core.onCaptureMessage(ev.data);
}

scope.onmessage = (ev: MessageEvent) => {
  const port = ev.ports[0];
  if (port) adoptPort(port);
  const m = ev.data as WorkerMessage | null;
  if (m && typeof m === 'object' && m.v === 1) core.onMessage(m);
};
