/**
 * Select, load and prepare in one call (01 §6.3 steps 1 to 7, 03 §7.5). The manifest carries no pitches, so the
 * spelling rule (03 §7.5 rule 3) can only be checked once the doc is loaded. This helper loads the chosen doc,
 * caches it and runs the selector again with the cache: the selector then checks spelling exactly, retries a random
 * key enharmonically, and moves on to another (excerpt, key) when the spelling fails. Each round adds one doc to the
 * cache, so the loop ends after at most one round per manifest entry. The session (P16) should call this rather
 * than `selectExcerpt` + `prepareExcerpt` directly.
 */
import type { SelectExcerptResult } from '../../core/api.ts';
import type { Configs, CorpusManifest, ExcerptDoc, PracticeSettings, PreparedExcerpt, Rng, SelectionHistory, SelectionResult } from '../../core/types.ts';
import { prepareExcerpt, TranspositionError } from '../transpose/prepare.ts';
import { getInstrument } from './levels.ts';
import { selectExcerptWith } from './select.ts';

export type SelectAndPrepareResult =
  | { selection: SelectionResult; prepared: PreparedExcerpt; doc: ExcerptDoc }
  | Exclude<SelectExcerptResult, SelectionResult>;

export async function selectAndPrepare(
  m: CorpusManifest,
  s: PracticeSettings,
  h: SelectionHistory,
  cfg: Configs,
  rng: Rng,
  load: (id: string) => Promise<ExcerptDoc>,
  cache: Map<string, ExcerptDoc> = new Map(),
): Promise<SelectAndPrepareResult> {
  // Fix the seed once so every round makes the same draws, differing only by what the cached docs rule out.
  const fixed: PracticeSettings = { ...s, seed: s.seed ?? rng.int(0, 0x7fffffff) };
  const inst = getInstrument(cfg, s.instrumentId);
  const exclude = new Set<string>();
  for (let round = 0; round <= m.entries.length; round++) {
    const sel = selectExcerptWith(m, fixed, h, cfg, rng, { doc: (id) => cache.get(id), excludeIds: exclude });
    if ('error' in sel) return sel;
    const id = sel.entry.id;
    let doc = cache.get(id);
    if (!doc) {
      doc = await load(id);
      cache.set(id, doc);
      continue; // select again: the selector now sees this doc and checks it exactly
    }
    try {
      return { selection: sel, prepared: prepareExcerpt(doc, sel, inst, cfg), doc };
    } catch (e) {
      // The selector already checked spelling and tempo with the doc; a failure here means the doc and its manifest
      // entry disagree (for example on the range). Skip the excerpt rather than edit it.
      if (!(e instanceof TranspositionError)) throw e;
      exclude.add(id);
    }
  }
  throw new Error('selectAndPrepare did not converge');
}
