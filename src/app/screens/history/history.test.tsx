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
import { createStore } from 'zustand/vanilla';
import type { SoundView } from '../../../session/index.ts';
import type { AttemptServices } from './AttemptScreen.tsx';
import type { ReviewExtras } from '../results/review/index.ts';
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
    // Round 2: the day heading counts its tries, with the one definition (compose/tries.ts).
    const day = localDayOf(newest.createdAt);
    const sameDay = (await repos.attempts.all()).filter((a) => localDayOf(a.createdAt) === day).length;
    expect(document.querySelector('.hist-day-heading')?.textContent).toBe(copy('history.day', { day: copy('history.day.today'), n: sameDay }));
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

describe('history row format', () => {
  it('reads "Instrument · Difficulty n · key · meter · ♩ = bpm" with the served meter', async () => {
    const repos = await seed(3, (i) => ({
      instrumentId: ['voice-baritone', 'flute', 'violin'][i]!,
      levelServed: 2,
      bpm: 71,
      settingsResolved: { ...makeAttempt(i).settingsResolved, meter: ['4/4', 'random', '6/8'][i]! },
    }));
    const services: HistoryServices = {
      configs: cfg,
      repos,
      localDay: () => '2026-02-01',
      // The random-meter take was served in 3/4.
      preparedFor: async () => ({ meter: { beats: 3, beatType: 4 } }) as never,
    };
    await renderAt('#/history', services);
    const lines = [...document.querySelectorAll('[data-testid="history-row"] [data-testid="meta-line"]')].map((e) => e.textContent);
    expect(lines).toHaveLength(3);
    expect(lines).toContain('Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71');
    expect(lines).toContain('Flute · Difficulty 2 · C major · 3/4 · ♩ = 71');
    expect(lines).toContain('Violin · Difficulty 2 · C major · 6/8 · ♩. = 71');
    expect(lines.join('')).not.toContain('random');
  });

  it('leaves the meter out rather than print random when the excerpt cannot be read', async () => {
    const repos = await seed(1, () => ({ instrumentId: 'flute', levelServed: 1, bpm: 71, settingsResolved: { ...makeAttempt(0).settingsResolved, meter: 'random' } }));
    await renderAt('#/history', { configs: cfg, repos, localDay: () => '2026-02-01' });
    expect(document.querySelector('[data-testid="meta-line"]')?.textContent).toBe('Flute · Difficulty 1 · C major · ♩ = 71');
  });

  it('shows the error line when the takes cannot be read', async () => {
    const repos = memoryRepos();
    repos.attempts.list = () => Promise.reject(new Error('x'));
    await renderAt('#/history', { configs: cfg, repos, localDay: () => '2026-02-01' });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(text('history.error'));
  });
});

describe('attempt detail: title, score and Listen', () => {
  const idle = (): SoundView => ({ playing: null, caption: null, bar: null, fromBar: null, slower: false, attemptId: null, failed: false, startsAt: null, endsAt: null });
  const prepared = { meter: { beats: 4, beatType: 4 }, measures: [{ displayBar: 1 }, { displayBar: 2 }, { displayBar: 3 }] };

  async function open(extra: Partial<AttemptServices> = {}) {
    const repos = await seed(1, () => ({ instrumentId: 'voice-baritone', score: makeScore(84, true), bpm: 71 }));
    const [only] = await repos.attempts.all();
    const sounds = createStore<SoundView>()(() => idle());
    const calls: { id: string; o: { fromBar?: number; slower?: boolean } }[] = [];
    let stops = 0;
    let extras: ReviewExtras = {};
    const services: AttemptServices = {
      configs: cfg,
      repos,
      localDay: () => '2026-02-01',
      sounds,
      preparedFor: async () => prepared as never,
      listen: async (r, o) => {
        calls.push({ id: r.id, o });
      },
      stopSounds: () => {
        stops++;
      },
      renderReview: (_r, e) => {
        extras = e;
        return (
          <div data-testid="fake-review">
            {e.toolbarEnd}
            {e.caption}
          </div>
        );
      },
      ...extra,
    };
    await renderAt(`#/history/${only!.id}`, services);
    return { only: only!, sounds, calls, stops: () => stops, extras: () => extras };
  }

  it('has a plain title, not a link, and the one-line summary', async () => {
    await open();
    const title = document.querySelector('[data-testid="attempt-title"]')!;
    expect(title.tagName).toBe('H1');
    expect(title.textContent).toBe('Work 0');
    expect(title.closest('a')).toBeNull();
    expect(title.querySelector('a')).toBeNull();
    expect(document.querySelector('.hist-attempt-meta')?.textContent).toBe('Baritone voice · Difficulty 1 · C major · 4/4 · ♩ = 71');
  });

  it('puts Listen and Slower in the score toolbar and starts the take from bar 1', async () => {
    const t = await open();
    expect(document.querySelector('[data-testid="fake-review"] [data-testid="listen-controls"]')).not.toBeNull();
    const listen = q<HTMLButtonElement>('[data-testid="listen-button"]');
    expect(listen.textContent).toBe(copy('action.listen'));
    click(listen);
    expect(t.calls).toEqual([{ id: t.only.id, o: { slower: false } }]);
  });

  it('Slower asks for 75% and a tapped bar sets where Listen starts', async () => {
    const t = await open();
    click(q('[role="switch"]'));
    act(() => t.extras().onBarTap?.(2));
    expect(t.extras().highlightBar).toBe(2);
    expect(document.querySelector('.hist-from-bar')?.textContent).toBe(copy('listen.fromBar', { n: 3 }));
    click(q('[data-testid="listen-button"]'));
    expect(t.calls[0]?.o).toEqual({ slower: true, fromBar: 3 });
  });

  it('reads Stop with the live caption while it plays, and Stop stops at once', async () => {
    const t = await open();
    act(() => t.sounds.setState({ playing: 'listen', attemptId: t.only.id, bar: 2, caption: { kind: 'bar', bar: 2, of: 8 } }));
    const btn = q<HTMLButtonElement>('[data-testid="listen-button"]');
    expect(btn.textContent).toBe(copy('action.stop'));
    expect(document.querySelector('[data-testid="live-caption"]')?.textContent).toContain(copy('listen.playing', { n: 2, total: 8 }));
    click(btn);
    expect(t.stops()).toBe(1);
  });

  it('ignores a sound that belongs to another take, and shows a failed sound', async () => {
    const t = await open();
    act(() => t.sounds.setState({ playing: 'listen', attemptId: 'someone-else' }));
    expect(q<HTMLButtonElement>('[data-testid="listen-button"]').textContent).toBe(copy('action.listen'));
    act(() => t.sounds.setState({ playing: null, attemptId: null, failed: true }));
    expect(document.querySelector('[data-testid="live-caption"]')?.textContent).toContain(copy('sound.failed'));
  });

  it('shows no score and no Listen when the excerpt is not available', async () => {
    await open({ preparedFor: async () => null });
    expect(document.querySelector('[data-testid="fake-review"]')).toBeNull();
    expect(document.querySelector('[data-testid="listen-controls"]')).toBeNull();
  });

  it('stops the sound when leaving the screen', async () => {
    const t = await open();
    m?.unmount();
    m = null;
    expect(t.stops()).toBeGreaterThan(0);
  });

  it('shows the error line when the take cannot be read, with a way back', async () => {
    const repos = memoryRepos();
    repos.attempts.byId = () => Promise.reject(new Error('x'));
    await renderAt('#/history/x', { configs: cfg, repos, localDay: () => '2026-02-01' });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(text('history.error'));
    expect(document.body.textContent).toContain(text('history.backToList'));
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

describe('round 2: rows, This piece and the day count', () => {
  /** Today: 2 graded and 1 not graded tries, plus 1 stopped before bar 1; yesterday: 1. Two today at ex-1. */
  async function seedDay() {
    const repos = memoryRepos();
    const at = (i: number, iso: string, over: Partial<AttemptRecord>) => repos.attempts.add(makeAttempt(i, { createdAt: iso, ...over }));
    await at(0, '2026-02-02T09:00:00.000Z', { excerptId: 'ex-1', score: makeScore(84, false), endReason: 'complete' });
    await at(1, '2026-02-02T09:05:00.000Z', { excerptId: 'ex-1', score: makeScore(71, false), endReason: 'complete' });
    await at(2, '2026-02-02T09:10:00.000Z', { excerptId: 'ex-2', score: null, endReason: 'void', voidReason: 'no-signal' });
    await at(3, '2026-02-02T09:15:00.000Z', { excerptId: 'ex-2', score: null, endReason: 'void', voidReason: 'stopped-before-first-note' });
    await at(4, '2026-02-01T09:00:00.000Z', { excerptId: 'ex-3', score: makeScore(80, false), endReason: 'complete' });
    return repos;
  }
  const today = localDayOf('2026-02-02T09:00:00.000Z');

  it('shows the grade and score, or "Not graded" in words, never a dash', async () => {
    const repos = await seedDay();
    await renderAt('#/history', { configs: cfg, repos, localDay: () => today });
    const grades = [...document.querySelectorAll('[data-testid="history-grade"]')].map((g) => g.textContent);
    expect(grades).toContain('B84');
    expect(grades).toContain(copy('history.notGraded'));
    expect(document.querySelector('[data-testid="history-row"]')?.textContent).not.toContain('–');
  });

  it('counts the day with the one definition of a try: the same count as the Practice header and streak line', async () => {
    const repos = await seedDay();
    await renderAt('#/history', { configs: cfg, repos, localDay: () => today });
    await flush();
    const records = await repos.attempts.all();
    // compose/tries.ts is what app-services counts `today.tries` with (Practice header and streak line).
    const { triesOnDay } = await import('../../compose/tries.ts');
    const n = triesOnDay(records, today, localDayOf);
    expect(n).toBe(3);
    const headings = [...document.querySelectorAll('[data-testid="history-day-heading"]')].map((h) => h.textContent);
    expect(headings[0]).toBe(copy('history.day', { day: copy('history.day.today'), n }));
    expect(headings[1]).toBe(copy('history.day', { day: copy('history.day.yesterday'), n: 1 }));
  });

  it('"This piece" from results: the chip, the line, the rows at the piece and "3 tries, 2 at this piece"', async () => {
    const repos = await seedDay();
    window.location.hash = '#/history?piece=ex-1';
    const src = await renderAt('#/history?piece=ex-1', { configs: cfg, repos, localDay: () => today });
    await flush();
    expect(document.querySelectorAll('[data-testid="history-row"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="history-piece-chip"]')?.textContent).toContain(copy('history.filter.piece'));
    expect(document.querySelector('[data-testid="history-piece-line"]')?.textContent).toContain(copy('history.filter.pieceLine', { n: 2, total: 4, title: 'Work 1' }));
    expect(document.querySelector('[data-testid="history-day-heading"]')?.textContent).toBe(copy('history.day.piece', { day: copy('history.day.today'), n: 3, m: 2 }));
    click(q('[data-testid="history-piece-chip"]'));
    await flush();
    expect(src.navigated).toContain('/history');
    expect(document.querySelectorAll('[data-testid="history-row"]')).toHaveLength(5);
  });
});

describe('round 2: try detail', () => {
  const idle = (): SoundView => ({ playing: null, caption: null, bar: null, fromBar: null, slower: false, attemptId: null, failed: false, startsAt: null, endsAt: null });
  const prepared = { meter: { beats: 4, beatType: 4 }, measures: [{ displayBar: 1 }, { displayBar: 2 }, { displayBar: 3 }] };

  async function three() {
    const repos = memoryRepos();
    for (let i = 0; i < 3; i++) await repos.attempts.add(makeAttempt(i, { createdAt: `2026-02-02T09:0${i}:00.000Z`, excerptId: 'ex-1', score: makeScore(80 + i, false), endReason: 'complete' }));
    await repos.attempts.add(makeAttempt(3, { createdAt: '2026-02-02T09:04:00.000Z', excerptId: 'ex-1', score: null, endReason: 'void', voidReason: 'stopped-before-first-note' }));
    await repos.attempts.add(makeAttempt(4, { createdAt: '2026-02-02T09:05:00.000Z', excerptId: 'ex-9', score: makeScore(90, false), endReason: 'complete' }));
    return repos;
  }

  async function open(id: string, extra: Partial<AttemptServices> = {}) {
    const repos = await three();
    const sounds = createStore<SoundView>()(() => idle());
    const heard: string[] = [];
    const services: AttemptServices = {
      configs: cfg,
      repos,
      localDay: () => '2026-02-02',
      sounds,
      preparedFor: async () => prepared as never,
      listen: async () => undefined,
      playHeard: async (aid) => {
        heard.push(aid);
      },
      stopSounds: () => undefined,
      renderReview: (_r, e) => (
        <div data-testid="fake-review">
          {e.toolbarEnd}
          <div data-testid="fake-caption-line">{e.caption}</div>
        </div>
      ),
      ...extra,
    };
    const src = await renderAt(`#/history/${id}`, services);
    await flush();
    return { repos, sounds, heard, src };
  }
  const idOf = (i: number) => makeAttempt(i).id;

  it('reads "Try 2 of 3 at this piece" (a try stopped before bar 1 is not one) and steps to the neighbours', async () => {
    const t = await open(idOf(1));
    expect(document.querySelector('[data-testid="try-of"]')?.textContent).toBe(copy('history.tryOf', { n: 2, total: 3 }));
    click(q('[data-testid="previous-try"]'));
    click(q('[data-testid="next-try"]'));
    expect(t.src.navigated).toEqual([`/history/${idOf(0)}`, `/history/${idOf(2)}`]);
  });

  it('the first try has no previous; a lone try shows no stepper', async () => {
    await open(idOf(0));
    expect(q('[data-testid="previous-try"]').getAttribute('aria-disabled')).toBe('true');
    m?.unmount();
    m = null;
    await open(idOf(4));
    expect(document.querySelector('[data-testid="try-nav"]')).toBeNull();
  });

  it('"Hear what we heard" plays the try, reads Stop while it plays, and captions "What we heard, bar n of m" on the reserved line', async () => {
    const t = await open(idOf(1));
    const hear = q<HTMLButtonElement>('[data-testid="hear-button"]');
    expect(hear.textContent).toBe(copy('action.hearWhatWeHeard'));
    // The unseen face holds the width of "Stop", so swapping labels moves nothing.
    expect(hear.querySelector('.hist-steady-alt')?.getAttribute('data-alt')).toBe(copy('action.stop'));
    click(hear);
    expect(t.heard).toEqual([idOf(1)]);
    act(() => t.sounds.setState({ playing: 'heard', attemptId: idOf(1), bar: 3, caption: { kind: 'heard-bar', bar: 3, of: 8 } }));
    expect(q('[data-testid="hear-button"]').textContent).toBe(copy('action.stop'));
    expect(q('[data-testid="hear-button"]').getAttribute('data-playing')).toBe('true');
    expect(q('[data-testid="listen-button"]').textContent).toBe(copy('action.listen'));
    const line = q('[data-testid="fake-caption-line"]');
    expect(line.textContent).toContain(copy('heard.caption', { n: 3, total: 8 }));
    expect(line.textContent).toContain(copy('heard.caption.note'));
  });

  it('says "We didn\'t hear any notes" when there is nothing to play', async () => {
    await open(idOf(1), {
      playHeard: () => Promise.reject(new Error('no-notes')),
    });
    click(q('[data-testid="hear-button"]'));
    await flush();
    expect(q('[data-testid="fake-caption-line"]').textContent).toContain(copy('heard.none'));
  });

  it('ends "How it went" with the sure line and the diagnostics button', async () => {
    const diagnostics = {
      supportAddress: null,
      soundOptInShown: true,
      exportTry: async () => null,
      exportLast: async () => null,
      exportRecent: async () => null,
      settings: async () => ({ includeAudio: false }),
      setSettings: async () => undefined,
    };
    await open(idOf(1), { diagnostics });
    expect(document.querySelector('[data-testid="attempt-sure"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="attempt-diagnostics"]')?.textContent).toContain(copy('diagnostics.prompt'));
  });
});
