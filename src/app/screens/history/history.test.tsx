// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { makeAttempt, makeProfile, makeScore, memoryRepos } from '../../../store/test-data.ts';
import type { AttemptRecord, Configs } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { setNativeValue, q } from '../../../ui/components/form/test-helpers.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { createAttemptScreen, createHistoryScreen } from './index.ts';
import { creditLine } from '../results/model.ts';
import type { HistoryServices } from './services.ts';
import { localDayOf } from './model.ts';
import { text } from './text.ts';
import type { ReactElement } from 'react';
import { historyScreenOverrides } from './index.ts';
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

const flush = (): Promise<void> => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

function location(hash: string): LocationSource & { navigated: string[] } {
  const navigated: string[] = [];
  return {
    navigated,
    getHash: () => hash,
    subscribe: () => () => undefined,
    navigate: (path) => {
      navigated.push(path);
    },
  };
}

function Route(): ReactElement {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.location.hash = '';
});

async function seed(n: number, over: (i: number) => Partial<AttemptRecord>): Promise<ReturnType<typeof memoryRepos>> {
  const repos = memoryRepos();
  for (let i = 0; i < n; i++) await repos.attempts.add(makeAttempt(i, over(i)));
  return repos;
}

async function renderAt(hash: string, services: HistoryServices): Promise<LocationSource & { navigated: string[] }> {
  const src = location(hash);
  const table = createRouteTable({ history: createHistoryScreen(services), 'history.attempt': createAttemptScreen(services) });
  m = mount(
    <RouterProvider table={table} dev={false} source={src}>
      <Route />
    </RouterProvider>,
  );
  await flush();
  return src;
}

describe('HistoryScreen', () => {
  it('lists takes newest first in one group per local day, with a row link to each attempt', async () => {
    const repos = await seed(25, (i) => (i % 2 === 0 ? { instrumentId: 'flute' } : { instrumentId: 'violin' }));
    const newest = (await repos.attempts.recent(1))[0]!;
    const services: HistoryServices = { configs: cfg, repos, localDay: () => localDayOf(newest.createdAt) };
    await renderAt('#/history', services);
    const rows = document.querySelectorAll('[data-testid="history-row"]');
    expect(rows).toHaveLength(25);
    expect(rows[0]?.getAttribute('href')).toBe(`#/history/${newest.id}`);
    expect(document.querySelector('.hist-day-heading')?.textContent).toBe(copy('history.day.today'));
  });

  it('filters by instrument and writes the choice to the URL query', async () => {
    const repos = await seed(6, (i) => ({ instrumentId: i % 2 === 0 ? 'flute' : 'violin' }));
    const services: HistoryServices = { configs: cfg, repos, localDay: () => '2026-02-01' };
    const src = await renderAt('#/history', services);
    setNativeValue(q<HTMLSelectElement>('select'), 'flute', 'change');
    await flush();
    expect(src.navigated).toContain('/history?instrument=flute');
    expect(document.querySelectorAll('[data-testid="history-row"]')).toHaveLength(3);
  });

  it('shows ranked-only takes when the toggle is on', async () => {
    const repos = await seed(4, (i) => ({ score: i < 2 ? makeScore(80, true) : null }));
    const services: HistoryServices = { configs: cfg, repos, localDay: () => '2026-02-01' };
    const src = await renderAt('#/history', services);
    click(q('[role="switch"]'));
    await flush();
    expect(src.navigated).toContain('/history?ranked=1');
    expect(document.querySelectorAll('[data-testid="history-row"]')).toHaveLength(2);
  });

  it('shows the filtered empty state when nothing matches', async () => {
    const repos = await seed(2, () => ({ instrumentId: 'flute' }));
    const services: HistoryServices = { configs: cfg, repos, localDay: () => '2026-02-01' };
    // The screen reads its filter from the browser's hash (the router does not expose the query).
    window.location.hash = '#/history?instrument=cello';
    await renderAt('#/history?instrument=cello', services);
    expect(document.body.textContent).toContain(copy('empty.historyFiltered.title'));
  });

  it('shows the plain empty state with no takes at all', async () => {
    const services: HistoryServices = { configs: cfg, repos: memoryRepos(), localDay: () => '2026-02-01' };
    await renderAt('#/history', services);
    expect(document.body.textContent).toContain(copy('empty.history.title'));
  });
});

describe('AttemptScreen', () => {
  it('shows the read-only results for a take, with a play-again action when wired', async () => {
    const repos = await seed(1, () => ({ score: makeScore(84, true) }));
    const [only] = await repos.attempts.all();
    const played: string[] = [];
    const profile = makeProfile();
    const services: HistoryServices = {
      configs: cfg,
      repos,
      localDay: () => '2026-02-01',
      profile: { get: () => profile, subscribe: () => () => undefined },
      playAgain: (r) => played.push(r.id),
    };
    await renderAt(`#/history/${only!.id}`, services);
    expect(document.querySelector('[data-testid="screen-history.attempt"]')).not.toBeNull();
    expect(document.body.textContent).toContain(creditLine(only!.credit));
    const again = [...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.playThisAgain'));
    expect(again).toBeDefined();
    click(again!);
    expect(played).toEqual([only!.id]);
  });

  it('says so when the take is not on this device', async () => {
    const services: HistoryServices = { configs: cfg, repos: memoryRepos(), localDay: () => '2026-02-01' };
    await renderAt('#/history/missing', services);
    expect(document.body.textContent).toContain(text('history.notFound'));
  });

  it('omits the play-again action when no handler is provided', async () => {
    const repos = await seed(1, () => ({ score: makeScore(70, true) }));
    const [only] = await repos.attempts.all();
    const services: HistoryServices = { configs: cfg, repos, localDay: () => '2026-02-01' };
    await renderAt(`#/history/${only!.id}`, services);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === copy('action.playThisAgain'))).toBe(false);
  });

  it('opens the source sheet from the attempt header', async () => {
    const repos = await seed(1, () => ({ score: makeScore(70, true) }));
    const [only] = await repos.attempts.all();
    const services: HistoryServices = { configs: cfg, repos, localDay: () => '2026-02-01' };
    await renderAt(`#/history/${only!.id}`, services);
    const open = document.querySelector<HTMLButtonElement>('.hist-credit');
    expect(open).toBeDefined();
    act(() => open!.click());
    await flush();
    expect(document.querySelector('[data-testid="source-sheet"]')).not.toBeNull();
  });
});

describe('historyScreenOverrides', () => {
  it('replaces the history and attempt placeholders', () => {
    const services: HistoryServices = { configs: cfg, repos: memoryRepos(), localDay: () => '2026-02-01' };
    const table = createRouteTable(historyScreenOverrides(services));
    expect(table.find((r) => r.id === 'history')?.Screen).not.toBe(PlaceholderScreen);
    expect(table.find((r) => r.id === 'history.attempt')?.Screen).not.toBe(PlaceholderScreen);
  });
});
