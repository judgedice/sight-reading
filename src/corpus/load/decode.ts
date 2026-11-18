/**
 * Decodes the column-oriented manifest (03 §7.1, 01 §6.2) into `ManifestEntry` objects, and
 * assembles the `CorpusManifest` that the selector runs on. Pure: nothing is fetched here.
 */
import type {
  CorpusFileRef,
  CorpusId,
  CorpusIndex,
  CorpusManifest,
  ExcerptFlag,
  FeatureKey,
  FeatureLevels,
  Familiarity,
  Licence,
  ManifestCell,
  ManifestColumn,
  ManifestEntry,
  ManifestFile,
  Mode,
  WithdrawnFile,
} from '../../core/types.ts';
import { CorpusLoadError } from './errors.ts';

const MODAL_MODES: readonly Mode[] = ['dorian', 'mixolydian', 'phrygian', 'lydian', 'aeolian', 'locrian'];
const KEY_MODES: readonly ManifestEntry['mode'][] = ['major', 'minor'];
const CADENCES: readonly ManifestEntry['cadenceEnd'][] = ['PAC', 'IAC', 'HC'];
const FAMILIARITIES: readonly Familiarity[] = [0, 1, 2];
const CORPORA: readonly CorpusId[] = ['openscore-lieder', 'openscore-quartets', 'mutopia'];
const LICENCES: readonly Licence[] = ['PD', 'CC0-1.0', 'CC-BY-4.0'];
const FLAGS: readonly ExcerptFlag[] = ['noBreath', 'leapy', 'bass-line'];
const FEATURE_KEYS: readonly FeatureKey[] = ['meter', 'rhythm', 'interval', 'leaps', 'span', 'mode', 'chromatic', 'double', 'density'];

/** Columns every manifest must carry. `originalFamily` is the only optional one. */
const REQUIRED_COLUMNS: readonly ManifestColumn[] = [
  'id', 'shard', 'level', 'meter', 'fifths', 'mode', 'modal', 'bars', 'pickup', 'rangeConcert',
  'minBpm', 'maxBpm', 'minIoiTicks', 'minRepeatIoiTicks', 'composer', 'title', 'work', 'tags',
  'cadenceEnd', 'familiarity', 'featureLevels', 'flags', 'dedupeGroup', 'corpus', 'license',
  'peakNotesPerBeat', 'spelling',
];

/** A `ManifestEntry.spelling` key: letter and alteration, for example "C0", "F1", "B-1" (PLAN ruling 44). */
const SPELLING_KEY = /^[A-G](-2|-1|0|1|2)$/;

const malformed = (message: string, cause?: unknown): CorpusLoadError =>
  new CorpusLoadError('malformed', message, cause === undefined ? undefined : { cause });

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly unknown[]).includes(value)) {
    throw malformed(`${what} has invalid value ${JSON.stringify(value)}`);
  }
  return value as T;
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw malformed(`${what} is not a number`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw malformed(`${what} is not a boolean`);
  return value;
}

function nullableNum(value: unknown, what: string): number | null {
  return value === null ? null : num(value, what);
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw malformed(`${what} is not a string`);
  return value;
}

function pair(value: unknown, what: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw malformed(`${what} is not a pair`);
  return [num(value[0], what), num(value[1], what)];
}

/** Resolves a dictionary index (03 §7.1) to its string. */
function dictString(dict: readonly string[], cell: unknown, what: string): string {
  if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= dict.length) {
    throw malformed(`${what} dictionary index ${JSON.stringify(cell)} is out of range`);
  }
  return dict[cell] as string;
}

function spelling(value: unknown, what: string): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw malformed(`${what} is not an object`);
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!SPELLING_KEY.test(key)) throw malformed(`${what} has invalid key ${JSON.stringify(key)}`);
    const n = num(count, `${what}.${key}`);
    if (!Number.isInteger(n) || n < 1) throw malformed(`${what}.${key} is not a positive count`);
    out[key] = n;
  }
  return out;
}

function featureLevels(value: unknown): FeatureLevels {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed('featureLevels is not an object');
  }
  const out: Partial<Record<FeatureKey, number>> = {};
  for (const [key, level] of Object.entries(value)) {
    oneOf(key, FEATURE_KEYS, 'featureLevels key');
    out[key as FeatureKey] = num(level, `featureLevels.${key}`);
  }
  return out as FeatureLevels;
}

/**
 * Decodes the `rows` of a column manifest into entries. Dictionary columns (`composer`, `title`,
 * `work`) hold indices into `dict`, and `tags` holds an array of indices. `originalFamily` is a
 * plain string column and is omitted from an entry when its cell is null.
 */
export function decodeManifestEntries(file: ManifestFile): ManifestEntry[] {
  const columnAt = new Map<string, number>();
  file.columns.forEach((name, j) => columnAt.set(name, j));
  for (const name of REQUIRED_COLUMNS) {
    if (!columnAt.has(name)) throw malformed(`manifest has no ${name} column`);
  }

  return file.rows.map((row, i) => {
    if (row.length !== file.columns.length) {
      throw malformed(`manifest row ${i} has ${row.length} cells, expected ${file.columns.length}`);
    }
    const cell = (name: ManifestColumn): ManifestCell | undefined => {
      const j = columnAt.get(name);
      return j === undefined ? undefined : row[j];
    };
    const need = (name: ManifestColumn): ManifestCell => {
      const value = cell(name);
      if (value === undefined) throw malformed(`manifest row ${i} lacks ${name}`);
      return value;
    };
    const dictCell = (name: 'composer' | 'title' | 'work') =>
      dictString(file.dict[name], need(name), `${name} of row ${i}`);

    const tagValues = need('tags');
    if (!Array.isArray(tagValues)) throw malformed(`tags of row ${i} is not an array`);
    const tags = (tagValues as readonly number[]).map((t) => dictString(file.dict.tags, t, `tags of row ${i}`));

    const modal = need('modal');
    const entry: ManifestEntry = {
      id: text(need('id'), `id of row ${i}`),
      shard: text(need('shard'), `shard of row ${i}`),
      level: num(need('level'), `level of row ${i}`),
      meter: text(need('meter'), `meter of row ${i}`),
      fifths: num(need('fifths'), `fifths of row ${i}`),
      mode: oneOf(need('mode'), KEY_MODES, `mode of row ${i}`),
      modal: modal === null ? null : oneOf(modal, MODAL_MODES, `modal of row ${i}`),
      bars: num(need('bars'), `bars of row ${i}`),
      pickup: bool(need('pickup'), `pickup of row ${i}`),
      rangeConcert: pair(need('rangeConcert'), `rangeConcert of row ${i}`),
      minBpm: num(need('minBpm'), `minBpm of row ${i}`),
      maxBpm: num(need('maxBpm'), `maxBpm of row ${i}`),
      minIoiTicks: num(need('minIoiTicks'), `minIoiTicks of row ${i}`),
      minRepeatIoiTicks: nullableNum(need('minRepeatIoiTicks'), `minRepeatIoiTicks of row ${i}`),
      composer: dictCell('composer'),
      title: dictCell('title'),
      work: dictCell('work'),
      tags,
      cadenceEnd: oneOf(need('cadenceEnd'), CADENCES, `cadenceEnd of row ${i}`),
      familiarity: oneOf(need('familiarity'), FAMILIARITIES, `familiarity of row ${i}`),
      featureLevels: featureLevels(need('featureLevels')),
      flags: (() => {
        const flags = need('flags');
        if (!Array.isArray(flags)) throw malformed(`flags of row ${i} is not an array`);
        return (flags as readonly unknown[]).map((f) => oneOf(f, FLAGS, `flags of row ${i}`));
      })(),
      dedupeGroup: text(need('dedupeGroup'), `dedupeGroup of row ${i}`),
      corpus: oneOf(need('corpus'), CORPORA, `corpus of row ${i}`),
      license: oneOf(need('license'), LICENCES, `license of row ${i}`),
      peakNotesPerBeat: num(need('peakNotesPerBeat'), `peakNotesPerBeat of row ${i}`),
      spelling: spelling(need('spelling'), `spelling of row ${i}`),
    };
    const family = cell('originalFamily');
    if (typeof family === 'string') entry.originalFamily = family;
    else if (family !== undefined && family !== null) throw malformed(`originalFamily of row ${i} is not a string`);
    return entry;
  });
}

/**
 * Assembles the `CorpusManifest` from the three JSON files the loader fetched: `index.json`,
 * the manifest it names, and `withdrawn.json`. Checks that the files agree with each other.
 */
export function decodeCorpusManifest(index: CorpusIndex, manifest: ManifestFile, withdrawn: WithdrawnFile): CorpusManifest {
  if (index.schemaVersion !== 1) throw malformed(`index.json schemaVersion ${index.schemaVersion} is not 1`);
  if (manifest.schemaVersion !== 1) throw malformed(`manifest schemaVersion ${manifest.schemaVersion} is not 1`);
  if (withdrawn.schemaVersion !== 1) throw malformed(`withdrawn.json schemaVersion ${withdrawn.schemaVersion} is not 1`);
  if (index.corpusVersion !== manifest.corpusVersion) {
    throw malformed(`index.json names corpus ${index.corpusVersion} but the manifest is ${manifest.corpusVersion}`);
  }
  if (!Array.isArray(withdrawn.ids) || withdrawn.ids.some((id) => typeof id !== 'string')) {
    throw malformed('withdrawn.json ids is not an array of strings');
  }

  const chunks = new Map<string, CorpusFileRef>();
  for (const c of index.chunks) {
    if (chunks.has(c.shard)) throw malformed(`index.json lists shard ${c.shard} twice`);
    chunks.set(c.shard, { file: c.file, hash: c.hash, bytes: c.bytes });
  }

  const entries = decodeManifestEntries(manifest);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw malformed(`manifest lists excerpt ${entry.id} twice`);
    ids.add(entry.id);
    if (!chunks.has(entry.shard)) throw malformed(`excerpt ${entry.id} names shard ${entry.shard}, which index.json does not list`);
  }

  if (typeof manifest.stats !== 'object' || manifest.stats === null || !Array.isArray(manifest.stats.servedLevels)) {
    throw malformed('manifest stats block is missing servedLevels');
  }

  return {
    corpusVersion: manifest.corpusVersion,
    entries,
    stats: manifest.stats,
    chunks: Object.fromEntries(chunks),
    attributions: { file: index.attributions.file, hash: index.attributions.hash, bytes: index.attributions.bytes },
    withdrawn: [...withdrawn.ids],
  };
}
