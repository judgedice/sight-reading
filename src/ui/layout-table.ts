// Score layout rows, system geometry, slots and page turns (04 sections 4.1 to 4.3). Pure data and functions.

import type { RenderOptions } from '../core/types.ts';

export type LayoutRowId = 'xl' | 'lg' | 'md-land' | 'md-port' | 'sm-short' | 'xs';
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface LayoutRow {
  id: LayoutRowId;
  /** Bars per system for 'fixed' rows; xl uses 'half' (ceil(N / 2), max 6; ceil(N / 3) when dense). */
  perSystem: number | 'half';
  /** Preferred staff space, px (the table's "sp (min)" value). */
  spPx: number;
  /** Smallest sp the row may step down to when fewer than 2 slots fit. */
  spMinPx: number;
  toolbarPx: number;
  statusLinePx: number;
}

/** 4.2, in match order. */
export const LAYOUT_ROWS: readonly LayoutRow[] = [
  { id: 'xl', perSystem: 'half', spPx: 11, spMinPx: 11, toolbarPx: 56, statusLinePx: 28 },
  { id: 'lg', perSystem: 4, spPx: 10, spMinPx: 10, toolbarPx: 56, statusLinePx: 28 },
  { id: 'md-land', perSystem: 4, spPx: 9, spMinPx: 9, toolbarPx: 56, statusLinePx: 28 },
  { id: 'md-port', perSystem: 3, spPx: 9, spMinPx: 9, toolbarPx: 56, statusLinePx: 28 },
  { id: 'sm-short', perSystem: 4, spPx: 7.5, spMinPx: 7, toolbarPx: 44, statusLinePx: 0 },
  { id: 'xs', perSystem: 2, spPx: 7.5, spMinPx: 7, toolbarPx: 44, statusLinePx: 0 },
] as const;

/** 4.1 breakpoints (CSS px width). */
export const BREAKPOINTS: Record<Breakpoint, { minWidth: number }> = {
  xs: { minWidth: 0 },
  sm: { minWidth: 568 },
  md: { minWidth: 768 },
  lg: { minWidth: 1024 },
  xl: { minWidth: 1440 },
};

/** "Short" modifier (4.1): viewport height below this. */
export const SHORT_HEIGHT_PX = 500;

/** Score geometry (04 7.3) and page-turn rules (4.3); mirrors the `ui` and `score` token groups. */
export const LANE_PX = 20;
export const SYSTEM_GAP_PX = 12;
export const SYSTEM_STAFF_SP = 12; // 4 sp staff + 4 sp above + 4 sp below
export const MIN_BAR_WIDTH_SP = 14;
export const MAX_SLOTS = 6;
export const SWAP_DELAY_MS = 400;
export const SWAP_LATEST_FRACTION = 0.5;
export const WRAP_SWAP_FRACTION = 0.75;
export const CROSSFADE_MS = 160;
export const XL_MAX_BARS_PER_SYSTEM = 6;
export const XL_DENSE_TICKABLES_PER_BAR = 9;
export const XS_HEAVY_BAR_TICKABLES = 8;

export interface Insets {
  top: number;
  bottom: number;
}

export function breakpointFor(width: number): Breakpoint {
  if (width >= 1440) return 'xl';
  if (width >= 1024) return 'lg';
  if (width >= 768) return 'md';
  if (width >= 568) return 'sm';
  return 'xs';
}

export function isShort(height: number): boolean {
  return height < SHORT_HEIGHT_PX;
}

function rowById(id: LayoutRowId): LayoutRow {
  const r = LAYOUT_ROWS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown layout row ${id}`);
  return r;
}

/**
 * Choose the row for a viewport. 4.2 lists `sm-short` for 568 to 1023 wide; a short viewport at 1024 or wider has
 * no row of its own, so it also takes `sm-short` (same 44 px toolbar, no status line, as the Short modifier says).
 */
export function selectRow(width: number, height: number): LayoutRow {
  if (width < 568) return rowById('xs');
  if (isShort(height)) return rowById('sm-short');
  if (width >= 1440) return rowById('xl');
  if (width >= 1024) return rowById('lg');
  return rowById(width > height ? 'md-land' : 'md-port');
}

/** System height: 12 sp + 20 px verdict lane + 12 px gap (10 sp: 152 px, 7.5 sp: 122 px). */
export function systemHeightPx(spPx: number): number {
  return SYSTEM_STAFF_SP * spPx + LANE_PX + SYSTEM_GAP_PX;
}

/** Split `n` bars into `systems` groups, extra bars going to the earlier systems. */
function evenSplit(n: number, systems: number): number[] {
  const base = Math.floor(n / systems);
  const extra = n % systems;
  return Array.from({ length: systems }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Bars per system for an excerpt of `barCount` bars. `tickablesPerBar` (optional, one entry per bar) drives the
 * xl density rule and the xs "heavy bar gets a system to itself" rule.
 */
export function barsPerSystem(row: LayoutRow, barCount: number, tickablesPerBar?: readonly number[]): number[] {
  if (barCount <= 0) return [];
  if (row.id === 'xs') {
    const out: number[] = [];
    let cur = 0;
    let curHeavy = false;
    for (let i = 0; i < barCount; i++) {
      const heavy = (tickablesPerBar?.[i] ?? 0) > XS_HEAVY_BAR_TICKABLES;
      if (cur > 0 && (heavy || curHeavy || cur >= (row.perSystem as number))) {
        out.push(cur);
        cur = 0;
        curHeavy = false;
      }
      cur++;
      curHeavy = curHeavy || heavy;
    }
    if (cur > 0) out.push(cur);
    return out;
  }
  let size: number;
  if (row.perSystem === 'half') {
    const avg = tickablesPerBar && tickablesPerBar.length > 0 ? tickablesPerBar.reduce((a, b) => a + b, 0) / tickablesPerBar.length : 0;
    size = avg > XL_DENSE_TICKABLES_PER_BAR ? Math.ceil(barCount / 3) : Math.min(XL_MAX_BARS_PER_SYSTEM, Math.ceil(barCount / 2));
  } else {
    size = row.perSystem;
  }
  return evenSplit(barCount, Math.ceil(barCount / size));
}

/** Available height for systems: viewport minus toolbar, status line and the safe-area insets. */
export function availableHeightPx(viewportH: number, insets: Insets, row: LayoutRow): number {
  return viewportH - row.toolbarPx - row.statusLinePx - insets.top - insets.bottom;
}

function rawSlots(viewportH: number, insets: Insets, row: LayoutRow, spPx: number): number {
  return Math.floor(availableHeightPx(viewportH, insets, row) / systemHeightPx(spPx));
}

/** The sp to draw at and the slot count it gives: sp steps down to the row's minimum when fewer than 2 slots fit. */
export function resolveSlots(viewportH: number, insets: Insets, row: LayoutRow): { spPx: number; slots: number } {
  let spPx = row.spPx;
  let v = rawSlots(viewportH, insets, row, spPx);
  if (v < 2 && row.spMinPx < spPx) {
    spPx = row.spMinPx;
    v = rawSlots(viewportH, insets, row, spPx);
  }
  return { spPx, slots: Math.min(MAX_SLOTS, Math.max(1, v)) };
}

/** `floor((viewportH - toolbar - statusLine - sai-top - sai-bottom) / systemHeight)`, clamped 1..6 (4.3). */
export function slotCount(viewportH: number, insets: Insets, row: LayoutRow): number {
  return resolveSlots(viewportH, insets, row).slots;
}

/** One page turn: when the playhead enters `trigger.system`, wait `delayMs`, then `slot` shows `newSystem`. */
export interface PlannedSwap {
  trigger: { system: number; delayMs: number };
  slot: number;
  newSystem: number;
}

export interface PagePlan {
  /** True when N > v. */
  turns: boolean;
  /** Systems shown in each slot at the start (slot i shows system i while i < N). */
  initialSlots: number[];
  swaps: PlannedSwap[];
  /** `wrapMarker[s]`: system s + 1 is not in the slot directly below s once swaps for s are done (drawn as a 3 px brass bar). */
  wrapMarker: boolean[];
}

/**
 * Page-turn plan (4.3). Systems and slots are 0-based here (the spec's system 1 is 0).
 * `systemDurationsMs[s]` is how long the playhead spends in system s.
 */
export function planSwaps(systemCount: number, slots: number, systemDurationsMs: readonly number[]): PagePlan {
  const N = systemCount;
  const v = Math.max(1, slots);
  const initialSlots = Array.from({ length: Math.min(N, v) }, (_, i) => i);
  const wrapMarker = new Array<boolean>(N).fill(false);
  if (N <= v) return { turns: false, initialSlots, swaps: [], wrapMarker };

  const dur = (s: number): number => systemDurationsMs[s] ?? 0;
  const state = initialSlots.slice();
  const swaps: PlannedSwap[] = [];
  const shown = new Set<number>(state);
  const lowestUnshown = (): number | null => {
    for (let i = 0; i < N; i++) if (!shown.has(i)) return i;
    return null;
  };

  if (v === 1) {
    // Very small windows: the single slot turns at 75% of the current system.
    for (let s = 0; s < N - 1; s++) {
      swaps.push({ trigger: { system: s, delayMs: Math.round(WRAP_SWAP_FRACTION * dur(s)) }, slot: 0, newSystem: s + 1 });
    }
    return { turns: true, initialSlots, swaps, wrapMarker };
  }

  const keepBehind = v >= 4 ? 1 : 0;
  for (let s = 0; s < N; s++) {
    // Entering system s (the spec's "system s + 1"): slots holding a system before s - k are replaced.
    const delayMs = Math.round(Math.min(SWAP_DELAY_MS, SWAP_LATEST_FRACTION * dur(s)));
    for (let slot = 0; slot < v; slot++) {
      const x = state[slot];
      if (x === undefined || x >= s - keepBehind) continue;
      const next = lowestUnshown();
      if (next === null) break;
      state[slot] = next;
      shown.add(next);
      swaps.push({ trigger: { system: s, delayMs }, slot, newSystem: next });
    }
    if (s < N - 1) {
      const cur = state.indexOf(s);
      const nxt = state.indexOf(s + 1);
      wrapMarker[s] = cur >= 0 && nxt >= 0 && nxt !== cur + 1;
    }
  }
  return { turns: true, initialSlots, swaps, wrapMarker };
}

/** Toolbar line indicator "Lines 2–6 of 6" for the systems currently in the slots (1-based, inclusive). */
export function lineRange(slotSystems: readonly number[]): { first: number; last: number } {
  return { first: Math.min(...slotSystems) + 1, last: Math.max(...slotSystems) + 1 };
}

export interface LayoutPlan {
  row: LayoutRow;
  spPx: number;
  systemHeightPx: number;
  barsPerSystem: number[];
  slots: number;
  renderOptions: RenderOptions;
}

/** Everything the notation module and the score frame need for one exercise (01 `RenderOptions`). */
export function planLayout(
  viewport: { width: number; height: number },
  insets: Insets,
  barCount: number,
  tickablesPerBar?: readonly number[],
  scoreWidthPx: number = viewport.width,
): LayoutPlan {
  const row = selectRow(viewport.width, viewport.height);
  const { spPx, slots } = resolveSlots(viewport.height, insets, row);
  const bps = barsPerSystem(row, barCount, tickablesPerBar);
  return {
    row,
    spPx,
    systemHeightPx: systemHeightPx(spPx),
    barsPerSystem: bps,
    slots,
    renderOptions: { widthPx: scoreWidthPx, barsPerSystem: bps, spPx },
  };
}
