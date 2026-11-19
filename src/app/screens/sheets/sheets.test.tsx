// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, AttemptRecord, PlayerProfile, Tip } from '../../../core/types.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import type { Readable, Writable } from '../home/services.ts';
import { attemptFrom, cfg, makeProfile, sessionStore, tipsFor } from '../results/test-data.ts';
import {
  InstallCoach,
  RankUpCard,
  SessionSummary,
  SkipSheet,
  StopSheet,
  createTipsScreen,
  installCoachDue,
  nextRankRequirement,
  skipToastText,
  stopVariant,
  summarizeSession,
  summaryDue,
  type TipsServices,
} from './index.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
});

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  return b as HTMLButtonElement;
};

describe('Stop confirm (04 5.10)', () => {
  it('picks the variant from ranked and first-note state', () => {
    expect(stopVariant({ ranked: true, firstNoteHeard: false })).toBe('ranked-before-note');
    expect(stopVariant({ ranked: true, firstNoteHeard: true })).toBe('ranked-after-note');
    expect(stopVariant({ ranked: false, firstNoteHeard: true })).toBe('practice');
    expect(stopVariant({ ranked: false, firstNoteHeard: false })).toBe('practice');
  });

  it('ranked before the first note: Restart is the default, Stop second', () => {
    const onRestart = vi.fn();
    const onStop = vi.fn();
    m = mount(<StopSheet open variant="ranked-before-note" onKeep={vi.fn()} onStop={onStop} onRestart={onRestart} />);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.body.textContent).toContain(copy('play.stopConfirm.ranked.beforeNote'));
    expect(document.activeElement?.textContent).toBe(copy('action.restart'));
    click(button(copy('action.restart')));
    expect(onRestart).toHaveBeenCalled();
    click(button(copy('action.stop')));
    expect(onStop).toHaveBeenCalled();
  });

  it('ranked after a note and practice: Keep playing has the focus; the credit line follows', () => {
    const onKeep = vi.fn();
    m = mount(<StopSheet open variant="ranked-after-note" credit="Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0" onKeep={onKeep} onStop={vi.fn()} />);
    expect(document.body.textContent).toContain(copy('play.stopConfirm.ranked.afterNote'));
    expect(document.activeElement?.textContent).toBe(copy('action.keepPlaying'));
    expect(document.body.textContent).toContain('That was: Schubert (1797–1828)');
    m.unmount();
    m = mount(<StopSheet open variant="practice" onKeep={onKeep} onStop={vi.fn()} />);
    expect(document.body.textContent).toContain(copy('play.stopConfirm.practice'));
    expect(document.body.textContent).not.toContain('That was');
    key(document, 'Escape');
    expect(onKeep).toHaveBeenCalled();
  });

  it('traps focus: Tab from the last button returns to the first, and focus is restored on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    m = mount(<StopSheet open variant="ranked-after-note" onKeep={vi.fn()} onStop={vi.fn()} />);
    const stop = button(copy('action.stop'));
    stop.focus();
    key(document, 'Tab');
    expect(document.activeElement?.textContent).toBe(copy('action.keepPlaying'));
    m.render(<StopSheet open={false} variant="ranked-after-note" onKeep={vi.fn()} onStop={vi.fn()} />);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Skip after reveal', () => {
  it('asks, with the practice notice only when the limit would be exceeded', () => {
    const onSkip = vi.fn();
    const onKeep = vi.fn();
    m = mount(<SkipSheet open limitExceeded={false} perRanked={5} onSkip={onSkip} onKeepReading={onKeep} />);
    expect(document.body.textContent).toContain(copy('dialog.skip.title'));
    expect(document.body.textContent).not.toContain('Your next excerpt will be practice');
    click(button(copy('action.skip')));
    expect(onSkip).toHaveBeenCalled();
    m.render(<SkipSheet open limitExceeded perRanked={5} onSkip={onSkip} onKeepReading={onKeep} />);
    expect(document.body.textContent).toContain('Your next excerpt will be practice: one skip per 5 ranked takes.');
    click(button(copy('action.keepReading')));
    expect(onKeep).toHaveBeenCalled();
  });

  it('the skip toast ends with the credit', () => {
    expect(skipToastText('Bach · Air')).toBe('That was: Bach · Air');
  });
});

describe('Rank-up card', () => {
  it('shows the emblem, the headline and the next requirement from progression.json', () => {
    const onContinue = vi.fn();
    m = mount(<RankUpCard open configs={cfg} rank={4} name="Section player" onContinue={onContinue} />);
    expect(document.body.textContent).toContain(copy('rankup.headline', { rank: 'Section player' }));
    expect(document.querySelector('.dom-rank[data-size="96"]')).toBeTruthy();
    expect($('[data-testid="rankup-card"]').textContent).toContain('Ensemble player, at 5,000 XP and difficulty 5 on any instrument.');
    click(button(copy('action.continue')));
    expect(onContinue).toHaveBeenCalled();
  });

  it('the top rank has no next requirement', () => {
    expect(nextRankRequirement(cfg, 10)).toBe("That's the top rank.");
  });
});

describe('Install coach', () => {
  const rec = (os: string, mode: string, over: Partial<AttemptRecord> = {}): AttemptRecord => {
    const a = attemptFrom('case01-perfect-flute-l4', over);
    a.audioEnv = { ...a.audioEnv, osFamily: os as never, displayMode: mode as never };
    return a;
  };
  const settings = (shown: boolean): Pick<AppSettings, 'shown'> => ({ shown: { installCoach: shown, autoLockHint: false } });

  it('is due only on iOS Safari in a tab, for a graded take, once', () => {
    expect(installCoachDue(rec('ios', 'browser'), settings(false))).toBe(true);
    expect(installCoachDue(rec('ipados', 'browser'), settings(false))).toBe(true);
    expect(installCoachDue(rec('ios', 'standalone'), settings(false))).toBe(false);
    expect(installCoachDue(rec('macos', 'browser'), settings(false))).toBe(false);
    expect(installCoachDue(rec('ios', 'browser'), settings(true))).toBe(false);
    expect(installCoachDue(rec('ios', 'browser', { score: null }), settings(false))).toBe(false);
    expect(installCoachDue(null, settings(false))).toBe(false);
  });

  it('shows the instruction and Got it', () => {
    const onGotIt = vi.fn();
    m = mount(<InstallCoach open onGotIt={onGotIt} />);
    expect($('[data-testid="install-coach"]').textContent).toContain(copy('install.coach'));
    click(button(copy('action.gotIt')));
    expect(onGotIt).toHaveBeenCalled();
  });
});

describe('Session summary', () => {
  const attempts = (): AttemptRecord[] => [
    attemptFrom('case01-perfect-flute-l4', { id: 'a1' }),
    attemptFrom('case05-key-signature-f-sharp', { id: 'a2' }),
    attemptFrom('case09-trumpet-wrong-partial', { id: 'a3', instrumentId: 'flute' }),
  ];

  it('totals takes, average, XP, best take and the top patterns', () => {
    const list = attempts();
    const data = summarizeSession(list, cfg, makeProfile({ streak: { days: 4, lastDay: '2026-01-02' } }), []);
    expect(data.takes).toBe(3);
    const scores = list.map((a) => a.score!.score);
    expect(data.averageScore).toBe(Math.round(scores.reduce((a, b) => a + b, 0) / 3));
    expect(data.xp).toBe(list.reduce((n, a) => n + a.score!.xp.total, 0));
    expect(data.best!.score).toBe(Math.max(...scores));
    expect(data.patterns.length).toBeLessThanOrEqual(3);
    expect(data.streakDays).toBe(4);
    expect(data.focus).toBeNull();
  });

  it('the focus card appears when one pattern was primary in 3 of the last 5', () => {
    const data = summarizeSession(attempts(), cfg, makeProfile(), ['E12', 'E3', 'E12', 'E12', 'E9']);
    expect(data.focus).toEqual({ id: 'E12', name: cfg.tips.patterns.find((p) => p.id === 'E12')!.name });
    expect(summarizeSession(attempts(), cfg, makeProfile(), ['E12', 'E3', 'E12', 'E9', 'E9']).focus).toBeNull();
  });

  it('is due every 10 attempts', () => {
    expect(summaryDue(10, cfg)).toBe(true);
    expect(summaryDue(20, cfg)).toBe(true);
    expect(summaryDue(9, cfg)).toBe(false);
    expect(summaryDue(0, cfg)).toBe(false);
  });

  it('renders the list, a link to the best take and the focus card, with Keep going and Finish', () => {
    const onKeepGoing = vi.fn();
    const onFinish = vi.fn();
    const data = summarizeSession(attempts(), cfg, makeProfile(), ['E12', 'E12', 'E12']);
    const table = createRouteTable();
    const loc: LocationSource = { getHash: () => '#/', subscribe: () => () => {}, navigate: () => {} };
    m = mount(
      <RouterProvider table={table} source={loc}>
        <SessionSummary open data={data} onKeepGoing={onKeepGoing} onFinish={onFinish} />
      </RouterProvider>,
    );
    expect($('[data-testid="session-summary"]').textContent).toContain('3 takes');
    expect($('[data-testid="summary-best"] a').getAttribute('href')).toBe(`#/history/${data.best!.attemptId}`);
    expect($('[data-testid="summary-focus"]').textContent).toBe(copy('session.focusCard', { pattern: data.focus!.name }));
    click(button(copy('action.finish')));
    expect(onFinish).toHaveBeenCalled();
    click(button(copy('action.keepGoing')));
    expect(onKeepGoing).toHaveBeenCalled();
  });

  it('says so when there are no takes', () => {
    m = mount(
      <SessionSummary open data={summarizeSession([], cfg, undefined, [])} onKeepGoing={vi.fn()} onFinish={vi.fn()} />,
    );
    expect(document.body.textContent).toContain('No takes in this session yet.');
  });
});

// ---- the tips interstitial ---------------------------------------------------------------

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

function Outlet() {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

function renderTips(record: AttemptRecord | null, tips: Tip[], extra: Partial<TipsServices> = {}) {
  const store = sessionStore({ record, tips });
  const settings = box<AppSettings>(defaultAppSettings());
  const profile: Readable<PlayerProfile | undefined> = box<PlayerProfile | undefined>(makeProfile());
  const hash = { value: '#/practice/tips' };
  const ls = new Set<() => void>();
  const loc: LocationSource = {
    getHash: () => hash.value,
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
    navigate(path) {
      hash.value = `#${path}`;
      ls.forEach((l) => l());
    },
  };
  const services: TipsServices = { configs: cfg, session: store, settings, profile, sessionAttempts: () => (record ? [record] : []), ...extra };
  // The shell redirects `#/practice/tips` (decision 13) until results folds tips in and removes this screen (wave 4);
  // the redirect is dropped here so the screen itself stays covered while it exists.
  const table = createRouteTable({ 'practice.tips': createTipsScreen(services) }).map((r) =>
    r.id === 'practice.tips' ? { ...r, redirect: undefined } : r,
  );
  m = mount(
    <RouterProvider table={table} source={loc}>
      <Outlet />
    </RouterProvider>,
  );
  return { hash, settings, store };
}

describe('Tips interstitial (04 5.6)', () => {
  it('shows the primary tip with its header, pattern name, text and an evidence line with bar numbers', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const tips = tipsFor(rec);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.length).toBeLessThanOrEqual(2);
    renderTips(rec, tips);
    const primary = tips.find((t) => t.primary) ?? tips[0]!;
    const def = cfg.tips.patterns.find((p) => p.id === primary.patternId)!;
    expect($('.dom-tip-headline').textContent).toBe(def.name);
    expect($('.dom-tip-body').textContent).toBe(primary.text);
    expect($('.dom-tip-evidence').textContent).toMatch(/\d/);
    // 06 6.15: the card is titled "One thing to try"; "Before the next one" names the screen region.
    expect($('.dom-tip-title').textContent).toBe(copy('results.tip.title'));
    expect($('[data-testid="screen-practice.tips"]').getAttribute('aria-label')).toBe(copy('tips.header'));
    expect($('.dom-tip-who').textContent).toContain(cfg.instrumentById['flute']!.label);
  });

  it('never shows more than two tips and puts the second behind "Show 1 more tip"', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const base = tipsFor(rec)[0]!;
    const tips: Tip[] = [
      { ...base, primary: true },
      { ...base, id: 'U99', primary: false, patternId: 'E1', evidence: 'Seen in bars 2, 3.' },
      { ...base, id: 'U98', primary: false, patternId: 'E2', evidence: 'Seen in bars 4, 5.' },
    ];
    renderTips(rec, tips);
    expect(document.querySelectorAll('.dom-tip-headline')).toHaveLength(1);
    expect(document.querySelectorAll('.dom-tip-also')).toHaveLength(1);
    expect($('.dom-tip-also').textContent).toBe(copy('results.tip.more', { n: 1 }));
    expect($('.dom-tip-also').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector<HTMLElement>('.dom-tip-panel')?.hidden).toBe(true);
    expect(document.querySelector('.dom-tip-panel .dom-tip-evidence')?.textContent).toBe('Seen in bars 2, 3.');
    expect(document.querySelector('.dom-tip-header')?.textContent).toContain('(1 of 2)');
  });

  it('a clean read shows one Clean read card', () => {
    const rec = attemptFrom('case01-perfect-flute-l4');
    const clean = cfg.tips.selection.cleanReadPatternId;
    const tip: Tip = { id: cfg.tips.selection.cleanReadTipId, patternId: clean, text: 'Steady.', evidence: 'Seen in bars 1 and 2.', bars: [1, 2], primary: true };
    renderTips(rec, [tip]);
    expect($('.dom-tip-headline').textContent).toBe(copy('tips.cleanRead'));
    expect(document.querySelectorAll('.dom-tip')).toHaveLength(1);
  });

  it('an incomplete take adds the "got away" line', () => {
    const rec = attemptFrom('case10-incomplete');
    renderTips(rec, []);
    expect($('[data-testid="tips-none"]').textContent).toBe(copy('tips.incomplete'));
    const withE6 = tipsFor(rec);
    m?.unmount();
    document.body.innerHTML = '';
    if (withE6.length) {
      renderTips(rec, withE6);
      expect(document.body.textContent).toContain(copy('tips.incomplete'));
    }
  });

  it('Next excerpt goes to the scan, calling the service first', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const onNext = vi.fn();
    const r = renderTips(rec, tipsFor(rec), { onNext });
    expect(document.activeElement?.textContent).toBe(copy('action.nextExcerpt'));
    click(button(copy('action.nextExcerpt')));
    expect(onNext).toHaveBeenCalled();
    expect(r.hash.value).toBe('#/practice/scan');
  });

  it('a handled Next does not navigate', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const r = renderTips(rec, tipsFor(rec), { onNext: () => true });
    click(button(copy('action.nextExcerpt')));
    expect(r.hash.value).toBe('#/practice/tips');
  });

  it('the checkbox turns the interstitial off in settings', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const r = renderTips(rec, tipsFor(rec));
    const input = $<HTMLInputElement>('input[role="switch"]');
    expect(input.checked).toBe(true);
    act(() => input.click());
    expect(r.settings.get().practicePrefs.showTips).toBe(false);
  });

  it('Done for now opens the summary; Finish calls the service and goes Home; Keep going moves on', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const onFinish = vi.fn();
    const r = renderTips(rec, tipsFor(rec), { onFinish });
    click(button(copy('action.doneForNow')));
    expect($('[data-testid="session-summary"]')).toBeTruthy();
    click(button(copy('action.finish')));
    expect(onFinish).toHaveBeenCalled();
    expect(r.hash.value).toBe('#/');
  });

  it('without a record it returns Home', () => {
    const r = renderTips(null, []);
    expect(r.hash.value).toBe('#/');
  });
});
