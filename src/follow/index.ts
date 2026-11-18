/**
 * `follow/` public surface (01 §5.7). P10a: the live follower, the shared cost function and the displacement
 * detector. P10b adds `finalAlign` (and the `FollowApi` conformance object) here.
 */
export { LiveFollower, type LiveFollowerOptions } from './live-follower.ts';
export * from './cost.ts';
export {
  DisplacementDetector,
  DISPLACEMENT_COST_RATIO,
  DISPLACEMENT_MAX_AHEAD_BARS,
  DISPLACEMENT_MAX_BACK_BARS,
  DISPLACEMENT_MIN_MATCHES,
  DISPLACEMENT_WINDOW_NOTES,
  type DisplacementHit,
  type WindowFit,
  type WindowNote,
} from './displacement.ts';
export { ghostPitch, inferWrittenKey } from './ghost-spelling.ts';
