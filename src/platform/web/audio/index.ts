/** Web audio backend (P11). The composition root imports `WebAudioBackend` and `CAPTURE_WORKLET_URL`. */
export { WebAudioBackend, DEFAULT_CAPTURE_BUDGET } from './web-audio-backend.ts';
export type { CaptureBudget, CaptureFault, CaptureStats, ClockRateCheck, InterruptionReason, WebAudioBackendOptions } from './web-audio-backend.ts';
export { browserAudioDeps } from './deps.ts';
export type { WebAudioDeps } from './deps.ts';
export { Metronome, planTakeClicks, renderClick, takeT0, MIN_LEAD_SEC } from '../../shared/audio/metronome.ts';
export { ListenVoiceCache, LISTEN_BUS_GAIN, LISTEN_BUS_DBFS, listenEnvelope, renderListenNote, tuneHz } from '../../shared/audio/listen-voice.ts';
export { CAPTURE_PROCESSOR_NAME, FRAMES_PER_BLOCK, isCaptureReturn } from '../../shared/audio/protocol.ts';
export type { CaptureReturn } from '../../shared/audio/protocol.ts';
export { routeKeyOf, inputKindOf, appliedProcessingOf } from '../../shared/audio/route.ts';
export { Sampler, SAMPLE_GAIN, isSamplerContext, loopPoints, midiOfHz, onsetAlignment, onsetSec, pickSample, playbackRateFor, playSampledNotes, startSampleNote } from '../../shared/audio/sampler.ts';
export type { Decoder, FetchLike, LoadedSet, SoundLoadState } from '../../shared/audio/sampler.ts';
export { parseSoundManifest } from '../../shared/audio/sample-manifest.ts';
export type { SampleDef, SetDef, SoundManifest } from '../../shared/audio/sample-manifest.ts';
