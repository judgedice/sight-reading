// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { makeAttempt, makeScore } from '../../../store/test-data.ts';
import type { AttemptRecord, AttributionsFile, CcByAttribution, Configs } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { createCreditsScreen, type CreditsServices } from './index.ts';
import { SourceSheet } from './SourceSheet.tsx';
import { adaptedChanges, adaptedLine, findItem, licenceFileParts, licenceLabel, sourceSheetModel, workTitle } from './attribution.ts';
import { text } from './text.ts';
import { keyName } from '../setup/key-names.ts';
import { creditsScreenOverrides } from './index.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';

const read = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as unknown;
const cfg: Configs = loadConfigs({
  grading: read('config/grading-config.json'),
  levels: read('config/levels.json'),
  instruments: read('config/instruments.json'),
  progression: read('config/progression.json'),
  tips: read('config/tips.json'),
  budget: read('config/measurement-budget.json'),
  trumpetValves: read('data/trumpet-valves.json'),
} as never);

const item: CcByAttribution = {
  id: 'ex-0',
  title: 'Lied Nr. 1',
  creator: 'A. Composer',
  sourceUrl: 'https://example.org/score/1',
  license: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: ['rhythm-augmented-x2', 'grace-removed'],
};

const attributions: AttributionsFile = {
  schemaVersion: 1,
  collections: [
    { corpus: 'openscore-lieder', name: 'OpenScore Lieder', url: 'https://example.org/lieder', licenses: ['CC0-1.0', 'CC-BY-4.0'] },
  ],
  items: [item],
};

/** A take on the CC BY excerpt, transposed for an alto saxophone. */
function record(over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    ...makeAttempt(0, { excerptId: 'ex-0', instrumentId: 'sax-alto', transposition: { diatonic: 5, chromatic: 9 }, score: makeScore(80, true) }),
    ...over,
  } as AttemptRecord;
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

describe('attribution model', () => {
  it('finds the item for an excerpt and the collection for its corpus', () => {
    expect(findItem(attributions, 'ex-0')).toBe(item);
    expect(findItem(attributions, 'nope')).toBeUndefined();
    expect(findItem(null, 'ex-0')).toBeUndefined();
  });

  it('names excerpted first, then recorded changes, then transposition, without repeats', () => {
    const r = record();
    expect(adaptedChanges(r, item)).toEqual([
      text('change.excerpted'),
      text('change.grace-removed'),
      text('change.rhythm-augmented-x2'),
      text('change.transposed'),
    ]);
  });

  it('leaves out transposition when the written key is concert pitch', () => {
    const r = record({ transposition: { diatonic: 0, chromatic: 0 } });
    expect(adaptedChanges(r, undefined)).toEqual([text('change.excerpted')]);
  });

  it('builds the adapted line with written and concert keys from the record', () => {
    const r = record();
    expect(adaptedLine(r, cfg, item)).toBe(
      copy('credit.adapted', {
        modifications: adaptedChanges(r, item).join(', '),
        instrument: cfg.instrumentById['sax-alto']?.label ?? 'sax-alto',
        writtenKey: keyName(r.writtenKey),
        concertKey: keyName(r.concertKey),
      }),
    );
  });

  it('joins catalogue number and movement into the work title', () => {
    const r = record({ credit: { ...record().credit, work: 'Sonata', catalog: 'Op. 1', movement: 'I' } });
    expect(workTitle(r)).toBe(`${text('credit.work', { title: 'Sonata', catalog: 'Op. 1' })}: I`);
    const bare = { composer: 'X', work: 'Lied', sourceMeasures: [1, 8] as [number, number], corpus: 'openscore-lieder' as const, license: 'CC0-1.0' as const };
    expect(workTitle(record({ credit: bare }))).toBe('Lied');
  });

  it('builds the source sheet rows, with the item links when attribution is on the device', () => {
    const m1 = sourceSheetModel(record(), cfg, attributions);
    expect(m1.collection).toEqual({ name: 'OpenScore Lieder', url: 'https://example.org/lieder' });
    expect(m1.licence).toEqual({ label: licenceLabel('CC0-1.0'), url: 'https://creativecommons.org/licenses/by/4.0/' });
    expect(m1.source).toBe('https://example.org/score/1');
    expect(m1.bars).toBe(text('source.bars', { a: record().credit.sourceMeasures[0], b: record().credit.sourceMeasures[1] }));
  });

  it('falls back to the corpus id and no links when attribution is not on the device', () => {
    const m2 = sourceSheetModel(record(), cfg, null);
    expect(m2.collection).toEqual({ name: 'openscore-lieder', url: null });
    expect(m2.source).toBeNull();
    expect(m2.licence.url).toBeNull();
  });
});

function Route(): ReactElement {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

function renderCredits(services: CreditsServices): void {
  const table = createRouteTable({ credits: createCreditsScreen(services) });
  const src: LocationSource = { getHash: () => '#/credits', subscribe: () => () => undefined, navigate: () => undefined };
  m = mount(
    <RouterProvider table={table} dev={false} source={src}>
      <Route />
    </RouterProvider>,
  );
}

const flush = (): Promise<void> => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe('CreditsScreen', () => {
  it('lists the collections with licences and the TASL entry for each CC BY work', async () => {
    renderCredits({ configs: cfg, loadAttributions: async () => attributions, rightsContact: 'rights@example.org' });
    await flush();
    const el = document.querySelector('[data-testid="screen-credits"]')!;
    expect(el.textContent).toContain('OpenScore Lieder');
    expect(el.textContent).toContain(text('credits.collection.licences', { licences: `${licenceLabel('CC0-1.0')}, ${licenceLabel('CC-BY-4.0')}` }));
    expect(el.textContent).toContain('Lied Nr. 1');
    expect(el.textContent).toContain(text('credits.work.by', { creator: 'A. Composer' }));
    expect(el.querySelector(`a[href="${item.licenseUrl}"]`)).not.toBeNull();
    expect(el.querySelector('a[href^="mailto:rights@example.org"]')).not.toBeNull();
  });

  it('omits the rights link when no contact is configured, and says so when the file cannot load', async () => {
    renderCredits({ configs: cfg, loadAttributions: () => Promise.reject(new Error('offline')) });
    await flush();
    const el = document.querySelector('[data-testid="screen-credits"]')!;
    expect(el.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(el.textContent).toContain(text('source.unavailable'));
  });

  it('credits the sound sources and links the three licence files, even when attribution cannot load', async () => {
    renderCredits({ configs: cfg, loadAttributions: () => Promise.reject(new Error('offline')) });
    await flush();
    const el = document.querySelector('[data-testid="screen-credits"]')!;
    const sounds = [...el.querySelectorAll('.cred-card')].find((c) => c.querySelector('h2')?.textContent === copy('credits.sounds.title'));
    expect(sounds).toBeDefined();
    const s = sounds!.textContent ?? '';
    expect(s).toContain('VS Chamber Orchestra 2 Community Edition');
    expect(s).toContain('Versilian Studios');
    expect(s).toContain('Frank Wen');
    expect(s).toContain('Benjamin Gleitzman');
    expect(s).toContain('Salamander Grand Piano V3 by Alexander Holm');
    expect(s).toContain(copy('credits.sounds.voices'));
    const hrefs = [...sounds!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['./LICENSES/CC0-1.0.txt', './LICENSES/MIT-FluidR3.txt', './LICENSES/CC-BY-3.0.txt']);
    for (const href of hrefs) {
      expect(existsSync(join(process.cwd(), href!.slice(2)))).toBe(true);
    }
  });
});

describe('licenceFileParts', () => {
  it('splits the licence paths out as links and keeps every other word as text', () => {
    const parts = licenceFileParts('Licence texts: LICENSES/CC0-1.0.txt, LICENSES/CC-BY-3.0.txt.');
    expect(parts).toEqual([
      { text: 'Licence texts: ', href: null },
      { text: 'LICENSES/CC0-1.0.txt', href: './LICENSES/CC0-1.0.txt' },
      { text: ', ', href: null },
      { text: 'LICENSES/CC-BY-3.0.txt', href: './LICENSES/CC-BY-3.0.txt' },
      { text: '.', href: null },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe('Licence texts: LICENSES/CC0-1.0.txt, LICENSES/CC-BY-3.0.txt.');
  });

  it('returns the sentence whole when it has no licence path', () => {
    expect(licenceFileParts('Voices: synthesised for this app.')).toEqual([{ text: 'Voices: synthesised for this app.', href: null }]);
  });
});

describe('SourceSheet', () => {
  it('shows the composer, work, bars, collection, licence, source and adapted rows', () => {
    const r = record();
    m = mount(<SourceSheet open record={r} configs={cfg} attributions={attributions} onClose={() => undefined} />);
    const sheet = document.querySelector('[data-testid="source-sheet"]')!;
    expect(sheet).not.toBeNull();
    for (const k of ['credit.sheet.composer', 'credit.sheet.work', 'credit.sheet.bars', 'credit.sheet.collection', 'credit.sheet.licence', 'credit.sheet.source', 'credit.sheet.adapted']) {
      expect(sheet.textContent).toContain(copy(k as Parameters<typeof copy>[0]));
    }
    expect(sheet.textContent).toContain(adaptedLine(r, cfg, item));
  });

  it('renders nothing without a take', () => {
    m = mount(<SourceSheet open record={null} configs={cfg} onClose={() => undefined} />);
    expect(document.querySelector('[data-testid="source-sheet"]')).toBeNull();
  });
});

describe('creditsScreenOverrides', () => {
  it('replaces the credits placeholder', () => {
    const table = createRouteTable(creditsScreenOverrides({ configs: cfg, loadAttributions: async () => attributions }));
    expect(table.find((r) => r.id === 'credits')?.Screen).not.toBe(PlaceholderScreen);
  });
});
