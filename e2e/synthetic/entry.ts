// Page-side harness for IOS7 (synthetic capture) and the IOS2 browser check: the real WebAudioBackend and capture
// worklet, with getUserMedia replaced by the synthetic source and the interruption controller on top.
import type { MessagePortLike, PlatformCapabilities, WorkerMessage } from '../../src/core/platform.ts';
import { CaptureRecording, analyzeLoopback, randomClickTimes } from '../../src/calibration/index.ts';
import { createRng } from '../../src/core/rng.ts';
import type { ClickTimbre, ClockSeconds } from '../../src/core/platform.ts';
import budgetJson from '../../config/measurement-budget.json';
import { WebAudioBackend, browserAudioDeps } from '../../src/platform/web/audio/index.ts';
import { createSyntheticCapture, syntheticCaptureFlag, type SyntheticCapture } from '../../src/platform/web/audio/synthetic-capture.ts';
import { InterruptionController, type VoidAction } from '../../src/platform/web/ios/interruption-wiring.ts';

const budget = budgetJson.calibration;
const caps: PlatformCapabilities = {
  platform: 'web', outputLatencyReported: false, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'ios', displayMode: 'browser',
};
const blobUrl = (code: string): string => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** DSP-worker stand-in: checks seq contiguity and returns the pooled buffers (CaptureReturn). */
const WORKER_CODE = `
let port = null; const s = { blocks: 0, seqGaps: 0, lastSeq: -1, sumSq: 0 };
function onBlock(b, ret) {
  if (s.lastSeq >= 0 && b.seq !== s.lastSeq + 1) s.seqGaps++;
  s.lastSeq = b.seq; s.blocks++;
  for (let i = 0; i < b.lowband.length; i++) s.sumSq += b.lowband[i] * b.lowband[i];
  if (ret && port) port.postMessage({ v: 1, type: 'return', lowband: b.lowband.buffer, hiEnergy: b.hiEnergy.buffer }, [b.lowband.buffer, b.hiEnergy.buffer]);
}
onmessage = (e) => { const m = e.data;
  if (m.type === 'port') { port = m.port; port.onmessage = (ev) => { if (ev.data && ev.data.type === 'block') onBlock(ev.data.block, true); }; }
  else if (m.type === 'stats') postMessage(s); };
`;

let backend: WebAudioBackend | null = null;
let synth: SyntheticCapture | null = null;
let controller: InterruptionController | null = null;
const voids: VoidAction[] = [];
let unlocked: Promise<unknown> | null = null;

function make(o: { delayMs?: number; toneHz?: number; forceRelay?: boolean; search?: string } = {}): { flag: { delayMs: number } | null } {
  const flag = o.search !== undefined ? syntheticCaptureFlag(o.search) : null;
  const delayMs = o.delayMs ?? flag?.delayMs ?? 60;
  synth = createSyntheticCapture(browserAudioDeps(), { delayMs, ...(o.toneHz !== undefined ? { toneHz: o.toneHz } : {}) });
  const code = (window as unknown as { __workletCode: string }).__workletCode;
  backend = new WebAudioBackend({ capabilities: caps, workletUrl: blobUrl(code), deps: synth.deps, ...(o.forceRelay ? { forceRelay: true } : {}) });
  (document.getElementById('unlock') as HTMLButtonElement).onclick = () => {
    unlocked = (backend as WebAudioBackend).unlock().then((r) => ({ ok: true as const, route: r }), (e: unknown) => ({ ok: false as const, error: String(e) }));
  };
  return { flag };
}

async function waitUnlocked(): Promise<unknown> {
  for (let i = 0; i < 100 && !unlocked; i++) await sleep(20);
  return unlocked;
}

/** Contiguity over `sec` seconds: `port` runs the worker on the transferred port, `relay` the main-thread callback. */
async function contiguity(sec: number, mode: 'port' | 'relay'): Promise<{ blocks: number; seqGaps: number; relay: boolean; droppedBlocks: number; tone: boolean }> {
  const be = backend as WebAudioBackend;
  if (mode === 'port') {
    const worker = new Worker(blobUrl(WORKER_CODE));
    const ch = new MessageChannel();
    worker.postMessage({ type: 'port', port: ch.port2 }, [ch.port2]);
    await be.startCapture(ch.port1 as unknown as MessagePortLike);
    await sleep(sec * 1000);
    be.stopCapture();
    await sleep(200);
    const s = await new Promise<{ blocks: number; seqGaps: number; sumSq: number }>((res) => {
      worker.onmessage = (e: MessageEvent) => res(e.data as { blocks: number; seqGaps: number; sumSq: number });
      worker.postMessage({ type: 'stats' });
    });
    worker.terminate();
    return { blocks: s.blocks, seqGaps: s.seqGaps, relay: be.captureRelay, droppedBlocks: be.captureStats().droppedBlocks, tone: s.sumSq > 1 };
  }
  let last = -1;
  let gaps = 0;
  let blocks = 0;
  let sumSq = 0;
  await be.startCapture((m: WorkerMessage) => {
    if (m.type !== 'block') return;
    if (last >= 0 && m.block.seq !== last + 1) gaps++;
    last = m.block.seq;
    blocks++;
    for (const v of m.block.lowband) sumSq += v * v;
  });
  await sleep(sec * 1000);
  be.stopCapture();
  return { blocks, seqGaps: gaps, relay: be.captureRelay, droppedBlocks: be.captureStats().droppedBlocks, tone: sumSq > 1 };
}

/**
 * Loopback with the real calibration analysis (01 §7.8): play 10 clicks through the backend, capture them through
 * the synthetic delay line, and let `analyzeLoopback` measure the round trip. `sound` plays the clicks in that sound
 * and finds them by its own arrival envelope (06 §9.5); `templateSound` adds the calibration's template clicks in
 * that sound after the Tick clicks, as the calibration flow does, and reports the template it builds.
 */
async function loopback(o: { sound?: ClickTimbre; templateSound?: ClickTimbre } = {}): Promise<{ rtlMs: number | null; madMs: number | null; found: number; scheduled: number; accepted: boolean; failure: string | null; lagsMs: (number | null)[]; templates: Record<string, number> }> {
  const be = backend as WebAudioBackend;
  const rec = new CaptureRecording(be.audioInfo().contextSampleRate);
  await be.startCapture((m: WorkerMessage) => {
    if (m.type === 'block') rec.push(m.block);
  });
  await sleep(300);
  const rng = createRng(0x10);
  const sound = o.sound ?? 'tick';
  const n = budget.loopback.clicks + (o.templateSound ? budget.loopback.templateClicks : 0);
  const all = randomClickTimes(be.now() + 0.6, n, () => rng.next()) as ClockSeconds[];
  const times = all.slice(0, budget.loopback.clicks);
  const templateClicks = all.slice(budget.loopback.clicks);
  await be.playCalibrationClicks(times, sound);
  if (o.templateSound) await be.playCalibrationClicks(templateClicks, o.templateSound);
  while (be.now() < (all[all.length - 1] as number) + 0.5) await sleep(50);
  be.stopCapture();
  const r = analyzeLoopback(
    rec,
    { ticks: times, templateClicks, templateTimbre: o.templateSound ?? sound, clickTimbre: sound, silence: { t0: times[0]! - 0.25, t1: times[0]! - 0.05 } },
    budget,
  );
  const templates: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.templates)) if (v) templates[k] = v.samples.length;
  return { rtlMs: r.rtlMs, madMs: r.madMs, found: r.clicksFound, scheduled: r.clicksScheduled, accepted: r.accepted, failure: r.failure, lagsMs: r.arrivals.map((a) => (a.lagSec === null ? null : a.lagSec * 1000)), templates };
}

/** IOS2 in the browser: a take is "performing", the page goes hidden, and the controller must void and release the mic. */
async function interruptMidTake(): Promise<{ voids: VoidAction[]; liveTracksAfterMs: number[]; closedMs: number | null }> {
  const be = backend as WebAudioBackend;
  voids.length = 0;
  controller = new InterruptionController({
    audio: be,
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as number) },
    firstNotePlayed: () => true,
    sink: { onVoid: (a) => void voids.push(a), onStaleCalibration: () => undefined },
  });
  controller.start();
  await be.startCapture(() => undefined);
  controller.setSession('performing');
  const tracks = (synth as SyntheticCapture).rig()!.sink.stream.getAudioTracks();
  const t0 = performance.now();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  let closedMs: number | null = null;
  const samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const live = tracks.filter((t) => t.readyState === 'live').length;
    samples.push(live);
    if (live === 0 && closedMs === null) closedMs = performance.now() - t0;
    await sleep(200);
  }
  return { voids: [...voids], liveTracksAfterMs: samples, closedMs };
}

const api = { make, waitUnlocked, contiguity, loopback, interruptMidTake, info: () => backend?.audioInfo(), streams: () => synth?.streamsServed };
(window as unknown as { synthTest: typeof api }).synthTest = api;
