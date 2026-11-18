/**
 * Corpus module barrel (01 §5.5). Loading (P9a), the level tagger (G2), selection and transposition (P9b) are here;
 * P9c adds buildExpectedNotes to this file.
 */
export { loadManifest, loadExcerpt, prefetchNeighbours, CorpusLoadError, type CorpusLoadErrorCode } from './load/index.ts';
export { tagLevels, rhythmLevel, cellLevel, meterBeatTicks, FEATURE_KEYS, type TaggerInput, type TaggerResult } from './tagger/index.ts';
export {
  selectExcerpt,
  selectExcerptWith,
  selectAndPrepare,
  countEligible,
  type SelectOptions,
  type SelectAndPrepareResult,
} from './select/index.ts';
export { prepareExcerpt, TranspositionError, fitsInKey, type TranspositionErrorCode } from './transpose/index.ts';
