// Corpus validation over public/corpus/ (03 job C10; PLAN rulings 24 and 25).
//   H-render : every shipped excerpt renders headless (src/notation under jsdom) without throwing, and fits the band
//              of at least 3 launch instruments in at least one allowed written key (runtime fit function, 03 7.3).
//   H-serve  : every excerpt can be served by the selector to some launch instrument at its own level or an adjacent one.
//   H-viable : at least 300 excerpts; for every launch instrument x served level the selector returns an excerpt
//              with a random key and a random meter, and that excerpt prepares and renders.
//   stats.fit: recomputed with the runtime fit function and compared with the manifest.
//   H-source : every excerpt has source, licence and credit (collection credit, plus a TASL record for CC BY).
//   H-dedupe : no two excerpts share a fingerprint unless they share a dedupeGroup.
// Run with `pnpm corpus:check` (tsx tools/corpus-check/run.ts). Exits 1 on any failure.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createRng } from '../../src/core/rng.ts';
import type {
  AttributionsFile,
  Configs,
  CorpusManifest,
  ExcerptDoc,
  Instrument,
  KeySig,
  ManifestEntry,
  PracticeSettings,
  PreparedExcerpt,
  RawConfigs,
  SelectionHistory,
} from '../../src/core/types.ts';
import { loadExcerpt, loadManifest, prepareExcerpt, selectExcerptWith, countEligible } from '../../src/corpus/index.ts';
import { METER_MIN_EXCERPTS, shownMeters } from '../../src/corpus/select/index.ts';
import { allowedWrittenKeys, bandFor, levelDef } from '../../src/corpus/select/levels.ts';
import { fitsInKey, shiftWindow, windowFits } from '../../src/corpus/transpose/fit.ts';
import { launchInstruments } from '../../src/instruments/index.ts';
import { loadConfigs } from '../../src/rules/index.ts';
import { planLayout } from '../../src/ui/layout-table.ts';

export const CORPUS_DIR = resolve(import.meta.dirname, '../../public') + '/';
const ROOT = resolve(import.meta.dirname, '../..') + '/';

/** Ruling 24: CI fails below this many excerpts. */
export const MIN_EXCERPTS = 300;
/** H-render: an excerpt must fit at least this many launch instruments. */
export const MIN_FIT_INSTRUMENTS = 3;
/** Random-key and random-meter selector draws per launch instrument x served level. */
export const SELECTOR_DRAWS = 5;

export interface Failure {
  gate: 'H-render' | 'H-serve' | 'H-fit' | 'H-viable' | 'H-stats' | 'H-source' | 'H-dedupe' | 'H-withdrawn';
  id: string;
  reason: string;
}

export interface CheckReport {
  corpusVersion: string;
  excerpts: number;
  rendered: number;
  servedLevels: number[];
  failures: Failure[];
  /** Excerpt ids that failed a per-excerpt gate (the denylist input). */
  badIds: string[];
  /** Launch instrument x served level cells checked. */
  selectorCells: number;
  fitMismatches: number;
  fingerprintPairsExempt: number;
}

export function readConfigs(): Configs {
  const j = (p: string): unknown => JSON.parse(readFileSync(ROOT + p, 'utf8')) as unknown;
  return loadConfigs({
    grading: j('config/grading-config.json'),
    levels: j('config/levels.json'),
    instruments: j('config/instruments.json'),
    progression: j('config/progression.json'),
    tips: j('config/tips.json'),
    budget: j('config/measurement-budget.json'),
    trumpetValves: j('data/trumpet-valves.json'),
  } as unknown as RawConfigs);
}

/** Serves public/ files by relative path, the way the app's asset service does. */
export const diskAssets = (dir: string = CORPUS_DIR) => ({
  getJson<T>(rel: string): Promise<T> {
    try {
      return Promise.resolve(JSON.parse(readFileSync(dir + rel, 'utf8')) as T);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  },
});

/** Install the browser globals VexFlow needs (the renderer needs `document`; nothing else is measured). */
export function installDom(): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['window', 'document', 'Node', 'Element', 'SVGElement', 'HTMLElement', 'XMLSerializer', 'DOMParser']) {
    const v = (dom.window as unknown as Record<string, unknown>)[k];
    if (k === 'window') g.window = dom.window;
    else if (v !== undefined) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  }
}

/** Draws for an excerpt that only the L - 1 pool can serve: each draw takes it with p 0.2 (it is that pool's only member). */
const BELOW_POOL_DRAWS = 64;

/** Selector options for the single-entry manifests: every level meter counts as shown (see `shownInApp`). */
const ALL_METERS = { meterMinExcerpts: 0 } as const;

const mkSettings = (instrumentId: string, level: number): PracticeSettings => ({
  instrumentId,
  level,
  writtenKey: 'random',
  meter: 'random',
  bpm: 'random',
  bars: 'random',
  mode: 'practice',
  listening: true,
  metronome: 'audible',
  clickTimbre: 'tick',
  outputMode: 'speakers',
  a4Hz: 440,
});

const history = (level: number): SelectionHistory => ({ seenGroups: {}, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: level });

/** Runtime fit (03 7.3): written keys allowed at the level in which the entry fits the instrument's tier band. */
export function fittingKeys(e: Pick<ManifestEntry, 'level' | 'mode' | 'modal' | 'fifths' | 'rangeConcert'>, inst: Instrument, cfg: Configs): (KeySig | 'random')[] {
  const def = levelDef(cfg, e.level);
  const band = bandFor(inst, def);
  if (e.modal) {
    // Modal excerpts are served under a random key (R8): any concert shift inside the window works.
    return def.modal.includes(e.modal) && windowFits(shiftWindow(e.rangeConcert, inst, band)) ? ['random'] : [];
  }
  const src: KeySig = { fifths: e.fifths, mode: e.mode };
  return allowedWrittenKeys(def, e.mode).filter((k) => fitsInKey(src, e.rangeConcert, k, inst, band) !== null);
}

/** Recompute stats.fit with the runtime fit function. */
export function computeFit(entries: readonly ManifestEntry[], cfg: Configs): Record<string, Record<number, Record<string, number>>> {
  const out: Record<string, Record<number, Record<string, number>>> = {};
  for (const inst of cfg.instruments.instruments) {
    const per: Record<number, Record<string, number>> = {};
    for (const e of entries) {
      if (fittingKeys(e, inst, cfg).length === 0) continue;
      ((per[e.level] ??= {})[e.meter] ??= 0);
      per[e.level]![e.meter]! += 1;
    }
    out[inst.id] = per;
  }
  return out;
}

const QUANT = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4];
const quant = (r: number): number => QUANT.reduce((b, q) => (Math.abs(Math.log(r / q)) < Math.abs(Math.log(r / b)) ? q : b), 1);
const midiOf = (p: { step: string; alter: number; octave: number }): number => ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[p.step]! + p.alter + 12 * (p.octave + 1);

/** 03 6.10: (interval, quantised IOI ratio) sequence, invariant to transposition and augmentation. */
export function fingerprint(doc: ExcerptDoc): string {
  const notes = doc.measures.flatMap((m) => m.events).flatMap((e) => (e.kind === 'note' ? [e] : []));
  notes.sort((a, b) => a.tick - b.tick);
  const out: string[] = [];
  for (let i = 1; i < notes.length; i++) {
    const a = notes[i - 1]!;
    const b = notes[i]!;
    const ioi = b.tick - a.tick;
    const prev = i >= 2 ? a.tick - notes[i - 2]!.tick : ioi;
    out.push(`${midiOf(b.pitch) - midiOf(a.pitch)}/${quant(ioi / (prev || ioi || 1)).toFixed(3)}`);
  }
  return out.join(' ');
}

function checkSource(doc: ExcerptDoc, entry: ManifestEntry, attr: AttributionsFile, fails: (reason: string) => void): void {
  const s = doc.source;
  for (const k of ['composer', 'work', 'upstreamRef', 'sourceUrl', 'license', 'licenseUrl'] as const) {
    if (typeof s[k] !== 'string' || s[k].trim() === '') fails(`source.${k} is empty`);
  }
  if (!Array.isArray(s.sourceMeasures) || s.sourceMeasures.length !== 2) fails('source.sourceMeasures missing');
  if (s.license !== entry.license) fails(`licence ${s.license} differs from manifest ${entry.license}`);
  if (s.corpus !== entry.corpus) fails(`corpus ${s.corpus} differs from manifest ${entry.corpus}`);
  if (s.composer !== entry.composer) fails(`composer "${s.composer}" differs from manifest "${entry.composer}"`);
  if (!attr.collections.some((c) => c.corpus === s.corpus && c.licenses.includes(s.license))) fails(`no collection credit for ${s.corpus} under ${s.license}`);
  if (s.license === 'CC-BY-4.0') {
    const t = attr.items.find((i) => i.id === doc.id);
    if (!t) fails('CC BY excerpt without a TASL attribution record');
    else if (!t.creator || !t.sourceUrl || !t.title) fails('TASL record incomplete');
  }
}

function renderOne(p: PreparedExcerpt, widths: readonly number[], render: (p: PreparedExcerpt, o: ReturnType<typeof planLayout>['renderOptions']) => unknown, tickables: (p: PreparedExcerpt) => number[]): void {
  for (const w of widths) {
    const plan = planLayout({ width: w, height: w > 600 ? 800 : 844 }, { top: 0, bottom: 0 }, p.measures.length, tickables(p));
    render(p, plan.renderOptions);
  }
}

export interface CheckOptions {
  dir?: string;
  cfg?: Configs;
  /** Render widths in px; the narrow phone row and the desktop row by default. */
  widths?: readonly number[];
}

export async function runCheck(opts: CheckOptions = {}): Promise<CheckReport> {
  installDom();
  const { renderHeadless, tickablesPerBar } = await import('../../src/notation/index.ts');
  const dir = opts.dir ?? CORPUS_DIR;
  const cfg = opts.cfg ?? readConfigs();
  const widths = opts.widths ?? [1280, 390];
  const assets = diskAssets(dir);
  const m: CorpusManifest = await loadManifest(assets);
  const attr = await assets.getJson<AttributionsFile>(m.attributions.file ? 'corpus/v1/' + m.attributions.file : 'corpus/v1/attributions.json');
  const launch = launchInstruments(cfg);
  const failures: Failure[] = [];
  const bad = new Set<string>();
  const fail = (gate: Failure['gate'], id: string, reason: string, perExcerpt = true): void => {
    failures.push({ gate, id, reason });
    if (perExcerpt) bad.add(id);
  };

  // Ruling 24: minimum size, withdrawn ids, duplicate ids.
  if (m.entries.length < MIN_EXCERPTS) fail('H-viable', '*', `${m.entries.length} excerpts, minimum ${MIN_EXCERPTS}`, false);
  const seenIds = new Set<string>();
  for (const e of m.entries) {
    if (seenIds.has(e.id)) fail('H-viable', e.id, 'duplicate excerpt id');
    seenIds.add(e.id);
  }
  for (const w of m.withdrawn) if (seenIds.has(w)) fail('H-withdrawn', w, 'withdrawn id is still in the manifest');

  // stats.fit cross-check.
  const fit = computeFit(m.entries, cfg);
  let fitMismatches = 0;
  for (const inst of cfg.instruments.instruments) {
    const want = fit[inst.id] ?? {};
    const got = m.stats.fit[inst.id] ?? {};
    for (const lv of new Set([...Object.keys(want), ...Object.keys(got)])) {
      for (const meter of new Set([...Object.keys(want[Number(lv)] ?? {}), ...Object.keys(got[Number(lv)] ?? {})])) {
        const a = want[Number(lv)]?.[meter] ?? 0;
        const b = got[Number(lv)]?.[meter] ?? 0;
        if (a !== b) {
          fitMismatches++;
          fail('H-stats', `${inst.id}/L${lv}/${meter}`, `stats.fit says ${b}, runtime fit function says ${a}`, false);
        }
      }
    }
  }

  // The meters the setup screen shows per instrument and level, from the full manifest (05 section 5.5).
  const shown = new Map<string, ReadonlySet<string>>();
  const shownInApp = (instrumentId: string, level: number): ReadonlySet<string> => {
    const k = `${instrumentId}|${level}`;
    let out = shown.get(k);
    if (!out) {
      const counts = levelDef(cfg, level).meters.map((meter) => ({ meter, count: countEligible(m, instrumentId, level, meter, cfg) }));
      shown.set(k, (out = new Set(shownMeters(counts, METER_MIN_EXCERPTS))));
    }
    return out;
  };

  // Per excerpt: source, fit, render, fingerprint.
  const byFp = new Map<string, { id: string; group: string }[]>();
  let rendered = 0;
  for (const e of m.entries) {
    let doc: ExcerptDoc;
    try {
      doc = await loadExcerpt(m, e.id, assets);
    } catch (err) {
      fail('H-render', e.id, `cannot load: ${(err as Error).message}`);
      continue;
    }
    checkSource(doc, e, attr, (r) => fail('H-source', e.id, r));

    const fitting = launch.filter((i) => fittingKeys(e, i, cfg).length > 0);
    if (fitting.length < MIN_FIT_INSTRUMENTS) fail('H-fit', e.id, `fits only ${fitting.length} launch instruments (${fitting.map((i) => i.id).join(', ') || 'none'})`);

    // Render through the runtime path: the single-entry selector, prepareExcerpt, then the notation module. Try the
    // fitting instruments in turn; the excerpt passes when one of them selects, prepares and renders.
    const solo: CorpusManifest = { ...m, entries: [e], stats: { ...m.stats, servedLevels: [e.level] } };
    let done = false;
    const errors: string[] = [];
    // The excerpt is eligible at its own level, one above (as the L - 1 pool) and one below (as a stretch excerpt).
    // "Any" time draws only from the meters the setup screen shows (redesign 05 section 5.5), and the screen counts
    // the whole shipped manifest. The single-entry manifests below would undercount, so the shown set is taken from
    // the full manifest, the excerpt is skipped where its meter is left out, and the draws below use no threshold.
    for (const inst of fitting) {
      for (const lv of [e.level, e.level + 1, e.level - 1]) {
        if (lv < 1 || lv > 10) continue;
        if (!shownInApp(inst.id, lv).has(e.meter)) continue;
        let sel = selectExcerptWith(solo, { ...mkSettings(inst.id, lv), seed: 1 }, history(lv), cfg, createRng(1), ALL_METERS);
        if ('error' in sel && lv === e.level + 1) {
          // At L + 1 the excerpt sits in the L - 1 pool, which is never served alone (its share is capped at 20%), so
          // a single-entry manifest always refuses it. Serve it next to the real level-L + 1 excerpts and draw until
          // the selector picks it (each draw takes the L - 1 pool with probability maxFracFromLevelBelow).
          const others = m.entries.filter((x) => x.level === lv);
          const beside: CorpusManifest = { ...m, entries: [e, ...others], stats: { ...m.stats, servedLevels: [lv] } };
          const without: CorpusManifest = { ...beside, entries: others };
          if (countEligible(beside, inst.id, lv, null, cfg) <= countEligible(without, inst.id, lv, null, cfg)) continue;
          for (let seed = 1; seed <= BELOW_POOL_DRAWS; seed++) {
            const s2 = selectExcerptWith(beside, { ...mkSettings(inst.id, lv), seed }, history(lv), cfg, createRng(seed), ALL_METERS);
            if ('error' in s2) break;
            if (s2.entry.id === e.id) {
              sel = s2;
              break;
            }
          }
          if (!('error' in sel) && sel.entry.id !== e.id) continue;
        }
        if ('error' in sel) continue;
        try {
          const p = prepareExcerpt(doc, sel, inst, cfg);
          renderOne(p, widths, (pp, o) => renderHeadless(pp, o), tickablesPerBar);
          done = true;
        } catch (err) {
          errors.push(`${inst.id}@L${lv}: ${(err as Error).message}`);
        }
        if (done) break;
      }
      if (done) break;
    }
    if (done) rendered++;
    else if (fitting.length > 0 && errors.length > 0) fail('H-render', e.id, errors.slice(0, 3).join('; '));
    else if (fitting.length > 0) fail('H-serve', e.id, `no launch instrument can be served this excerpt at levels ${e.level - 1} to ${e.level + 1} (source tempo outside the level range, bars or flags: 03 7.5 rule 5)`);

    const fp = fingerprint(doc);
    if (fp) (byFp.get(fp) ?? byFp.set(fp, []).get(fp)!).push({ id: e.id, group: e.dedupeGroup });
  }

  // Fingerprints: pairs inside one dedupeGroup are exempt (augmented variants share the original's fingerprint).
  let exempt = 0;
  for (const list of byFp.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i]!.group === list[j]!.group) exempt++;
        else fail('H-dedupe', list[j]!.id, `same fingerprint as ${list[i]!.id} in another dedupe group`);
      }
    }
  }

  // H-viable: selector for every launch instrument x served level, random key, random meter, several seeds.
  let cells = 0;
  for (const inst of launch) {
    for (const lv of m.stats.servedLevels) {
      cells++;
      let ok = 0;
      for (let seed = 1; seed <= SELECTOR_DRAWS; seed++) {
        const sel = selectExcerptWith(m, { ...mkSettings(inst.id, lv), seed }, history(lv), cfg, createRng(seed), {});
        if (!('error' in sel)) ok++;
      }
      if (ok < SELECTOR_DRAWS) fail('H-viable', `${inst.id}/L${lv}`, `selector returned an excerpt in ${ok} of ${SELECTOR_DRAWS} draws`, false);
      if (countEligible(m, inst.id, lv, null, cfg) === 0) fail('H-viable', `${inst.id}/L${lv}`, 'countEligible is 0', false);
    }
  }
  // Ruling 25: a level is served only with at least 30 excerpts.
  for (const lv of m.stats.servedLevels) {
    const n = m.entries.filter((e) => e.level === lv).length;
    if (n < 30) fail('H-viable', `L${lv}`, `level served with ${n} excerpts (ruling 25 needs 30)`, false);
  }

  return {
    corpusVersion: m.corpusVersion,
    excerpts: m.entries.length,
    rendered,
    servedLevels: m.stats.servedLevels,
    failures,
    badIds: [...bad].sort(),
    selectorCells: cells,
    fitMismatches,
    fingerprintPairsExempt: exempt,
  };
}
