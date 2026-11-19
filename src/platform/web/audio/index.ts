/** Web audio backend (P11). The composition root imports `WebAudioBackend` and `CAPTURE_WORKLET_URL`. */
export { WebAudioBackend, DEFAULT_CAPTURE_BUDGET } from './web-audio-backend.ts';
export type { CaptureBudget, CaptureFault, CaptureStats, ClockRateCheck, InterruptionReason, WebAudioBackendOptions } from './web-audio-backend.ts';
export { browserAudioDeps } from './deps.ts';
export type { WebAudioDeps } from './deps.ts';
export { Metronome, planTakeClicks, renderClick, takeT0, MIN_LEAD_SEC } from './metronome.ts';
export { ListenVoiceCache, LISTEN_BUS_GAIN, LISTEN_BUS_DBFS, listenEnvelope, renderListenNote, tuneHz } from './listen-voice.ts';
export { CAPTURE_PROCESSOR_NAME, FRAMES_PER_BLOCK, isCaptureReturn } from './protocol.ts';
export type { CaptureReturn } from './protocol.ts';
export { routeKeyOf, inputKindOf, appliedProcessingOf } from './route.ts';
