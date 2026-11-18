// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { makeProfile } from '../../../store/test-data.ts';
import type { Configs, InstrumentProgress, PlayerProfile } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { createRouteTable } from '../../routes.tsx';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import type { ReactElement } from 'react';
import { createProgressScreen } from './index.ts';
import type { ProgressServices } from './services.ts';
import type { Readable } from '../home/services.ts';
import { text } from './text.ts';
import { progressScreenOverrides } from './index.ts';
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

function store<T>(init: T): Readable<T> {
  return { get: () => init, subscribe: () => () => undefined };
}

function progress(over: Partial<InstrumentProgress> = {}): InstrumentProgress {
  return {
    level: 2, window: [], attemptsRanked: 0, bestByLevel: {}, patternCounts: {}, recentPrimaryPatterns: [],
    tuningOffsetCents: null, offerSuppressedUntil: null, pendingOffer: null, autoLevelUpUndo: null,
    autoRun: { count: 0, atMidTempo: 0 }, placement: null, ...over,
  };
}

const source: LocationSource = { getHash: () => '#/progress', subscribe: () => () => undefined, navigate: () => undefined };

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

function renderWith(profile: PlayerProfile | undefined): HTMLElement {
  const services: ProgressServices = { configs: cfg, profile: store(profile) };
  const table = createRouteTable({ progress: createProgressScreen(services) });
  m = mount(
    <RouterProvider table={table} dev={false} source={source}>
      <ProgressRoute />
    </RouterProvider>,
  );
  return m.container;
}

function ProgressRoute(): ReactElement {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

describe('ProgressScreen', () => {
  it('shows the empty state before the first take', () => {
    const el = renderWith(undefined);
    expect(el.querySelector('[data-testid="screen-progress"]')).not.toBeNull();
    expect(el.textContent).toContain(copy('empty.progress.title'));
  });

  it('shows the rank header, the ten-rung ladder with the current rank ringed, and the streak', () => {
    const profile = makeProfile({ rank: 3, xp: 1200, streak: { days: 6, lastDay: '2026-01-02' } });
    const el = renderWith(profile);
    expect(el.querySelector('.prog-rank-name')?.textContent).toBe(cfg.progression.ranks.table[2]?.name);
    const rungs = el.querySelectorAll('.prog-rung');
    expect(rungs).toHaveLength(cfg.progression.ranks.table.length);
    expect(rungs[2]?.getAttribute('data-state')).toBe('current');
    expect(rungs[0]?.getAttribute('data-state')).toBe('achieved');
    expect(rungs[9]?.getAttribute('data-state')).toBe('future');
    expect(el.textContent).toContain(text('progress.streak.days', { n: 6 }));
    expect(el.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('shows the level window with pass marks and best scores for an instrument', () => {
    const pass = cfg.progression.levelWindow.offer.score;
    const profile = makeProfile({
      activeInstrumentId: 'flute',
      instruments: {
        flute: progress({
          level: 4,
          attemptsRanked: 5,
          window: [{ attemptId: 'a', score: pass, atMidTempo: true }, { attemptId: 'b', score: pass - 20, atMidTempo: false }],
          bestByLevel: { 3: 80, 4: 91 },
        }),
      },
    });
    const el = renderWith(profile);
    const squares = el.querySelectorAll('.prog-window-square');
    expect(squares).toHaveLength(cfg.progression.levelWindow.size);
    expect(el.querySelectorAll('.prog-window-square[data-state="pass"]')).toHaveLength(1);
    expect(el.querySelectorAll('.prog-window-tempo')).toHaveLength(1);
    expect(el.textContent).toContain(copy('progress.instrumentLevel', { level: 4 }));
    expect(el.textContent).toContain(text('progress.best', { level: 4, score: 91 }));
  });

  it('shows the slips empty state under three ranked takes and a list from three', () => {
    const few = renderWith(makeProfile({ activeInstrumentId: 'flute', instruments: { flute: progress({ attemptsRanked: 2, patternCounts: { E1: 4 } }) } }));
    expect(few.querySelector('.prog-slip-list')).toBeNull();
    expect(few.textContent).toContain(copy('empty.slips.title'));
    m?.unmount();
    m = null;
    const many = renderWith(makeProfile({ activeInstrumentId: 'flute', instruments: { flute: progress({ attemptsRanked: 3, patternCounts: { E1: 4 } }) } }));
    const rows = many.querySelectorAll('.prog-slip');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain(text('progress.slips.times', { n: 4 }));
  });
});

describe('progressScreenOverrides', () => {
  it('replaces the progress placeholder in the route table', () => {
    const services: ProgressServices = { configs: cfg, profile: store(undefined) };
    const table = createRouteTable(progressScreenOverrides(services));
    const route = table.find((r) => r.id === 'progress');
    expect(route?.Screen).not.toBe(PlaceholderScreen);
  });
});
