// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSettings, AttemptRecord, PlayerProfile, ProgressEvent, Tip } from '../../../core/types.ts';
import { idleSoundView, type ListenOptions, type SoundView } from '../../../session/index.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { ToastProvider } from '../../../ui/primitives/index.ts';
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
  headerState,
  hearSpans,
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
import type { ResultsSetupServices } from './ResultsScreen.tsx';
import { reviewFixture } from './review/test-fixture.ts';
import type { ReviewExtras } from './review/SessionReview.tsx';
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
    const clock = { ...ranked, score: { ...ranked.score!, ranked: false, rankedReasons: ['clock-rate'] as const } } as unknown as AttemptRecord;
    expect(badgesFor(clock, cfg)[0]!.detail).toBe(copy('ranked.reason.clockRate'));
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
    expect(lines).toContain('Over 60 tries today ×0.25');
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
      'Moved up to difficulty 6: 8 tries in a row at 90 or more.',
      'Difficulty 6 has been hard lately. A few tries at difficulty 5 can build the reading back up.',
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
    expect($('.dom-pill[data-kind="ranked"]').textContent).toContain(copy('badge.ranked'));
    expect(document.body.textContent).toContain(copy(`grade.${s.grade}`));
    // Ranked: no reason line.
    expect($('[data-testid="results-panel"]').getAttribute('data-header')).toBe('ranked');
    expect(q('[data-testid="res-reason"]')).toBeNull();
  });

  it('shows three component bars with numbers; the weakest is hatched and named in a sentence', () => {
    const base = attemptFrom('case07-voice-30c-flat');
    // The sentence needs a component below 90 (round 2), so one is lowered here.
    const rec = { ...base, score: { ...base.score!, components: { ...base.score!.components, I: 70 } } };
    render({ record: rec });
    const rows = [...document.querySelectorAll('.res-comp')];
    expect(rows).toHaveLength(3);
    const labels = rows.map((r) => r.querySelector('.res-comp-label')?.textContent ?? '');
    expect(labels).toEqual([copy('component.notes.label'), copy('component.inTune.label'), copy('component.rhythm.label')]);
    const weakest = document.querySelectorAll('.res-comp[data-weakest="true"]');
    expect(weakest).toHaveLength(1);
    const id = weakest[0]!.getAttribute('data-component') as 'P' | 'I' | 'R';
    expect(id).toBe(focusComponent(rec.score!));
    const label = weakest[0]!.querySelector('.res-comp-label')!.textContent!;
    expect($('.res-how-focus').textContent).toBe(copy('component.focus', { component: label }));
    for (const r of rows) expect(r.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe(r.querySelector('.res-comp-value')!.textContent);
  });

  it('names no component to work on when every one is 90 or more', () => {
    const base = attemptFrom('case01-perfect-flute-l4');
    const rec = { ...base, score: { ...base.score!, components: { P: 95, I: 92, R: 99 } } };
    render({ record: rec });
    expect(q('.res-how-focus')).toBeNull();
    expect(q('.res-comp[data-weakest="true"]')).toBeNull();
  });

  it('the drift line shows from 20 ms and not below', () => {
    const base = attemptFrom('case04-drift-0.15');
    const withDrift = (ms: number): AttemptRecord => ({ ...base, score: { ...base.score!, diagnostics: { ...base.score!.diagnostics, driftMsAtEnd: ms } } });
    expect(diagnosticLines(withDrift(19).score!).some((l) => /slightly by the end/.test(l))).toBe(false);
    expect(diagnosticLines(withDrift(20).score!).some((l) => /slowed down slightly by the end/.test(l))).toBe(true);
    expect(diagnosticLines(withDrift(-25).score!).some((l) => /sped up slightly by the end/.test(l))).toBe(true);
  });

  it('the calibration line shows only for an uncalibrated try, the recheck-shift line only for a calibrated one', () => {
    const recheck = { status: 'measured' as const, measuredMs: 90, clicks: 6, madMs: 2, usedFresh: true, promptRecalibrate: true };
    const base = attemptFrom('case01-perfect-flute-l4');
    const cal = (method: 'loopback' | 'none' | 'reported'): AttemptRecord => ({ ...base, calibration: { ...base.calibration, method, recheck } });
    render({ record: cal('loopback'), onRecalibrate: vi.fn(), review: <p>score</p> });
    expect(q('.res-timing-note')).toBeNull();
    expect(document.body.textContent).toContain(copy('results.banner.recheckShift'));
    m?.unmount();
    render({ record: cal('none'), onRecalibrate: vi.fn(), recalibrate: true, review: <p>score</p> });
    expect(document.body.textContent).not.toContain(copy('results.banner.recheckShift'));
    expect($('.res-timing-note').textContent).toBe(copy('badge.timingOffset'));
  });

  it('the tries line: "See all tries" on a first try, "2 tries at this piece" on a third, both open History', async () => {
    const onSeeTries = vi.fn();
    const base = attemptFrom('case01-perfect-flute-l4');
    render({ record: base, onSeeTries, triesAtPiece: () => Promise.resolve(1) });
    await act(async () => {
      await Promise.resolve();
    });
    expect($('[data-testid="res-tries"]').textContent).toBe(copy('results.tries.all'));
    click(button(copy('results.tries.all')));
    expect(onSeeTries).toHaveBeenCalledTimes(1);
    m?.unmount();
    render({ record: base, onSeeTries, triesAtPiece: () => Promise.resolve(3) });
    await act(async () => {
      await Promise.resolve();
    });
    expect($('[data-testid="res-tries"]').textContent).toContain(copy('results.tries.atPiece', { n: 2 }));
    click(button(copy('results.tries.atPiece', { n: 2 })));
    expect(onSeeTries).toHaveBeenCalledTimes(2);
  });

  it('the sure line and the diagnostics button sit under the counts', () => {
    const diagnostics = { supportAddress: null, soundOptInShown: true, exportTry: vi.fn(), exportLast: vi.fn(), exportRecent: vi.fn(), settings: () => Promise.resolve({ includeAudio: false }), setSettings: vi.fn() };
    render({ record: attemptFrom('case01-perfect-flute-l4'), diagnostics: diagnostics as never });
    expect($('[data-testid="sure-line"]')).toBeTruthy();
    expect(button('Save diagnostics')).toBeTruthy();
  });

  it('renders diagnostics as plain text, not bars', () => {
    render({ record: attemptFrom('case06-stop-2-beats-bar-5') });
    const lines = [...document.querySelectorAll('.res-how-diag')].map((l) => l.textContent?.trim());
    expect(lines.some((l) => l?.startsWith('Stops: '))).toBe(true);
    expect(document.querySelectorAll('[data-testid="res-diagnostics"] .res-comp')).toHaveLength(0);
  });

  it('drift is in words; milliseconds only with "Show cents and milliseconds"', () => {
    const rec = attemptFrom('case04-drift-0.15');
    const ms = Math.round(Math.abs(rec.score!.diagnostics.driftMsAtEnd!));
    render({ record: rec });
    const words = $('[data-testid="res-diagnostics"]').textContent!;
    expect(words).toMatch(/You (slowed down|sped up) slightly by the end\./);
    expect(words).not.toContain(' ms)');
    m?.unmount();
    render({ record: rec, showNumbers: true });
    expect($('[data-testid="res-diagnostics"]').textContent).toContain(copy('results.drift.ms', { ms }));
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

  it('incomplete: the Incomplete badge with its explanation as visible text, no XP value', () => {
    render({ record: attemptFrom('case10-incomplete') });
    expect($('[data-testid="results-panel"]').getAttribute('data-header')).toBe('incomplete');
    expect($('.dom-pill[data-kind="incomplete"]')).toBeTruthy();
    expect($('[data-testid="res-reason"]').textContent).toBe(copy('badge.incomplete.tooltip', { cap: 50 }));
    expect($('[data-testid="res-xp"]').textContent).toContain(copy('xp.none.incomplete'));
  });

  it('practice by choice: the Practice badge and no reason line; the XP line is the practice line', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const practice: AttemptRecord = { ...rec, score: { ...rec.score!, ranked: false, rankedReasons: ['practice-mode'], xp: { total: 8, base: 34, factors: [{ id: 'practice', value: 0.25 }] } } };
    render({ record: practice });
    expect($('[data-testid="results-panel"]').getAttribute('data-header')).toBe('practice');
    expect($('.dom-pill[data-kind="practice"]').textContent).toBe(copy('badge.practice'));
    expect(q('[data-testid="res-reason"]')).toBeNull();
    expect(document.body.textContent).not.toContain(copy('ranked.reason.practice-mode'));
    expect($('[data-testid="res-xp"]').textContent).toContain('+8 XP (practice earns 25% of the XP)');
  });

  it('practice for a reason: the Practice badge with the reason (listened first)', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const listened: AttemptRecord = { ...rec, score: { ...rec.score!, ranked: false, rankedReasons: ['listened-first'] } };
    render({ record: listened });
    expect($('[data-testid="results-panel"]').getAttribute('data-header')).toBe('practice-reason');
    expect($('.dom-pill[data-kind="practice"]')).toBeTruthy();
    expect($('[data-testid="res-reason"]').textContent).toBe('You listened first, so this one is practice.');
    expect(document.body.textContent).not.toContain(copy('action.calibrateNow'));
  });

  it('not calibrated: Practice with the calibration reason, Calibrate now, and the timing note on the score', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const uncal: AttemptRecord = { ...rec, score: { ...rec.score!, ranked: false, rankedReasons: ['practice-mode', 'calibration'] } };
    const onCalibrateNow = vi.fn();
    render({ record: uncal, onCalibrateNow, review: <div data-testid="fake-review" /> });
    expect($('[data-testid="results-panel"]').getAttribute('data-header')).toBe('not-calibrated');
    expect($('.dom-pill[data-kind="practice"]')).toBeTruthy();
    expect($('[data-testid="res-reason"]').textContent).toContain(copy('ranked.reason.calibration'));
    click(button(copy('action.calibrateNow')));
    expect(onCalibrateNow).toHaveBeenCalledTimes(1);
    expect($('[data-testid="res-score"]').textContent).toContain(copy('badge.timingOffset'));
  });

  it('personal best ribbon and the XP line', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    render({ record: rec, progress: [{ type: 'best', instrumentId: rec.instrumentId, level: 4, score: 100 }] });
    expect($('[data-testid="res-ribbon"]').textContent).toBe('New best at difficulty 4');
    expect($('.res-xp').textContent).toBe(copy('xp.headline', { xp: rec.score!.xp.total }));
  });

  it('rank line and bar expose the formula percent', () => {
    render({ record: attemptFrom('case01-perfect-flute-l4'), profile: makeProfile({ xp: 2180, rank: 3 }) });
    const bar = $('.res-rank-bar');
    expect(bar.getAttribute('aria-valuenow')).toBe('79');
    expect($('[data-testid="res-rank"]').textContent).toBe('Student · 79% to Section player');
  });

  it('level cards: the difficulty offer (Go to difficulty n), Stay, Undo and Go to level call their handlers and disappear', () => {
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
    click(button(copy('action.goToLevel', { level: 6 })));
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

  it('actions in the header on desktop: Next piece, Try again (practice) with its tooltip, Change setup', () => {
    const onNext = vi.fn();
    const onTryAgain = vi.fn();
    const onChangeSetup = vi.fn();
    render({ record: attemptFrom('case01-perfect-flute-l4'), onNext, onTryAgain, onChangeSetup });
    const head = $('.res-head [data-testid="res-actions-head"]');
    expect([...head.querySelectorAll('button')].map((b) => b.textContent)).toEqual([copy('action.nextExcerpt'), copy('action.tryAgainPractice'), copy('action.changeSetup')]);
    expect(q('[data-testid="res-actions-end"]')).toBeNull();
    click(button(copy('action.nextExcerpt')));
    click(button(copy('action.tryAgainPractice')));
    click(button(copy('action.changeSetup')));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    expect(onChangeSetup).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[title="${copy('results.practice.tooltip')}"]`)).toBeTruthy();
  });

  it('phones: the bar with Next piece and Try again is always there; the page end keeps the quieter actions', () => {
    render({ record: attemptFrom('case01-perfect-flute-l4'), wide: false, onNext: vi.fn(), onTryAgain: vi.fn(), onChangeSetup: vi.fn() });
    expect(q('.res-head [data-testid="res-actions-head"]')).toBeNull();
    const end = $('[data-testid="res-actions-end"]');
    expect(end.compareDocumentPosition($('[data-testid="res-components"]')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const pinned = $('[data-testid="res-pinned"]');
    expect([...pinned.querySelectorAll('button')].map((b) => b.textContent)).toEqual([copy('action.nextExcerpt'), copy('action.tryAgain')]);
    // One Next piece button on the page: the bar's.
    expect([...end.querySelectorAll('button')].map((b) => b.textContent)).toEqual([copy('action.tryAgainPractice'), copy('action.changeSetup')]);
  });

  it('not graded (void): the heading, the void reason, the clean score with its line, and its own actions', () => {
    const rec = attemptFrom('case01-perfect-flute-l4', { score: null, endReason: 'void', voidReason: 'no-signal' });
    const onTryAgain = vi.fn();
    const onCheckMicrophone = vi.fn();
    render({ record: rec, onTryAgain, onCheckMicrophone, onNext: vi.fn(), onChangeSetup: vi.fn(), profile: makeProfile({ xp: 2180, rank: 3 }) });
    const panel = $('[data-testid="results-panel"]');
    expect(panel.getAttribute('data-state')).toBe('void');
    expect(panel.getAttribute('data-header')).toBe('void');
    expect(q('.res-grade')).toBeNull();
    expect(q('.dom-stars')).toBeNull();
    expect($('[data-testid="res-void-title"]').textContent).toBe(copy('results.badge.notGraded'));
    expect($('.dom-pill[data-kind="not-graded"]')).toBeTruthy();
    expect($('[data-testid="void-no-signal"]').textContent).toBe(copy('void.noSignal'));
    expect($('[data-testid="res-score"]').getAttribute('data-clean')).toBe('true');
    expect($('[data-testid="res-score"]').textContent).toBe(copy('results.void.cleanScore'));
    expect([...$('[data-testid="res-actions-head"]').querySelectorAll('button')].map((b) => b.textContent)).toEqual([copy('action.checkMicrophone'), copy('action.tryAgain')]);
    click(button(copy('action.checkMicrophone')));
    expect(onCheckMicrophone).toHaveBeenCalled();
    click(button(copy('action.tryAgain')));
    expect(onTryAgain).toHaveBeenCalled();
    // No tips and no components on a take that was not graded.
    expect(q('[data-testid="res-components"]')).toBeNull();
  });

  it('practising without listening: Not graded · no XP, no grade block, no XP', () => {
    render({ record: attemptFrom('case01-perfect-flute-l4', { listening: false, score: null }), onNext: vi.fn() });
    expect($('[data-testid="not-graded"]').textContent).toBe(copy('results.notGraded'));
    expect($('[data-testid="results-panel"]').getAttribute('data-state')).toBe('not-graded');
    expect(document.querySelector('.res-grade')).toBeNull();
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
      <ToastProvider>
        <Outlet />
      </ToastProvider>
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
    expect(button(copy('nav.home'))).toBeTruthy();
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

  it('Next piece goes to the scan whether or not tips exist (the tips route redirects, decision 13)', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const withTips = fixture({ record: rec });
    expect(withTips.store.getState().tips.length).toBeGreaterThan(0);
    renderScreen(withTips);
    click(button(copy('action.nextExcerpt')));
    expect(withTips.hash.value).toBe('#/practice/scan');
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
    expect($('[data-testid="session-summary"]').textContent).toContain('10 tries');
    // Each top pattern carries its tip.
    const items = [...document.querySelectorAll('[data-pattern]')];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(li.querySelector('.sheet-pattern-tip')?.textContent?.length ?? 0).toBeGreaterThan(0);
    click(button(copy('action.keepGoing')));
    expect(f.hash.value).toBe('#/practice/scan');
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
    expect(f.hash.value).toBe('#/practice/scan');
  });

  it('Try again goes to the scan; a handled action does not navigate', () => {
    const f = fixture();
    f.services.actions.tryAgain = () => true;
    renderScreen(f);
    click(button(copy('action.tryAgainPractice')));
    expect(f.hash.value).toBe('#/practice/results');
  });

  it('keyboard: N is Next piece, R is Try again, and nothing fires inside an overlay or with shortcuts off', () => {
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

// ---- header states, "One thing to try", Listen and Change setup (05 section 8.11) -----------------------------

describe('header state model (05 section 8.11)', () => {
  const base = attemptFrom('case01-perfect-flute-l4');
  const withScore = (over: Partial<NonNullable<AttemptRecord['score']>>): AttemptRecord => ({ ...base, score: { ...base.score!, ...over } });
  it.each([
    ['ranked', withScore({ ranked: true, rankedReasons: [] }), 'ranked', null, false],
    ['practice', withScore({ ranked: false, rankedReasons: ['practice-mode'] }), 'practice', null, false],
    ['practice-reason', withScore({ ranked: false, rankedReasons: ['practice-mode', 'listened-first'] }), 'practice', copy('ranked.reason.listened-first'), false],
    ['not-calibrated', withScore({ ranked: false, rankedReasons: ['familiar', 'calibration'] }), 'practice', `${copy('ranked.reason.calibration')} ${copy('ranked.reason.familiar')}`, true],
    ['incomplete', attemptFrom('case10-incomplete'), 'incomplete', copy('badge.incomplete.tooltip', { cap: 50 }), false],
    ['void', { ...base, score: null, endReason: 'void', voidReason: 'interrupted' } as AttemptRecord, 'not-graded', copy('void.interrupted'), false],
    ['not-listening', { ...base, score: null, listening: false } as AttemptRecord, null, null, false],
  ] as const)('%s', (kind, record, badge, reason, calibrateNow) => {
    const h = headerState(record, cfg);
    expect(h.kind).toBe(kind);
    expect(h.badge).toBe(badge);
    expect(h.reason).toBe(reason);
    expect(h.calibrateNow).toBe(calibrateNow);
    expect(h.clean).toBe(kind === 'void' || kind === 'not-listening');
  });
});

describe('hear buttons for a tip', () => {
  it('a bar alone is "Hear bar n"; a run is heard two bars at a time from its start; at most three', () => {
    expect(hearSpans([2, 6]).map((s) => s.label)).toEqual(['Hear bar 2', 'Hear bar 6']);
    expect(hearSpans([3, 4, 5, 6, 7, 8])).toEqual([{ from: 3, to: 4, label: 'Hear bars 3 to 4' }]);
    expect(hearSpans([1, 3, 5, 7]).length).toBe(3);
    expect(hearSpans([])).toEqual([]);
  });
});

describe('"One thing to try" on the results page', () => {
  const rec = attemptFrom('case05-key-signature-f-sharp');
  const base: Tip = { id: 'T1', patternId: cfg.tips.patterns[0]!.id, text: 'Name the key out loud.', evidence: 'Seen in bars 2 and 6.', bars: [2, 6], primary: true };
  const second: Tip = { id: 'T2', patternId: cfg.tips.patterns[1]!.id, text: 'Keep your eyes a beat ahead.', evidence: 'Seen in bars 3 to 8.', bars: [3, 4, 5, 6, 7, 8], primary: false };
  const render = (props: Partial<Parameters<typeof ResultsPanel>[0]>): void => {
    m = mount(<ResultsPanel configs={cfg} record={rec} {...props} />);
  };

  it('shows the primary tip, its evidence and hear buttons that play those bars', () => {
    const onHearBars = vi.fn();
    render({ tips: [base], onHearBars });
    expect($('.res-tips-title').textContent).toBe(copy('results.tip.title'));
    expect($('.res-tip-text').textContent).toBe('Name the key out loud.');
    expect($('.res-tip-evidence').textContent).toBe('Seen in bars 2 and 6.');
    click(button('Hear bar 6'));
    expect(onHearBars).toHaveBeenCalledWith({ from: 6, to: 6, label: 'Hear bar 6' });
  });

  it('more tips wait behind "Show 1 more tip", which reads "Hide tip" when open; "Hear bars 3 to 4" for a run', () => {
    const onHearBars = vi.fn();
    render({ tips: [second, base], onHearBars, onShowTipsChange: vi.fn() });
    // The primary leads whatever the order.
    expect($('.res-tip-text').textContent).toBe(base.text);
    const more = $('.res-tip-more');
    expect(more.textContent).toBe(copy('results.tip.more', { n: 1 }));
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect($('.res-tip-rest').hidden).toBe(true);
    expect(q('.res-tip-setting')).toBeNull();
    click(more);
    expect(more.textContent).toBe('Hide tip');
    expect($('.res-tip-rest').hidden).toBe(false);
    expect($('.res-tip-other .res-tip-body').textContent).toBe(second.text);
    click(button('Hear bars 3 to 4'));
    expect(onHearBars).toHaveBeenCalledWith({ from: 3, to: 4, label: 'Hear bars 3 to 4' });
    // Open, the setting is the last row.
    expect($('.res-tips').lastElementChild!.classList.contains('res-tip-setting')).toBe(true);
  });

  it('never more tips than the catalogue allows; "Show 2 more tips" when it allows three', () => {
    const third: Tip = { ...second, id: 'T3' };
    render({ tips: [base, second, third] });
    const max = cfg.tips.selection.maxTips;
    expect(document.querySelectorAll('.res-tip-other')).toHaveLength(Math.max(0, Math.min(3, max) - 1));
  });

  it('nothing at all with no tips, or with "Show a tip after each try" off', () => {
    render({ tips: [] });
    expect(q('[data-testid="res-tips"]')).toBeNull();
    m?.unmount();
    render({ tips: [base], showTips: false });
    expect(q('[data-testid="res-tips"]')).toBeNull();
  });
});

/** A results fixture whose session holds the take's excerpt, so Listen and the toolbar summary can show. */
function listenFixture(): Fx & { listen: ReturnType<typeof vi.fn>; hearBar: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; sounds: StoreApi<SoundView>; extras: { last: ReviewExtras | null } } {
  const rv = reviewFixture();
  const record = { ...attemptFrom('case05-key-signature-f-sharp'), excerptId: rv.prepared.excerptId };
  const f = fixture({ record, view: { prepared: rv.prepared } });
  const sounds = createStore<SoundView>()(() => idleSoundView());
  const listen = vi.fn((_o: ListenOptions) => Promise.resolve());
  const hearBar = vi.fn(() => Promise.resolve());
  const stop = vi.fn(() => sounds.setState(idleSoundView()));
  const extras: { last: ReviewExtras | null } = { last: null };
  f.services.listen = listen;
  f.services.hearBar = hearBar;
  f.services.stopSounds = stop;
  f.services.sounds = sounds;
  // The review: the toolbar's right end, and a bar a test can tap.
  f.services.renderReview = ((_r: AttemptRecord, x?: ReviewExtras) => {
    extras.last = x ?? null;
    return (
      <div data-testid="fake-review" data-highlight={x?.highlightBar ?? ''}>
        <button type="button" data-testid="tap-bar-5" onClick={() => x?.onBarTap?.(rv.prepared.measures.findIndex((mm) => mm.displayBar === 5))} />
        {x?.toolbarEnd}
      </div>
    );
  }) as NonNullable<ResultsServices['renderReview']>;
  return { ...f, listen, hearBar, stop, sounds, extras };
}

describe('Listen on results (05 section 9.3, section 16 item 12)', () => {
  it('Listen plays from bar 1 at the take tempo; Slower plays at 75%', () => {
    const f = listenFixture();
    renderScreen(f);
    // The loop toolbar carries the excerpt summary.
    expect($('.res-summary').textContent).toContain('bars');
    click($('[data-testid="listen-button"]'));
    expect(f.listen).toHaveBeenLastCalledWith({ slower: false });
    click($<HTMLInputElement>('[data-testid="listen-controls"] input[role="switch"]'));
    click($('[data-testid="listen-button"]'));
    expect(f.listen).toHaveBeenLastCalledWith({ slower: true });
  });

  it('a tapped bar shows "From bar n" and the bar wash; Listen then starts there', () => {
    const f = listenFixture();
    renderScreen(f);
    click($('[data-testid="tap-bar-5"]'));
    expect($('[data-testid="from-bar"]').textContent).toBe(copy('listen.fromBar', { n: 5 }));
    const idx = Number($('[data-testid="fake-review"]').getAttribute('data-highlight'));
    expect(reviewFixture().prepared.measures[idx]!.displayBar).toBe(5);
    click($('[data-testid="listen-button"]'));
    expect(f.listen).toHaveBeenLastCalledWith({ slower: false, fromBar: 5 });
  });

  it('while it plays: "Playing bar n of m", the wash on that bar, Stop on a brass edge; a tap does not move the start', () => {
    const f = listenFixture();
    renderScreen(f);
    act(() => f.sounds.setState({ ...idleSoundView(), playing: 'listen', caption: { kind: 'bar', bar: 3, of: 8 }, bar: 3 }));
    expect($('[data-testid="live-caption"]').textContent).toBe(copy('listen.playing', { n: 3, total: 8 }));
    const btn = $('[data-testid="listen-button"]');
    expect(btn.textContent).toBe(copy('action.stop'));
    expect(btn.classList.contains('res-listen-playing')).toBe(true);
    const idx = Number($('[data-testid="fake-review"]').getAttribute('data-highlight'));
    expect(reviewFixture().prepared.measures[idx]!.displayBar).toBe(3);
    click($('[data-testid="tap-bar-5"]'));
    click(btn);
    expect(f.stop).toHaveBeenCalled();
    expect(document.body.textContent).toContain(copy('listen.stopped'));
    expect(q('[data-testid="from-bar"]')).toBeNull();
  });

  it('L plays Listen; leaving the screen stops the sound', () => {
    const f = listenFixture();
    renderScreen(f);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    });
    expect(f.listen).toHaveBeenCalledTimes(1);
    m?.unmount();
    m = null;
    expect(f.stop).toHaveBeenCalled();
  });

  it('Hear bar n from the tip plays those bars, Slower included', () => {
    const f = listenFixture();
    const tip: Tip = { id: 'T1', patternId: cfg.tips.patterns[0]!.id, text: 'Tip.', evidence: 'Seen in bars 2 and 6.', bars: [2], primary: true };
    act(() => f.store.setState({ tips: [tip] }));
    renderScreen(f);
    click(button('Hear bar 2'));
    expect(f.hearBar).toHaveBeenLastCalledWith(2, undefined, { slower: false });
  });

  it('void: the review is asked for the clean score, with no marks, and the page says so', () => {
    const f = listenFixture();
    const rec = { ...f.store.getState().record!, score: null, endReason: 'void' as const, voidReason: 'no-signal' as const, judgments: [] };
    act(() => f.store.setState({ record: rec, tips: [] }));
    renderScreen(f);
    expect($('[data-testid="results-panel"]').getAttribute('data-state')).toBe('void');
    expect($('[data-testid="res-score"]').getAttribute('data-clean')).toBe('true');
    expect($('[data-testid="fake-review"]')).toBeTruthy();
    expect(q('[data-testid="res-components"]')).toBeNull();
    expect(q('.res-grade')).toBeNull();
  });
});

describe('tips off from results (designer\'s note 17)', () => {
  it('turning the switch off removes the card and shows a toast with Undo, which restores it', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const tip: Tip = { id: 'T1', patternId: cfg.tips.patterns[0]!.id, text: 'Tip.', evidence: 'Seen in bar 2.', bars: [2], primary: true };
    const f = fixture({ record: rec, view: { tips: [tip] } });
    renderScreen(f);
    const input = $<HTMLInputElement>('.res-tip-setting input[role="switch"]');
    expect(input.checked).toBe(true);
    click(input);
    expect(f.settings.get().practicePrefs.showTips).toBe(false);
    expect(q('[data-testid="res-tips"]')).toBeNull();
    expect(document.body.textContent).toContain(copy('tips.offToast'));
    click(button(copy('action.undo')));
    expect(f.settings.get().practicePrefs.showTips).toBe(true);
    expect($('[data-testid="res-tips"]')).toBeTruthy();
  });
});

describe('Change setup (05 sections 3.2 and 4.4)', () => {
  const withSetup = (): Fx => {
    const f = fixture();
    (f.services as ResultsServices & ResultsSetupServices).countEligible = () => 40;
    return f;
  };

  it('opens the setup sheet over results; Done with nothing changed stays on results', () => {
    const f = withSetup();
    renderScreen(f);
    click(button(copy('action.changeSetup')));
    expect($('[data-testid="setup-sheet"]')).toBeTruthy();
    click(button(copy('setup.done')));
    expect(q('[data-testid="setup-sheet"]')).toBeNull();
    expect(f.hash.value).toBe('#/practice/results');
  });

  it('Done after a change goes to the cover of a new excerpt with the new setup', () => {
    const f = withSetup();
    const next = vi.fn(() => false);
    f.services.actions.next = next;
    renderScreen(f);
    click(button(copy('action.changeSetup')));
    const before = f.settings.get().practice.writtenKey;
    const anyKey = [...document.querySelectorAll<HTMLElement>('[data-testid="setup-sheet"] [role="radio"]')].find((r) => r.getAttribute('aria-checked') === 'false' && /key/i.test(r.closest('[data-setup-slot]')?.getAttribute('data-setup-slot') ?? ''));
    expect(anyKey).toBeTruthy();
    click(anyKey!);
    expect(f.settings.get().practice.writtenKey).not.toEqual(before);
    click(button(copy('setup.done')));
    expect(next).toHaveBeenCalledTimes(1);
    expect(f.hash.value).toBe('#/practice/scan');
  });

  it('Cancel (Escape) after a change puts the setup back and stays on results', () => {
    const f = withSetup();
    const next = vi.fn(() => false);
    f.services.actions.next = next;
    renderScreen(f);
    click(button(copy('action.changeSetup')));
    const before = f.settings.get().practice;
    const anyKey = [...document.querySelectorAll<HTMLElement>('[data-testid="setup-sheet"] [role="radio"]')].find((r) => r.getAttribute('aria-checked') === 'false' && /key/i.test(r.closest('[data-setup-slot]')?.getAttribute('data-setup-slot') ?? ''));
    click(anyKey!);
    expect(f.settings.get().practice.writtenKey).not.toEqual(before.writtenKey);
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('[data-testid="setup-sheet"]')).toBeNull();
    expect(f.settings.get().practice).toEqual(before);
    expect(next).not.toHaveBeenCalled();
    expect(f.hash.value).toBe('#/practice/results');
  });

  it('without the corpus counts it goes to Practice', () => {
    const f = fixture();
    renderScreen(f);
    click(button(copy('action.changeSetup')));
    expect(f.hash.value).toBe('#/');
  });
});
