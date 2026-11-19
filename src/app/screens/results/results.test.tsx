// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, AttemptRecord, PlayerProfile, ProgressEvent } from '../../../core/types.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import type { Readable, Writable } from '../home/services.ts';
import {
  badgesFor,
  componentRows,
  countParts,
  creditLine,
  diagnosticLines,
  focusComponent,
  levelCards,
  manyRejudged,
  rankBar,
  tipPreview,
  typicalTiming,
  xpView,
} from './model.ts';
import { ResultsPanel } from './ResultsPanel.tsx';
import { createResultsScreen } from './index.ts';
import type { ResultsServices } from './services.ts';
import { attemptFrom, cfg, makeProfile, sessionStore, tipsFor } from './test-data.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = q<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label || x.getAttribute('aria-label') === label);
  if (!b) throw new Error(`no button ${label}`);
  return b as HTMLButtonElement;
};

function box<T>(init: T): Writable<T> {
  let v = init;
  const ls = new Set<() => void>();
  return {
    get: () => v,
    set(n) {
      v = n;
      ls.forEach((l) => l());
    },
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
  };
}

describe('rank bar (04 5.5.4): fill = (xp - current) / (next - current)', () => {
  const profiles: [number, number, number, number][] = [
    // rank, xp, fraction x 1000, percent
    [1, 0, 0, 0],
    [2, 650, 500, 50],
    [3, 2180, 787, 79],
    [4, 2500, 0, 0],
    [10, 60000, 1000, 100],
  ];
  it.each(profiles)('rank %i with %i XP', (rank, xp, milli, pct) => {
    const bar = rankBar(cfg, { rank, xp });
    expect(Math.round(bar.fraction * 1000)).toBe(milli);
    expect(Math.round(bar.fraction * 100)).toBe(pct);
  });

  it('reads the wireframe line for Student at 2,180 XP', () => {
    expect(rankBar(cfg, { rank: 3, xp: 2180 }).label).toBe('Student · Rank 3 of 10 · 2,180 of 2,500 XP to Section player');
  });

  it('is full and asks for the level when XP is reached but the rank is not', () => {
    const bar = rankBar(cfg, { rank: 3, xp: 2600 });
    expect(bar.fraction).toBe(1);
    expect(bar.needsLevel).toBe(true);
    expect(bar.label).toContain(copy('rank.bar.needsLevel', { level: 4 }));
  });
});

describe('model over fixtures/grade', () => {
  it('focus is the component with the most lost points, not the lowest value', () => {
    const rec = attemptFrom('case02-late-30ms-l1');
    const s = rec.score!;
    // Force P low but lightly weighted: R loses more points.
    const forced = { ...s, components: { P: 40, I: 90, R: 70 }, weights: { P: 0.1, I: 0.3, R: 0.6 } };
    expect(focusComponent(forced)).toBe('R');
    expect(focusComponent({ ...s, components: { P: 100, I: 100, R: 100 } })).toBeNull();
  });

  it('hides In tune for fixed-pitch instruments and uses the keyboard rhythm explainer', () => {
    const rec = attemptFrom('case02-late-30ms-l1');
    const piano = { ...cfg.instrumentById['piano-rh']! };
    const rows = componentRows(rec, piano);
    expect(rows.map((r) => r.id)).toEqual(['P', 'R']);
    expect(rows[1]!.explainer).toBe(copy('component.rhythm.keyboard'));
  });

  it('shows I as unavailable when it is null', () => {
    const rec = attemptFrom('case13-short-steady-flute');
    const rows = componentRows({ ...rec, score: { ...rec.score!, components: { ...rec.score!.components, I: null } } }, cfg.instrumentById['flute']);
    expect(rows.find((r) => r.id === 'I')!.value).toBeNull();
    expect(rows.find((r) => r.id === 'I')!.unavailableText).toBe(copy('component.inTune.notEnough'));
  });

  it('builds diagnostics lines for a stop and for drift', () => {
    const stop = attemptFrom('case06-stop-2-beats-bar-5').score!;
    expect(stop.diagnostics.stops.length).toBeGreaterThan(0);
    expect(diagnosticLines(stop).some((l) => l.startsWith('Stops:'))).toBe(true);
    const drift = attemptFrom('case04-drift-0.15').score!;
    expect(diagnosticLines(drift).some((l) => /^You (slowed down|sped up) slightly by the end$/.test(l))).toBe(true);
    const restart = attemptFrom('case11-restart').score!;
    expect(diagnosticLines(restart).some((l) => l.startsWith('Restarted at bar'))).toBe(true);
  });

  it('omits diagnostics on a clean take', () => {
    expect(diagnosticLines(attemptFrom('case01-perfect-flute-l4').score!)).toEqual([]);
  });

  it('the counts line comes from diagnostics.counts and drops zero parts', () => {
    const s = attemptFrom('case09-trumpet-wrong-partial').score!;
    const parts = countParts(s);
    expect(parts[0]!.label).toBe(copy('results.counts.total', { n: s.diagnostics.n }));
    expect(parts[1]!.kind).toBe('correct');
    expect(parts.every((p) => p.kind === 'total' || p.kind === 'correct' || p.n > 0)).toBe(true);
    expect(parts.find((p) => p.kind === 'wrong')!.n).toBe(s.diagnostics.counts.wrong + s.diagnostics.counts.octave);
  });

  it('typical timing is the median error and its side', () => {
    const rec = attemptFrom('case02-late-30ms-l1');
    const t = typicalTiming(rec);
    if (t) expect(t.side).toBe('behind');
    const fake = { ...rec, judgments: rec.judgments.map((j, i) => (i < 3 ? { ...j, status: 'matched' as const, timing: 'late' as const, timingErrorMs: 40 + i * 10 } : j)) };
    expect(typicalTiming(fake)).toEqual({ ms: expect.any(Number), side: 'behind' });
  });

  it('badges: ranked, practice with the first reason, incomplete, timing offset, beta', () => {
    const ranked = attemptFrom('case01-perfect-flute-l4');
    expect(badgesFor(ranked, cfg).map((b) => b.kind)).toEqual(['ranked']);
    const practice = { ...ranked, beta: true, score: { ...ranked.score!, ranked: false, rankedReasons: ['calibration', 'familiar'] as const } } as unknown as AttemptRecord;
    const b = badgesFor(practice, cfg);
    expect(b.map((x) => x.kind)).toEqual(['practice', 'beta']);
    expect(b[0]!.detail).toBe(copy('ranked.reason.calibration'));
    expect(b[0]!.tooltip).toBe(copy('ranked.reason.familiar'));
    const incomplete = attemptFrom('case10-incomplete');
    expect(incomplete.score!.status).toBe('incomplete');
    expect(badgesFor(incomplete, cfg).some((x) => x.kind === 'incomplete' && x.detail === copy('badge.incomplete.tooltip', { cap: 50 }))).toBe(true);
    const reported = attemptFrom('case14-reported-calibration', { calibration: { method: 'reported', latencyCompensationMs: 40, outputMode: 'speakers', recheck: null } });
    expect(badgesFor(reported, cfg).some((x) => x.kind === 'timing-offset')).toBe(true);
  });

  it('xp: factors not equal to 1.00, base first, practice and repeat variants', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const v = xpView(rec, cfg, makeProfile({ streak: { days: 6, lastDay: '2026-01-02' } }));
    expect(v.headline).toBe(copy('xp.headline', { xp: rec.score!.xp.total }));
    expect(v.factors[0]).toBe(copy('xp.factor.levelBase', { level: rec.levelServed, value: rec.score!.xp.base }));
    for (const line of v.factors) expect(line).not.toMatch(/×1\.00$/);
    const practice: AttemptRecord = { ...rec, score: { ...rec.score!, xp: { total: 8, base: 34, factors: [{ id: 'practice', value: 0.25 }] } } };
    expect(xpView(practice, cfg, undefined).headline).toBe('+8 XP (practice earns 25% of the XP)');
    const repeat: AttemptRecord = { ...rec, score: { ...rec.score!, xp: { total: 0, base: 34, factors: [{ id: 'repeat', value: 0 }] } } };
    expect(xpView(repeat, cfg, undefined).headline).toBe(copy('xp.none.repeat'));
    const inc = attemptFrom('case10-incomplete');
    expect(xpView(inc, cfg, undefined).headline).toBe(copy('xp.none.incomplete'));
    expect(xpView({ ...rec, listening: false, score: null }, cfg, undefined).headline).toBeNull();
  });

  it('xp lists streak, below-level and daily-cap factors from the spec', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const factors = [
      { id: 'q', value: 0.85 },
      { id: 'm_streak', value: 1.12 },
      { id: 'm_below', value: 0.25 },
      { id: 'm_daily', value: 0.25 },
      { id: 'm_random', value: 1.08 },
    ];
    const withKey: AttemptRecord = { ...rec, settingsResolved: { ...rec.settingsResolved, writtenKey: 'random' as never }, score: { ...rec.score!, xp: { total: 3, base: 34, factors } } };
    const lines = xpView(withKey, cfg, makeProfile({ streak: { days: 6, lastDay: null } })).factors;
    expect(lines).toContain('Score ×0.85');
    expect(lines).toContain('Streak 6 days ×1.12');
    expect(lines).toContain('Below your difficulty ×0.25');
    expect(lines).toContain('Over 60 takes today ×0.25');
    expect(lines).toContain('Any key ×1.08');
  });

  it('level cards come from progress events for this instrument only', () => {
    const events: ProgressEvent[] = [
      { type: 'level-up-offer', instrumentId: 'flute', from: 5, to: 6 },
      { type: 'level-up-auto', instrumentId: 'flute', from: 5, to: 6 },
      { type: 'level-down-suggestion', instrumentId: 'flute', level: 6 },
      { type: 'level-up-offer', instrumentId: 'violin', from: 1, to: 2 },
    ];
    const cards = levelCards(events, 'flute', cfg);
    expect(cards.map((c) => c.text)).toEqual([
      "You're reading difficulty 5 well. Move up to difficulty 6?",
      'Moved up to difficulty 6: 8 takes in a row at 90 or more.',
      'Difficulty 6 has been a stretch lately. A few takes at difficulty 5 can build the reading back up.',
    ]);
  });

  it('credit line follows the header format and adds corpus and Adapted for CC BY', () => {
    const base = { composer: 'Schubert', composerDates: '1797–1828', work: 'Heidenröslein', catalog: 'D 257', sourceMeasures: [1, 8] as [number, number], corpus: 'openscore-lieder' as const, license: 'CC0-1.0' as const };
    expect(creditLine(base)).toBe('Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0');
    expect(creditLine({ ...base, license: 'CC-BY-4.0' })).toBe('Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC BY 4.0 · OpenScore Lieder · Adapted');
    const { composerDates: _d, catalog: _c, ...bare } = base;
    expect(creditLine(bare)).toBe('Schubert · Heidenröslein · bars 1–8 · CC0');
  });

  it('many re-judged notes (over 10%) raise the banner flag', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    expect(manyRejudged(rec)).toBe(false);
    const n = rec.judgments.length;
    const rej = { ...rec, judgments: rec.judgments.map((j, i) => ({ ...j, rejudged: i < Math.ceil(n * 0.2) })) };
    expect(manyRejudged(rej)).toBe(true);
  });

  it('tip preview uses the pattern name, never more than the primary tip', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const tips = tipsFor(rec);
    const p = tipPreview(cfg, tips);
    if (tips.length) {
      expect(p!.line.startsWith('Tip: ')).toBe(true);
      expect(p!.evidence).toMatch(/\d/);
    } else expect(p).toBeNull();
  });
});

describe('ResultsPanel', () => {
  const render = (props: Partial<Parameters<typeof ResultsPanel>[0]> & { record: AttemptRecord }): void => {
    m = mount(<ResultsPanel configs={cfg} {...props} />);
  };

  it('shows the grade block with its accessible name, stars, badge and grade line', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const s = rec.score!;
    render({ record: rec, profile: makeProfile({ xp: 2180, rank: 3 }) });
    const name = copy('a11y.grade.heading', { grade: s.grade, score: s.score, stars: s.stars });
    expect(document.querySelector(`[aria-label="${name}"]`)).toBeTruthy();
    expect($('.res-badge[data-kind="ranked"]').textContent).toContain(copy('badge.ranked'));
    expect(document.body.textContent).toContain(copy(`grade.${s.grade}`));
  });

  it('shows three component bars, expandable, with the focus tag on the biggest loss', () => {
    const rec = attemptFrom('case07-voice-30c-flat');
    render({ record: rec });
    const rows = [...document.querySelectorAll('.dom-cbar')];
    expect(rows).toHaveLength(3);
    const labels = rows.map((r) => r.querySelector('.dom-cbar-label')?.textContent ?? '');
    expect(labels[0]).toContain(copy('component.notes.label'));
    expect(labels[1]).toContain(copy('component.inTune.label'));
    expect(labels[2]).toContain(copy('component.rhythm.label'));
    expect(document.querySelectorAll('.dom-cbar[data-focus="true"]')).toHaveLength(1);
    const toggle = rows[0]!.querySelector('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders diagnostics as plain text lines, not bars', () => {
    render({ record: attemptFrom('case06-stop-2-beats-bar-5') });
    const lines = [...document.querySelectorAll('.res-diagnostics li')].map((l) => l.textContent);
    expect(lines.some((l) => l?.startsWith('Stops: '))).toBe(true);
    expect(document.querySelectorAll('.res-diagnostics .dom-cbar')).toHaveLength(0);
  });

  it('counts are buttons only when a verdict handler exists, and the re-judged button follows', () => {
    const rec = attemptFrom('case09-trumpet-wrong-partial');
    render({ record: rec });
    expect(document.querySelectorAll('.res-count-button')).toHaveLength(0);
    m?.unmount();
    const onSelectVerdict = vi.fn();
    const onShowRejudged = vi.fn();
    const rej = { ...rec, judgments: rec.judgments.map((j, i) => ({ ...j, rejudged: i === 0 })) };
    render({ record: rej, onSelectVerdict, onShowRejudged });
    click($('.res-count-button[data-count="correct"]'));
    expect(onSelectVerdict).toHaveBeenCalledWith('correct');
    click($('.res-count-button[data-count="rejudged"]'));
    expect(onShowRejudged).toHaveBeenCalled();
    expect($('.res-count-button[data-count="rejudged"]').textContent).toBe(copy('results.rejudged', { n: 1 }));
  });

  it('incomplete: badge text with the cap, no XP value, tip line allowed', () => {
    render({ record: attemptFrom('case10-incomplete') });
    expect(document.body.textContent).toContain(copy('badge.incomplete.tooltip', { cap: 50 }));
    expect($('[data-testid="res-xp"]').textContent).toContain(copy('xp.none.incomplete'));
  });

  it('practice badge shows the reason; the XP line is the practice line', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const practice: AttemptRecord = { ...rec, score: { ...rec.score!, ranked: false, rankedReasons: ['practice-mode'], xp: { total: 8, base: 34, factors: [{ id: 'practice', value: 0.25 }] } } };
    render({ record: practice });
    expect($('.res-badge[data-kind="practice"]').textContent).toContain(copy('ranked.reason.practice-mode'));
    expect($('[data-testid="res-xp"]').textContent).toContain('+8 XP (practice earns 25% of the XP)');
  });

  it('personal best ribbon and the XP factor list expand', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    render({ record: rec, progress: [{ type: 'best', instrumentId: rec.instrumentId, level: 4, score: 100 }] });
    expect($('[data-testid="res-ribbon"]').textContent).toBe('New best at difficulty 4');
    const list = $('#res-xp-factors');
    expect(list.hidden).toBe(true);
    click(button(copy('xp.headline', { xp: 0 }) && 'Details'));
    expect(list.hidden).toBe(false);
  });

  it('rank bar exposes the formula percent', () => {
    render({ record: attemptFrom('case01-perfect-flute-l4'), profile: makeProfile({ xp: 2180, rank: 3 }) });
    const bar = $('.res-rank-track');
    expect(bar.getAttribute('aria-valuenow')).toBe('79');
    expect($('.res-rank-pct').textContent).toBe('79%');
  });

  it('level cards: Move up, Stay, Undo and Go to level call their handlers and disappear', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const h = { onMoveUp: vi.fn(), onStayAt: vi.fn(), onUndoLevelUp: vi.fn(), onGoToLevel: vi.fn() };
    render({
      record: rec,
      progress: [
        { type: 'level-up-offer', instrumentId: 'flute', from: 5, to: 6 },
        { type: 'level-up-auto', instrumentId: 'flute', from: 5, to: 6 },
        { type: 'level-down-suggestion', instrumentId: 'flute', level: 6 },
      ],
      ...h,
    });
    expect(document.querySelectorAll('.res-level-card')).toHaveLength(3);
    click(button(copy('action.moveUp')));
    expect(h.onMoveUp).toHaveBeenCalledWith('flute', 6);
    click(button(copy('action.undo')));
    expect(h.onUndoLevelUp).toHaveBeenCalledWith('flute', 5);
    click(button(copy('action.goToLevel', { level: 5 })));
    expect(h.onGoToLevel).toHaveBeenCalledWith('flute', 5);
    expect(document.querySelectorAll('.res-level-card')).toHaveLength(0);
  });

  it('declining an offer calls stayAt with the current level', () => {
    const onStayAt = vi.fn();
    render({ record: attemptFrom('case01-perfect-flute-l4'), progress: [{ type: 'level-up-offer', instrumentId: 'flute', from: 5, to: 6 }], onStayAt });
    click(button(copy('action.stayAt', { level: 5 })));
    expect(onStayAt).toHaveBeenCalledWith('flute', 5);
  });

  it('actions: Next excerpt and Try again (practice) with its tooltip', () => {
    const onNext = vi.fn();
    const onTryAgain = vi.fn();
    render({ record: attemptFrom('case01-perfect-flute-l4'), onNext, onTryAgain });
    click(button(copy('action.nextExcerpt')));
    click(button(copy('action.tryAgainPractice')));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[title="${copy('results.practice.tooltip')}"]`)).toBeTruthy();
  });

  it('read-only (history) shows only Play this excerpt again, no level cards', () => {
    const onPlayAgain = vi.fn();
    render({
      record: attemptFrom('case01-perfect-flute-l4'),
      readOnly: true,
      onNext: vi.fn(),
      onPlayAgain,
      progress: [{ type: 'level-up-offer', instrumentId: 'flute', from: 5, to: 6 }],
    });
    expect(document.querySelectorAll('.res-level-card')).toHaveLength(0);
    expect(() => button(copy('action.nextExcerpt'))).toThrow();
    click(button(copy('action.playThisAgain')));
    expect(onPlayAgain).toHaveBeenCalled();
  });

  it('a void take has no grade, only the void card with its actions', () => {
    const rec = attemptFrom('case01-perfect-flute-l4', { score: null, endReason: 'void', voidReason: 'no-signal' });
    const onTryAgain = vi.fn();
    const onCheckMicrophone = vi.fn();
    render({ record: rec, onTryAgain, onCheckMicrophone });
    expect(document.querySelector('.dom-grade')).toBeNull();
    expect($('[data-testid="void-no-signal"]')).toBeTruthy();
    click(button(copy('action.checkMicrophone')));
    expect(onCheckMicrophone).toHaveBeenCalled();
  });

  it('practising without listening: Not graded, no XP, no grade block', () => {
    render({ record: attemptFrom('case01-perfect-flute-l4', { listening: false, score: null }), onNext: vi.fn() });
    expect(document.body.textContent).toContain(copy('results.notGraded'));
    expect(document.querySelector('.dom-grade')).toBeNull();
    expect(document.querySelector('[data-testid="res-xp"]')).toBeNull();
  });

  it('clipping, re-judged and recheck-shift banners', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const n = rec.judgments.length;
    const noisy: AttemptRecord = {
      ...rec,
      judgments: rec.judgments.map((j, i) => ({ ...j, rejudged: i < Math.ceil(n * 0.2) })),
      score: { ...rec.score!, diagnostics: { ...rec.score!.diagnostics, signal: { medianClarity: 0.9, clippingFrac: 0.5 } } },
    };
    render({ record: noisy, recalibrate: true, onRecalibrate: vi.fn() });
    expect(document.body.textContent).toContain(copy('results.banner.clipping'));
    expect(document.body.textContent).toContain(copy('results.rejudged.banner'));
    expect(document.body.textContent).toContain(copy('results.banner.recheckShift'));
  });

  it('reopening the same record renders identically', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const props = { record: rec, profile: makeProfile({ xp: 700, rank: 2 }), tips: tipsFor(rec), progress: [] };
    render(props);
    const first = $('[data-testid="results-panel"]').outerHTML;
    m?.unmount();
    render(props);
    expect($('[data-testid="results-panel"]').outerHTML.replace(/_r_[0-9a-z]+_/g, 'ID')).toBe(first.replace(/_r_[0-9a-z]+_/g, 'ID'));
  });
});

// ---- the route screen ---------------------------------------------------------------------

interface Fx {
  services: ResultsServices;
  settings: Writable<AppSettings>;
  hash: { value: string };
  loc: LocationSource;
  calls: string[];
  store: ReturnType<typeof sessionStore>;
}

function fixture(over: { record?: AttemptRecord | null; view?: Parameters<typeof sessionStore>[0]; settings?: Partial<AppSettings>; settleMs?: number } = {}): Fx {
  const record = over.record === undefined ? attemptFrom('case01-perfect-flute-l4') : over.record;
  const store = sessionStore({ record, tips: record ? tipsFor(record) : [], ...(over.view ?? {}) });
  const settings = box<AppSettings>({ ...defaultAppSettings(), ...(over.settings ?? {}) });
  const profile: Readable<PlayerProfile | undefined> = box<PlayerProfile | undefined>(makeProfile({ xp: 2180, rank: 3 }));
  const hash = { value: '#/practice/results' };
  const ls = new Set<() => void>();
  const loc: LocationSource = {
    getHash: () => hash.value,
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
    navigate(path) {
      hash.value = `#${path}`;
      ls.forEach((l) => l());
    },
  };
  const calls: string[] = [];
  const services: ResultsServices = {
    configs: cfg,
    session: store,
    profile,
    settings,
    settleMs: over.settleMs ?? 0,
    actions: {
      moveUp: (i, to) => calls.push(`moveUp ${i} ${to}`),
      stayAt: (i, l) => calls.push(`stayAt ${i} ${l}`),
      undoLevelUp: (i, f) => calls.push(`undo ${i} ${f}`),
      goToLevel: (i, l) => calls.push(`goTo ${i} ${l}`),
    },
  };
  return { services, settings, hash, loc, calls, store };
}

function Outlet() {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

function renderScreen(f: Fx): void {
  const table = createRouteTable({ 'practice.results': createResultsScreen(f.services) });
  m = mount(
    <RouterProvider table={table} source={f.loc}>
      <Outlet />
    </RouterProvider>,
  );
}

const settle = (ms = 5): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('ResultsScreen', () => {
  it('shows the credit header, the panel and a Home link', () => {
    const f = fixture();
    renderScreen(f);
    expect($('.res-credit').textContent).toBe(creditLine(f.store.getState().record!.credit));
    expect(document.querySelector('.res-back')).toBeTruthy();
    expect($('[data-testid="results-panel"]')).toBeTruthy();
  });

  it('the credit line opens the source sheet when the service is present', () => {
    const f = fixture();
    const open = vi.fn();
    f.services.actions.openSource = open;
    renderScreen(f);
    click($('.res-credit-button'));
    expect(open).toHaveBeenCalledWith(f.store.getState().record);
  });

  it('Next excerpt goes to the tips interstitial when tips are on and exist, else to the scan', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const withTips = fixture({ record: rec });
    expect(withTips.store.getState().tips.length).toBeGreaterThan(0);
    renderScreen(withTips);
    click(button(copy('action.nextExcerpt')));
    expect(withTips.hash.value).toBe('#/practice/tips');
    m?.unmount();
    document.body.innerHTML = '';

    const off = fixture({ record: rec });
    off.settings.set({ ...off.settings.get(), practicePrefs: { ...off.settings.get().practicePrefs, showTips: false } });
    renderScreen(off);
    click(button(copy('action.nextExcerpt')));
    expect(off.hash.value).toBe('#/practice/scan');
  });

  it('after every 10th attempt Next opens the session summary first; Keep going moves on, Finish goes Home', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const ten = Array.from({ length: 10 }, (_, k) => ({ ...rec, id: `s${k}` }));
    const f = fixture({ record: ten[9]! });
    let finished = 0;
    f.services.sessionAttempts = () => ten;
    f.services.onFinish = () => void finished++;
    renderScreen(f);
    click(button(copy('action.nextExcerpt')));
    expect(f.hash.value).toBe('#/practice/results');
    expect($('[data-testid="session-summary"]').textContent).toContain('10 takes');
    // Each top pattern carries its tip.
    const items = [...document.querySelectorAll('[data-pattern]')];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(li.querySelector('.sheet-pattern-tip')?.textContent?.length ?? 0).toBeGreaterThan(0);
    click(button(copy('action.keepGoing')));
    expect(f.hash.value).toBe('#/practice/tips');
    m?.unmount();
    document.body.innerHTML = '';

    const g = fixture({ record: ten[9]! });
    g.services.sessionAttempts = () => ten;
    g.services.onFinish = () => void finished++;
    renderScreen(g);
    click(button(copy('action.nextExcerpt')));
    click(button(copy('action.finish')));
    expect(finished).toBe(1);
    expect(g.hash.value).toBe('#/');
  });

  it('Next goes straight on when the summary is not due (9 attempts)', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const f = fixture({ record: rec });
    f.services.sessionAttempts = () => Array.from({ length: 9 }, (_, k) => ({ ...rec, id: `s${k}` }));
    renderScreen(f);
    click(button(copy('action.nextExcerpt')));
    expect(q('[data-testid="session-summary"]')).toBeNull();
    expect(f.hash.value).toBe('#/practice/tips');
  });

  it('Try again goes to the scan; a handled action does not navigate', () => {
    const f = fixture();
    f.services.actions.tryAgain = () => true;
    renderScreen(f);
    click(button(copy('action.tryAgainPractice')));
    expect(f.hash.value).toBe('#/practice/results');
  });

  it('keyboard: N is Next excerpt, R is Try again, and nothing fires inside an overlay or with shortcuts off', () => {
    const f = fixture({ view: { tips: [] } });
    renderScreen(f);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });
    expect(f.hash.value).toBe('#/practice/scan');
    f.hash.value = '#/practice/results';
    act(() => f.loc.navigate('/practice/results', false));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    });
    expect(f.hash.value).toBe('#/practice/scan');
  });

  it('keyboard shortcuts off: N does nothing', () => {
    const f = fixture({ view: { tips: [] } });
    f.settings.set({ ...f.settings.get(), accessibility: { ...f.settings.get().accessibility, keyboardShortcuts: false } });
    renderScreen(f);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    });
    expect(f.hash.value).toBe('#/practice/results');
  });

  it('with no record it goes Home; while scoring it says so', () => {
    const f = fixture({ record: null });
    renderScreen(f);
    expect(f.hash.value).toBe('#/');
    m?.unmount();
    document.body.innerHTML = '';
    const g = fixture({ record: null, view: { state: 'finishing' } });
    renderScreen(g);
    expect(document.body.textContent).toContain(copy('results.scoring'));
    expect(g.hash.value).toBe('#/practice/results');
  });

  it('rank-up: the card shows after the panel settles, once per rank, and never with the install coach', () => {
    vi.useFakeTimers();
    const ios = attemptFrom('case01-perfect-flute-l4');
    ios.audioEnv = { ...ios.audioEnv, osFamily: 'ios', displayMode: 'browser' };
    const f = fixture({ record: ios, view: { progress: [{ type: 'rank-up', from: 2, to: 3, name: 'Student' }] }, settleMs: 300 });
    renderScreen(f);
    expect(document.querySelector('[data-testid="rankup-card"]')).toBeNull();
    settle(350);
    expect($('[data-testid="rankup-card"]').textContent).toContain('Next: Section player, at 2,500 XP and difficulty 4 on any instrument.');
    expect(document.querySelector('[data-testid="install-coach"]')).toBeNull();
    expect(document.body.textContent).toContain(copy('rankup.headline', { rank: 'Student' }));
    click(button(copy('action.continue')));
    settle(1000);
    expect(document.querySelector('[data-testid="rankup-card"]')).toBeNull();
    // The install coach does not take its place in this visit.
    expect(document.querySelector('[data-testid="install-coach"]')).toBeNull();
  });

  it('install coach: iOS Safari tab, graded attempt, once', () => {
    vi.useFakeTimers();
    const ios = attemptFrom('case01-perfect-flute-l4');
    ios.audioEnv = { ...ios.audioEnv, osFamily: 'ios', displayMode: 'browser' };
    const f = fixture({ record: ios, settleMs: 100 });
    renderScreen(f);
    settle(150);
    expect($('[data-testid="install-coach"]').textContent).toContain('Add Sightread to your Home Screen');
    click(button(copy('action.gotIt')));
    expect(f.settings.get().shown.installCoach).toBe(true);
    settle(500);
    expect(document.querySelector('[data-testid="install-coach"]')).toBeNull();
  });

  it('no install coach on desktop or in standalone mode', () => {
    vi.useFakeTimers();
    const f = fixture({ settleMs: 50 });
    renderScreen(f);
    settle(500);
    expect(document.querySelector('[data-testid="install-coach"]')).toBeNull();
  });
});
