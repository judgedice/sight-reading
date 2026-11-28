/**
 * Route identity on the native platform (docs/native/AUDIO-DESIGN.md section 4). The key is built from the OS device
 * ids, not labels, and from the granted buffer sizes, so it survives restarts and label changes and one measurement
 * lasts (PLAN R86). The shared `routeKeyOf` hashes it with the output mode, the engine rate and the OS family.
 */
import type { AudioRouteInfo, OsFamily, OutputMode } from '../../../core/platform.ts';
import { routeKeyOf } from '../../shared/audio/route.ts';
import type { LatencyReport, OpenInfo, RouteFacts, Transport } from './ipc.ts';

/** `inputKind` from the OS transport type; Bluetooth is known from the transport, never guessed from labels (R17). */
export function inputKindOfTransport(t: Transport): AudioRouteInfo['inputKind'] {
  switch (t) {
    case 'built-in':
      return 'built-in';
    case 'wired':
      return 'wired';
    case 'usb':
      return 'usb-interface';
    case 'bluetooth':
      return 'bluetooth';
    default:
      return 'unknown';
  }
}

/** `routeKeyOf(inputUid + '>' + outputUid + '@' + inFrames + '/' + outFrames, outputMode, engineRate, osFamily)`. */
export function nativeRouteKey(
  r: Pick<RouteFacts, 'inputUid' | 'outputUid'>,
  frames: { inFrames: number | null; outFrames: number },
  outputMode: OutputMode,
  engineRate: number,
  osFamily: OsFamily,
): string {
  return routeKeyOf(`${r.inputUid}>${r.outputUid}@${frames.inFrames ?? 0}/${frames.outFrames}`, outputMode, engineRate, osFamily);
}

/**
 * The seam's route record from the engine's facts. `reportedLatencySec` is the reported output latency when the trust
 * is A or B, absent for C and when the engine reports none.
 */
export function nativeAudioRoute(
  info: Pick<OpenInfo, 'engineRate' | 'outFrames' | 'inFrames' | 'inputRate'> & { route: RouteFacts; latency: LatencyReport },
  outputMode: OutputMode,
  osFamily: OsFamily,
): AudioRouteInfo {
  const key = nativeRouteKey(info.route, info, outputMode, info.engineRate, osFamily);
  const r: AudioRouteInfo = {
    routeKey: key,
    routeKeyAliases: [key],
    inputKind: inputKindOfTransport(info.route.inputTransport),
    outputMode,
    sampleRate: info.engineRate,
    appliedProcessing: { ...info.route.processing },
    trackSampleRate: info.inputRate,
  };
  if (info.latency.trust !== 'C' && info.latency.outputSec !== null && info.latency.outputSec > 0) r.reportedLatencySec = info.latency.outputSec;
  return r;
}
