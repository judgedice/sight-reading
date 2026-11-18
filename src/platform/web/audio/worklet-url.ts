/**
 * URL of the bundled capture worklet for the Vite build (the composition root passes it to `WebAudioBackend`).
 * Vite bundles `capture.worklet.ts` and its dsp imports into one self-contained file; `?worker&url` returns its
 * relative URL, so it works under any base path (05 §5.3 item 7).
 */
import captureWorkletUrl from './capture.worklet.ts?worker&url';

export const CAPTURE_WORKLET_URL: string = captureWorkletUrl;
