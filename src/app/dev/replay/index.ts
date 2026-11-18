// P20 dev replay (01 §13.6). `replayOverrides` replaces the `dev.replay` placeholder when the composition root passes it
// to createRouteTable.
import type { ScreenOverrides } from '../../routes.tsx';
import { DevReplayScreen } from './replay-screen.tsx';

export { DevReplayScreen } from './replay-screen.tsx';
export { buildDiagnosticsExport, diagnosticsJson, findAudio, DIAGNOSTICS_FORMAT, type DiagnosticsExport } from './diagnostics.ts';
export { attemptTimeline, checkAttemptReplay, liveOf, replayTimeline, type ReplayState, type TimedEvent } from './reduce.ts';
export { parseReplaySource, pitchPoints, ReplayParseError, type PitchPoint, type RenderHeader, type ReplaySource } from './source.ts';

/** Route overrides for createRouteTable: replaces the dev replay placeholder. */
export const replayOverrides: ScreenOverrides = { 'dev.replay': DevReplayScreen };
