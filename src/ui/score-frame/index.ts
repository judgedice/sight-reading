// ScoreFrame (D3): slots, page turns, freeze and scale, system numbers (04 §4.3, §4.4, §7.5).
export { ScoreFrame, type ScoreFrameProps } from './ScoreFrame.tsx';
export {
  ScoreFrameController,
  GUTTER_PX,
  contentBox,
  readInsets,
  type Arrangement,
  type Box,
  type FrameLayoutArgs,
  type FrameLayoutInfo,
  type FrozenResize,
  type ScoreFrameOptions,
} from './controller.ts';
export {
  bindNotation,
  documentAppearance,
  type FrameNotation,
  type FrameScoreView,
  type FrameViewOptions,
  type NotationModuleLike,
} from './notation-binding.ts';
export {
  beatMs,
  frozenScale,
  orientationChanged,
  slotsAtBeat,
  systemAtBeat,
  systemDurationsMs,
  systemSpans,
  timeSwaps,
  wrapSlot,
  type SystemSpan,
  type TimedSwap,
} from './turns.ts';
