/** Failures of corpus loading (01 §6.2, 03 §6.13). `code` lets the caller tell them apart. */
export type CorpusLoadErrorCode =
  /** A corpus file has a wrong schema version, or its contents do not agree with each other. */
  | 'malformed'
  /** `loadExcerpt` was given an id that is not in the manifest. */
  | 'unknown-id'
  /** The id is in `withdrawn.json`. It is never returned, even when a cached chunk still holds it. */
  | 'withdrawn'
  /** The injected fetch failed for a corpus file. */
  | 'fetch-failed';

export class CorpusLoadError extends Error {
  readonly code: CorpusLoadErrorCode;

  constructor(code: CorpusLoadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CorpusLoadError';
    this.code = code;
  }
}
