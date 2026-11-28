// Worker thread of tools/native/gates-resampled.ts: runs gate jobs, the microphone signal going through the Rust
// resampler (the `resample_file` example of sr-audio-core) when the job names a route.
import { spawnSync } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import { runJob, type CaptureRoute, type Job } from '../../src/testkit/gates/index.ts';

export type RouteId = 'direct' | 'a' | 'b' | 'am' | 'bm';
export type ConvertedRouteId = Exclude<RouteId, 'direct'>;

/** Device rate of case b: a nominal 48 kHz input whose clock runs 200 ppm fast really samples at this rate. */
const RATE_B = 48000 * (1 + 200e-6);
/** Step of a device model that samples a signal at the fast clock: input frames per device frame, as ppm of nominal. */
const PPM_DEVICE_B = (1 / (1 + 200e-6) - 1) * 1e6;

interface Stage {
  inRate: number;
  outRate: number;
  ppm: number;
}

interface RouteSpec {
  description: string;
  /** Render and capture rate; null: the render as the direct run makes it (the "matched" cases). */
  deviceRateHz: number | null;
  /** The chain of `resample_file` runs for a signal captured at `rate` Hz (the render's own rate in matched cases). */
  stages(rate: number): Stage[];
}

/**
 * Four routes. `a` and `b` render each take at the device's own rate (the synthesis, phone-mic EQ, noise and click
 * bleed all run there) and convert once, as the capture path does. `am` and `bm` keep the direct render and pass it
 * through a model of the device (the same resampler, down to 44.1 kHz or onto the fast 48.0096 kHz clock) before the same
 * converter, so the signal is the direct run's signal and only the two conversions differ. That is the comparison
 * the 0.3 ms and 0.5 cent targets can be judged on: renders at another rate draw other noise and other attack shapes.
 */
export const ROUTES: Record<ConvertedRouteId, RouteSpec> = {
  a: { description: '44.1 kHz input, rendered at 44.1 kHz, one conversion to 48 kHz', deviceRateHz: 44100, stages: () => [{ inRate: 44100, outRate: 48000, ppm: 0 }] },
  b: { description: '48 kHz input +200 ppm, rendered at 48009.6 Hz, one conversion at step 1.0002', deviceRateHz: RATE_B, stages: () => [{ inRate: 48000, outRate: 48000, ppm: 200 }] },
  am: {
    description: 'direct render sampled by a 44.1 kHz device model, converted to 48 kHz',
    deviceRateHz: null,
    stages: (rate) => [
      { inRate: rate, outRate: 44100, ppm: 0 },
      { inRate: 44100, outRate: 48000, ppm: 0 },
    ],
  },
  bm: {
    description: 'direct render sampled by a +200 ppm device model, converted at step 1.0002',
    deviceRateHz: null,
    stages: (rate) => [
      { inRate: rate, outRate: rate, ppm: PPM_DEVICE_B },
      { inRate: rate, outRate: 48000, ppm: 200 },
    ],
  },
};

export function makeRoute(bin: string, id: ConvertedRouteId): CaptureRoute {
  const spec = ROUTES[id];
  const run = (st: Stage, input: Buffer): Buffer => {
    const a = ['--in-rate', String(st.inRate), '--out-rate', String(st.outRate), ...(st.ppm !== 0 ? ['--ppm', String(st.ppm)] : [])];
    const res = spawnSync(bin, a, { input, maxBuffer: 1 << 30 });
    if (res.status !== 0) throw new Error(`resample_file ${a.join(' ')} failed (${res.status}): ${res.stderr?.toString() ?? ''}${res.error ? String(res.error) : ''}`);
    return res.stdout;
  };
  return {
    deviceRateHz: spec.deviceRateHz,
    engineRateHz: 48000,
    convert(samples: Float32Array, rateHz: number): Float32Array {
      let buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
      for (const st of spec.stages(Math.round(rateHz))) buf = run(st, buf);
      // Copy: a Buffer's slice need not be 4-byte aligned.
      const y = new Float32Array(buf.length / 4);
      new Uint8Array(y.buffer).set(buf);
      return y;
    },
  };
}

if (parentPort) {
  const port = parentPort;
  const bin = (workerData as { bin: string }).bin;
  const routes = new Map<string, CaptureRoute>();
  port.on('message', (msg: { seq: number; job: Job; route: RouteId }) => {
    try {
      let route: CaptureRoute | undefined;
      if (msg.route !== 'direct') {
        route = routes.get(msg.route) ?? makeRoute(bin, msg.route);
        routes.set(msg.route, route);
      }
      port.postMessage({ seq: msg.seq, record: runJob(msg.job, route) });
    } catch (e) {
      port.postMessage({ seq: msg.seq, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
    }
  });
}
