/**
 * Creates the DSP worker (01 §3: `new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' })`). Vite
 * bundles the worker and its dsp/follow/rules imports into its own chunk with a relative URL (any base path).
 */
import type { WorkerLike } from '../../../core/platform.ts';

export function createDspWorker(): WorkerLike {
  return new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module', name: 'sr-dsp' }) as unknown as WorkerLike;
}
