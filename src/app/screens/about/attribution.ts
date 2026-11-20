/**
 * Credit text for a played excerpt, built at runtime from the structured source fields (04 section 5.12). Pure: no React.
 * The UI never shows the pipeline's prebuilt `attribution` string.
 */
import type { AttemptRecord, AttributionsFile, CcByAttribution, CollectionCredit, Configs, Licence, Modification } from '../../../core/types.ts';
import { keyName } from '../setup/key-names.ts';
import { text, type AboutTextKey } from './text.ts';

/** Order of the adapted-line phrases: the excerpt always comes first, then what the item records, then transposition. */
const CHANGE_ORDER: readonly (Modification | 'transposed' | 'octave-displaced')[] = [
  'excerpted',
  'grace-removed',
  'ornament-removed',
  'fermata-removed',
  'lyrics-removed',
  'rhythm-augmented-x2',
  'final-bar-completed',
  'transposed',
  'octave-displaced',
];

export function findItem(att: AttributionsFile | null | undefined, excerptId: string): CcByAttribution | undefined {
  return att?.items.find((i) => i.id === excerptId);
}

export function findCollection(att: AttributionsFile | null | undefined, corpus: string): CollectionCredit | undefined {
  return att?.collections.find((c) => c.corpus === corpus);
}

export function licenceLabel(licence: Licence): string {
  return text(`licence.${licence}` as AboutTextKey);
}

/** A licence file path in the sounds credit (`LICENSES/CC0-1.0.txt`), captured so it can be split out as a link. */
const LICENCE_FILE = /(LICENSES\/[A-Za-z0-9.-]+\.txt)/;

export interface CreditPart {
  text: string;
  /** Set for a licence file path: the link target, relative to the app's index page. */
  href: string | null;
}

/**
 * Splits a credit sentence at its licence file paths, so each path becomes a link to the file in the built app. The
 * words come from the copy catalogue unchanged; only the paths are turned into links.
 */
export function licenceFileParts(sentence: string): CreditPart[] {
  return sentence
    .split(LICENCE_FILE)
    .map((part, i): CreditPart => ({ text: part, href: i % 2 === 1 ? `./${part}` : null }))
    .filter((p) => p.text !== '');
}

/**
 * The modifications the adapted line names: always "excerpted" (every take is an excerpt), the item's recorded
 * changes when attribution is on the device, and "transposed" when the written key differs from concert pitch.
 */
export function adaptedChanges(record: AttemptRecord, item: CcByAttribution | undefined): string[] {
  const wanted = new Set<string>(['excerpted', ...(item?.changes ?? [])]);
  if (record.transposition.diatonic !== 0 || record.transposition.chromatic !== 0) wanted.add('transposed');
  return CHANGE_ORDER.filter((c) => wanted.has(c)).map((c) => text(`change.${c}` as AboutTextKey));
}

/** The credit.adapted line: "Adapted: excerpted, note values doubled, transposed. Written for E♭ alto saxophone in G major (concert B♭ major)." */
export function adaptedLine(record: AttemptRecord, cfg: Configs, item: CcByAttribution | undefined): string {
  const instrument = cfg.instrumentById[record.instrumentId]?.label ?? record.instrumentId;
  return text('credit.adapted', {
    modifications: adaptedChanges(record, item).join(', '),
    instrument,
    writtenKey: keyName(record.writtenKey),
    concertKey: keyName(record.concertKey),
  });
}

/** Work title with the catalogue number and movement, as the results and history credit lines show it. */
export function workTitle(record: AttemptRecord): string {
  const c = record.credit;
  const base = c.catalog ? text('credit.work', { title: c.work, catalog: c.catalog }) : text('credit.workOnly', { title: c.work });
  return c.movement ? `${base}: ${c.movement}` : base;
}

export interface SourceSheetModel {
  composer: string;
  work: string;
  bars: string;
  collection: { name: string; url: string | null };
  licence: { label: string; url: string | null };
  source: string | null;
  adapted: string;
}

/** Every row of the source sheet (04 section 5.12). Edition and encoder are not on the record and are left out. */
export function sourceSheetModel(record: AttemptRecord, cfg: Configs, att?: AttributionsFile | null): SourceSheetModel {
  const c = record.credit;
  const item = findItem(att, record.excerptId);
  const collection = findCollection(att, c.corpus);
  return {
    composer: c.composerDates ? `${c.composer} (${c.composerDates})` : c.composer,
    work: workTitle(record),
    bars: text('source.bars', { a: c.sourceMeasures[0], b: c.sourceMeasures[1] }),
    collection: { name: collection?.name ?? c.corpus, url: collection?.url ?? null },
    licence: { label: licenceLabel(c.license), url: item?.licenseUrl ?? null },
    source: item?.sourceUrl ?? null,
    adapted: adaptedLine(record, cfg, item),
  };
}
