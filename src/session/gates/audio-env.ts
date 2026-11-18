/** `AudioEnv` builder (05 W5, §5.2): plain facts in, complete JSON record out. */
import type { PlatformCapabilities } from '../../core/platform.ts';
import type {
  AudioEnv,
  AudioRouteInfo,
  Calibration,
  ClickTimbre,
  DspStats,
  GateId,
  MetronomeMode,
} from '../../core/types.ts';

export interface AudioEnvFacts {
  capabilities: Pick<PlatformCapabilities, 'platform' | 'osFamily' | 'displayMode'>;
  appBuild: string;
  coreVersion: string;
  metronomeMode: MetronomeMode;
  clickTimbre: ClickTimbre;
  route: AudioRouteInfo;
  /** `AudioBackend.audioInfo()`. */
  audio: { contextSampleRate: number; contextRecreated: boolean; audioSessionType: string | null; clockRateError: number | null };
  captureRelay: boolean;
  /** Calibration used for the take, or null/undefined when none. */
  calibration: Pick<Calibration, 'method'> | null | undefined;
  /** What follow/ subtracted, ms. */
  latencyCompensationMs: number;
  dsp: Pick<DspStats, 'droppedBlocks' | 'maxQueueMs' | 'hopP95Ms'>;
  gateFailures: readonly GateId[];
}

export function buildAudioEnv(f: AudioEnvFacts): AudioEnv {
  const { inputKind, sampleRate, appliedProcessing: a } = f.route;
  return {
    platform: f.capabilities.platform,
    osFamily: f.capabilities.osFamily,
    displayMode: f.capabilities.displayMode,
    appBuild: f.appBuild,
    coreVersion: f.coreVersion,
    inputPath: 'mic',
    metronomeMode: f.metronomeMode,
    clickTimbre: f.clickTimbre,
    outputMode: f.route.outputMode,
    route: {
      inputKind,
      sampleRate,
      appliedProcessing: {
        echoCancellation: a.echoCancellation,
        noiseSuppression: a.noiseSuppression,
        autoGainControl: a.autoGainControl,
      },
    },
    contextSampleRate: f.audio.contextSampleRate,
    contextRecreated: f.audio.contextRecreated,
    clockRateError: f.audio.clockRateError,
    audioSessionType: f.audio.audioSessionType,
    latencyCompensationMs: f.latencyCompensationMs,
    calibrationMethod: f.calibration?.method ?? 'none',
    captureRelay: f.captureRelay,
    droppedBlocks: f.dsp.droppedBlocks,
    maxQueueMs: f.dsp.maxQueueMs,
    dspHopP95Ms: f.dsp.hopP95Ms,
    gateFailures: [...f.gateFailures],
  };
}
