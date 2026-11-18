/**
 * Select, load and prepare in one call (01 §6.3 steps 1 to 7, 03 §7.5). The manifest carries the spelling and
 * peak-density columns (PLAN ruling 44), so the selector decides eligibility exactly and the chosen doc is loaded
 * once. `prepareExcerpt` can still throw `TranspositionError` when a doc and its manifest entry disagree (a corrupt
 * or stale corpus); that excerpt is then skipped and the selector runs again without it. The session (P16) may call
 * this or `selectExcerpt` + `loadExcerpt` + `prepareExcerpt` directly.
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
  // Fix the seed once so a retry makes the same draws, differing only by the excluded excerpts.
  const fixed: PracticeSettings = { ...s, seed: s.seed ?? rng.int(0, 0x7fffffff) };
  const inst = getInstrument(cfg, s.instrumentId);
  const exclude = new Set<string>();
  for (let round = 0; round <= m.entries.length; round++) {
    const sel = selectExcerptWith(m, fixed, h, cfg, rng, { excludeIds: exclude });
    if ('error' in sel) return sel;
    const id = sel.entry.id;
    let doc = cache.get(id);
    if (!doc) {
      doc = await load(id);
      cache.set(id, doc);
    }
    try {
      return { selection: sel, prepared: prepareExcerpt(doc, sel, inst, cfg), doc };
    } catch (e) {
      // The doc disagrees with its manifest entry (range, spelling or tempo). Skip it rather than edit it.
      if (!(e instanceof TranspositionError)) throw e;
      exclude.add(id);
    }
  }
  throw new Error('selectAndPrepare did not converge');
}
