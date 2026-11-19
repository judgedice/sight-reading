// Page-side harness for the audio specs: the real WebAudioBackend and capture worklet in Chromium, a DSP-worker
// stand-in that checks block contiguity and returns pooled buffers (the CaptureReturn protocol), and a tap
// worklet on the click bus that timestamps each click's first sample on the audio clock.
import type { CaptureBlock, MessagePortLike, PlatformCapabilities, TakeSchedule, WorkerMessage } from '../../src/core/platform.ts';
import { WebAudioBackend } from '../../src/platform/web/audio/index.ts';

const caps: PlatformCapabilities = {
  platform: 'web', outputLatencyReported: true, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser',
};

const blobUrl = (code: string): string => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));

/** The DSP-worker stand-in. Checks seq and startT contiguity, measures level and pitch, returns buffers. */
const WORKER_CODE = `
let port = null;
const s = { blocks: 0, seqGaps: 0, maxStartErr: 0, firstSeq: -1, lastSeq: -1, nextT: null, sumSq: 0, samples: 0, crossings: 0, prev: 0,
  analysisRate: 0, firstT: null, lastEnd: null, lens: {} };
function onBlock(b, ret) {
  if (s.firstSeq < 0) s.firstSeq = b.seq;
  if (s.lastSeq >= 0 && b.seq !== s.lastSeq + 1) s.seqGaps++;
  if (s.nextT !== null) s.maxStartErr = Math.max(s.maxStartErr, Math.abs(b.startT - s.nextT));
  s.lastSeq = b.seq;
  s.analysisRate = b.analysisRate;
  if (s.firstT === null) s.firstT = b.startT;
  s.nextT = b.startT + b.lowband.length / b.analysisRate;
  s.lastEnd = s.nextT;
  s.lens[b.lowband.length] = (s.lens[b.lowband.length] || 0) + 1;
  const x = b.lowband;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    s.sumSq += v * v;
    if ((s.prev < 0) !== (v < 0)) s.crossings++;
    s.prev = v;
  }
  s.samples += x.length;
  s.blocks++;
  if (ret && port) port.postMessage({ v: 1, type: 'return', lowband: b.lowband.buffer, hiEnergy: b.hiEnergy.buffer }, [b.lowband.buffer, b.hiEnergy.buffer]);
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'port') { port = m.port; const ret = m.returns; port.onmessage = (ev) => { if (ev.data && ev.data.type === 'block') onBlock(ev.data.block, ret); }; }
  else if (m.type === 'block') onBlock(m.block, false);
  else if (m.type === 'stats') postMessage(s);
};
`;

/** Click onset detector on the click bus: the first sample above a tiny threshold after 5 ms of silence. */
const TAP_CODE = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.silent = 1e9; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) { this.silent += 128; return true; }
    for (let i = 0; i < x.length; i++) {
      if (Math.abs(x[i]) > 1e-5) {
        if (this.silent > sampleRate * 0.005) this.port.postMessage(currentFrame + i);
        this.silent = 0;
      } else this.silent++;
    }
    return true;
  }
}
registerProcessor('sr-test-tap', Tap);
`;

interface WorkerStats {
  blocks: number;
  seqGaps: number;
  maxStartErr: number;
  firstSeq: number;
  lastSeq: number;
  sumSq: number;
  samples: number;
  crossings: number;
  analysisRate: number;
  firstT: number | null;
  lastEnd: number | null;
  lens: Record<string, number>;
}

let backend: WebAudioBackend | null = null;
let unlocked: Promise<unknown> | null = null;

function make(opts: { forceRelay?: boolean } = {}): void {
  const code = (window as unknown as { __workletCode: string }).__workletCode;
  backend = new WebAudioBackend({ capabilities: caps, workletUrl: blobUrl(code), ...(opts.forceRelay ? { forceRelay: true } : {}) });
  const btn = document.getElementById('unlock') as HTMLButtonElement;
  btn.onclick = () => {
    // The gesture handler: unlock() runs its synchronous part (context + resume) right here.
    unlocked = (backend as WebAudioBackend).unlock().then(
      (r) => ({ ok: true as const, route: r }),
      (e: unknown) => ({ ok: false as const, error: String(e) }),
    );
  };
}

async function waitUnlocked(): Promise<unknown> {
  for (let i = 0; i < 100 && !unlocked; i++) await new Promise((r) => setTimeout(r, 20));
  return unlocked;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Capture for `sec` seconds into the worker stand-in; `mode` picks the delivery path. */
async function capture(sec: number, mode: 'port' | 'port-no-return' | 'callback'): Promise<{ stats: WorkerStats; relay: boolean; backend: ReturnType<WebAudioBackend['captureStats']>; contextRate: number; wallSec: number; ctxSec: number }> {
  const be = backend as WebAudioBackend;
  const worker = new Worker(blobUrl(WORKER_CODE));
  const ch = new MessageChannel();
  worker.postMessage({ type: 'port', port: ch.port2, returns: mode === 'port' }, [ch.port2]);
  const t0Wall = performance.now();
  const t0Ctx = be.now();
  if (mode === 'callback') {
    await be.startCapture((m: WorkerMessage) => {
      if (m.type !== 'block') return;
      const b: CaptureBlock = m.block;
      worker.postMessage({ type: 'block', block: b }, [b.lowband.buffer, b.hiEnergy.buffer]);
    });
  } else {
    await be.startCapture(ch.port1 as unknown as MessagePortLike);
  }
  await sleep(sec * 1000);
  be.stopCapture();
  await sleep(300);
  const stats = await new Promise<WorkerStats>((resolve) => {
    worker.onmessage = (e: MessageEvent) => resolve(e.data as WorkerStats);
    worker.postMessage({ type: 'stats' });
  });
  worker.terminate();
  return {
    stats,
    relay: be.captureRelay,
    backend: be.captureStats(),
    contextRate: be.audioInfo().contextSampleRate,
    wallSec: (performance.now() - t0Wall) / 1000,
    ctxSec: be.now() - t0Ctx,
  };
}

/** Schedule a take, stall the main thread for 200 ms mid-take, and measure every click's first sample. */
async function clicksUnderStall(): Promise<{ scheduled: number[]; heard: number[]; t0: number; rate: number; stalledMs: number }> {
  const be = backend as WebAudioBackend;
  const bus = be.clickOutput() as unknown as AudioNode;
  const ctx = bus.context as AudioContext;
  await ctx.audioWorklet.addModule(blobUrl(TAP_CODE));
  const tap = new AudioWorkletNode(ctx, 'sr-test-tap');
  const zero = ctx.createGain();
  zero.gain.value = 0;
  bus.connect(tap);
  tap.connect(zero);
  zero.connect(ctx.destination);
  const heardFrames: number[] = [];
  tap.port.onmessage = (e: MessageEvent) => heardFrames.push(e.data as number);
  const p: TakeSchedule = { leadSec: 0.5, bpm: 240, beatsPerBar: 4, countInBeats: 4, totalBeats: 8, mode: 'audible', timbre: 'tick', accentDb: 5 };
  const { t0, clicks } = await be.scheduleTake(p);
  // Stall the main thread for 200 ms while the count-in is playing.
  await sleep(700);
  const s = performance.now();
  while (performance.now() - s < 200) {
    // busy
  }
  const stalledMs = performance.now() - s;
  const last = clicks[clicks.length - 1]!.t;
  while (be.now() < last + 0.3) await sleep(50);
  return { scheduled: clicks.map((c) => c.t), heard: heardFrames.map((f) => f / ctx.sampleRate), t0, rate: ctx.sampleRate, stalledMs };
}

async function clockRate(): Promise<unknown> {
  return (backend as WebAudioBackend).checkClockRate();
}

/**
 * The clock-rate check with the main thread busy: long tasks of 20 to 80 ms with 0 to 30 ms gaps for the whole
 * check (a dev build rendering), optionally right after the context was recreated and with a relayed capture
 * running (blocks through the main thread, as on the owner's machine).
 */
async function clockRateBusy(o: { recreate?: boolean; relay?: boolean } = {}): Promise<unknown> {
  const be = backend as WebAudioBackend;
  if (o.recreate) await (be as unknown as { recreateContext(rate: number | null): Promise<void> }).recreateContext(null);
  let relayed = 0;
  if (o.relay) await be.startCapture(() => void relayed++);
  let stop = false;
  let busyMs = 0;
  const tick = (): void => {
    if (stop) return;
    const s = performance.now();
    const len = 20 + Math.random() * 60;
    while (performance.now() - s < len) {
      // busy
    }
    busyMs += performance.now() - s;
    setTimeout(tick, Math.random() * 30);
  };
  setTimeout(tick, 0);
  const t0 = performance.now();
  const r = await be.checkClockRate();
  stop = true;
  const wallMs = performance.now() - t0;
  if (o.relay) be.stopCapture();
  return { ...r, busyShare: busyMs / wallMs, wallMs, relayed };
}

function interruptions(): string[] {
  const got: string[] = [];
  (backend as WebAudioBackend).onInterruption((r) => got.push(r));
  return got;
}

const api = { make, waitUnlocked, capture, clicksUnderStall, clockRate, clockRateBusy, interruptions, info: () => backend?.audioInfo(), close: () => backend?.close() };
(window as unknown as { audioTest: typeof api }).audioTest = api;
