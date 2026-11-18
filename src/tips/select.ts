/**
 * `selectTips` (02 §6.1 items 4 to 6; P13). Pure and deterministic: the same input always gives the same tips, and the
 * input is never mutated. `detectPatterns` has already applied the pattern-level gates (enabled, instrument
 * restriction, beta exclusions, evidence bars, incomplete attempts, signal quality); this module applies the tip-level
 * rules: thresholds, at most two tips, family over universal, assertsCause history, recency, levels, conditions.
 */
import type { TipsApi } from '../core/api.ts';
import type { Instrument, PatternDef, PatternResult, Tip, TipCatalog, TipDef, TipSelectionInput } from '../core/types.ts';
import { evidenceLine, fillTipText } from './text.ts';

/** Catalog-derived lookups, built once per catalog object. */
interface CatalogIndex {
  defs: Map<string, PatternDef>;
  order: Map<string, number>;
  tipsByPattern: Map<string, TipDef[]>;
}

const indexes = new WeakMap<TipCatalog, CatalogIndex>();

function indexOf(catalog: TipCatalog): CatalogIndex {
  const cached = indexes.get(catalog);
  if (cached) return cached;
  const defs = new Map<string, PatternDef>();
  const order = new Map<string, number>();
  catalog.patterns.forEach((d, k) => {
    if (!defs.has(d.id)) defs.set(d.id, d);
    if (!order.has(d.id)) order.set(d.id, k);
  });
  const tipsByPattern = new Map<string, TipDef[]>();
  for (const t of catalog.tips) {
    for (const pid of t.patterns) {
      const list = tipsByPattern.get(pid);
      if (list) list.push(t);
      else tipsByPattern.set(pid, [t]);
    }
  }
  const idx: CatalogIndex = { defs, order, tipsByPattern };
  indexes.set(catalog, idx);
  return idx;
}

/** Family tips apply to the instrument's family, narrowed by `instruments` when present. */
function familyApplies(t: TipDef, inst: Instrument): boolean {
  if (t.family === undefined || t.family !== inst.family) return false;
  return !t.instruments || t.instruments.includes(inst.id);
}

/** Trigger conditions (for example SX04's "bflat-involved") are carried by the detector as params set to 1. */
function conditionMet(t: TipDef, p: PatternResult): boolean {
  if (t.condition === undefined) return true;
  return (p.params?.[t.condition] ?? 0) > 0;
}

export const selectTips: TipsApi['selectTips'] = (i: TipSelectionInput): Tip[] => {
  const cat = i.catalog;
  const sel = cat.selection;
  const idx = indexOf(cat);
  const beta = i.instrument.status === 'beta';
  const recentTips = new Set(i.recentTipIds.slice(0, sel.skipRecent));

  // Pattern-level eligibility for tips, with the first occurrence of each id kept.
  const eligible = new Map<string, PatternResult>();
  for (const p of i.patterns) {
    if (eligible.has(p.id)) continue;
    const def = idx.defs.get(p.id);
    if (!def || !def.enabled) continue;
    if (def.instruments && !def.instruments.includes(i.instrument.id)) continue;
    if (beta && sel.betaDisabledPatterns.includes(p.id)) continue;
    if (p.id !== sel.cleanReadPatternId) {
      const bars = new Set(p.bars).size;
      if (!sel.evidenceBarsExempt.includes(p.id) && bars < sel.minEvidenceBars) continue;
    }
    eligible.set(p.id, p);
  }

  const cleanId = sel.cleanReadPatternId;
  const real = [...eligible.values()]
    .filter((p) => p.id !== cleanId)
    .sort((a, b) => b.lostPoints - a.lostPoints || idx.order.get(a.id)! - idx.order.get(b.id)!);

  /** assertsCause tips need the pattern primary in `minPrimary` of the last `ofLast` attempts (02 §6.1 item 5). */
  const historyOk = (patternId: string): boolean => {
    const { minPrimary, ofLast } = sel.assertsCause;
    return i.recentPrimaries.slice(0, ofLast).filter((x) => x === patternId).length >= minPrimary;
  };

  /**
   * The tip to show for one pattern: a family tip before a universal one, a family tip only when its cause history
   * holds, and never a tip shown in the last `skipRecent` tips or already chosen in this call.
   */
  const tipFor = (p: PatternResult, chosen: ReadonlySet<string>): Tip | null => {
    const def = idx.defs.get(p.id)!;
    const candidates = (idx.tipsByPattern.get(p.id) ?? []).filter(
      (t) => t.enabled && i.level >= t.minLevel && i.level <= t.maxLevel && conditionMet(t, p),
    );
    const family = beta
      ? []
      : candidates.filter((t) => t.scope === 'family' && familyApplies(t, i.instrument) && (!t.assertsCause || historyOk(p.id)));
    const universal = candidates.filter((t) => t.scope === 'universal');
    for (const t of [...family, ...universal]) {
      if (recentTips.has(t.id) || chosen.has(t.id)) continue;
      const text = fillTipText(t.text, p.params);
      if (text === null) continue;
      return { id: t.id, patternId: p.id, text, evidence: evidenceLine(p, def, cat), bars: [...p.bars].sort((a, b) => a - b), primary: false };
    }
    return null;
  };

  const picks: Tip[] = [];
  let primaryPattern: string | null = null;
  for (const p of real) {
    if (p.lostPoints < sel.primaryMinLostPoints) break;
    const t = tipFor(p, new Set());
    if (t) {
      picks.push({ ...t, primary: true });
      primaryPattern = p.id;
      break;
    }
  }
  for (const p of real) {
    if (picks.length >= sel.maxTips) break;
    if (p.lostPoints < sel.secondaryMinLostPoints) break;
    if (p.id === primaryPattern) continue;
    const t = tipFor(p, new Set(picks.map((x) => x.id)));
    if (t) picks.push({ ...t, primary: false });
  }

  // Clean-read fallback (02 §6.1 item 4): the positive tip when nothing else is shown.
  const clean = eligible.get(cleanId);
  if (picks.length === 0 && clean) {
    const t = tipFor(clean, new Set());
    if (t) picks.push({ ...t, primary: true });
  }

  return picks.slice(0, sel.maxTips);
};
