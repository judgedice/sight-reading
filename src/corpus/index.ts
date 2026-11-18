/**
 * Corpus module barrel (01 §5.5). Loading (P9a) and the level tagger (G2) are here; P9b adds selectExcerpt,
 * prepareExcerpt and countEligible, and P9c adds buildExpectedNotes, to this file.
 */
export { loadManifest, loadExcerpt, prefetchNeighbours, CorpusLoadError, type CorpusLoadErrorCode } from './load/index.ts';
export { tagLevels, rhythmLevel, cellLevel, meterBeatTicks, FEATURE_KEYS, type TaggerInput, type TaggerResult } from './tagger/index.ts';
