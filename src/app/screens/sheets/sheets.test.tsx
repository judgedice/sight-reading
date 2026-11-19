// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, AttemptRecord } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { attemptFrom, cfg, makeProfile, sessionStore, tipsFor } from '../results/test-data.ts';
import {
  InstallCoach,
  RankUpCard,
  SessionSummary,
  SkipSheet,
  StopSheet,
  installCoachDue,
  nextRankRequirement,
  skipToastText,
  stopVariant,
  summarizeSession,
  summaryDue,
  tipsScreenOverrides,
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

/** The redesign's confirm skin (06 section 6.7): 480 wide, the actions in the fixed foot, the safe choice last (bottom right) and primary. */
function footActions(): { labels: string[]; primary: string | null } {
  const foot = $('[data-testid="modal-foot"]');
  const buttons = [...foot.querySelectorAll('button')];
  return { labels: buttons.map((b) => b.textContent ?? ''), primary: buttons.find((b) => b.classList.contains('ui-button-primary'))?.textContent ?? null };
}

describe('the tips step is gone from the loop (05 section 3.1)', () => {
  it('#/practice/tips keeps the route redirect; its screen draws nothing and goes to the open result, else Practice', () => {
    const record = attemptFrom('case01-perfect-flute-l4');
    const services = { configs: cfg, session: sessionStore({ record }), sessionAttempts: () => [] } as unknown as TipsServices;
    const tips = createRouteTable(tipsScreenOverrides(services)).find((r) => r.id === 'practice.tips')!;
    expect(tips.redirect?.({ resultOpen: true } as never)).toBe('/practice/results');
    expect(tips.redirect?.({ resultOpen: false } as never)).toBe('/');
    const run = (svc: TipsServices): string => {
      const hash = { value: '#/practice/tips' };
      const loc: LocationSource = { getHash: () => hash.value, subscribe: () => () => undefined, navigate: (p) => void (hash.value = `#${p}`) };
      const table = createRouteTable(tipsScreenOverrides(svc)).map((r) => (r.id === 'practice.tips' ? { ...r, redirect: undefined } : r));
      const Screen = table.find((r) => r.id === 'practice.tips')!.Screen;
      m = mount(
        <RouterProvider table={table} source={loc}>
          <Screen route={{ def: table.find((r) => r.id === 'practice.tips')!, params: {}, path: '/practice/tips' } as never} />
        </RouterProvider>,
      );
      expect(document.querySelector('[data-testid="screen-practice.tips"]')).toBeNull();
      m.unmount();
      m = null;
      return hash.value;
    };
    expect(run(services)).toBe('#/practice/results');
    expect(run({ ...services, session: sessionStore({ record: null }) })).toBe('#/');
  });

  it('the session summary still lists each top pattern with its tip text', () => {
    const rec = attemptFrom('case05-key-signature-f-sharp');
    const tips = tipsFor(rec);
    const data = summarizeSession([rec], cfg, makeProfile(), []);
    if (tips.length) expect(data.patterns.length).toBeGreaterThan(0);
  });
});

describe('Stop confirm (04 5.10)', () => {
  it('is a 480 confirm with Stop and the safe choice in the fixed foot, the safe choice primary on the right', () => {
    m = mount(<StopSheet open variant="ranked-after-note" onKeep={vi.fn()} onStop={vi.fn()} />);
    expect(document.querySelector('.ui-modal')?.classList.contains('ui-modal-confirm')).toBe(true);
    expect(footActions()).toEqual({ labels: [copy('action.stop'), copy('action.keepPlaying')], primary: copy('action.keepPlaying') });
    m.render(<StopSheet open variant="ranked-before-note" onKeep={vi.fn()} onStop={vi.fn()} onRestart={vi.fn()} />);
    expect(footActions()).toEqual({ labels: [copy('action.stop'), copy('action.restart')], primary: copy('action.restart') });
  });

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
    // The safe choice sits last (bottom right): Tab from it wraps to Stop.
    button(copy('action.keepPlaying')).focus();
    key(document, 'Tab');
    expect(document.activeElement?.textContent).toBe(copy('action.stop'));
    m.render(<StopSheet open={false} variant="ranked-after-note" onKeep={vi.fn()} onStop={vi.fn()} />);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Skip after reveal', () => {
  it('is a 480 confirm; Keep reading is primary, focused and on the right', () => {
    m = mount(<SkipSheet open limitExceeded={false} perRanked={5} onSkip={vi.fn()} onKeepReading={vi.fn()} />);
    expect(document.querySelector('.ui-modal')?.classList.contains('ui-modal-confirm')).toBe(true);
    expect(footActions()).toEqual({ labels: [copy('action.skip'), copy('action.keepReading')], primary: copy('action.keepReading') });
    expect(document.activeElement?.textContent).toBe(copy('action.keepReading'));
  });

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

describe('sheet skins (06 section 6.7)', () => {
  it('the session summary keeps Finish and Keep going in the fixed foot, Keep going primary and focused', () => {
    m = mount(<SessionSummary open data={summarizeSession([], cfg, undefined, [])} onKeepGoing={vi.fn()} onFinish={vi.fn()} />);
    expect(footActions()).toEqual({ labels: [copy('action.finish'), copy('action.keepGoing')], primary: copy('action.keepGoing') });
    expect(document.activeElement?.textContent).toBe(copy('action.keepGoing'));
  });

  it('the rank-up card is a 480 confirm with the emblem on its brass wash and one Continue', () => {
    m = mount(<RankUpCard open configs={cfg} rank={4} name="Section player" onContinue={vi.fn()} />);
    expect(document.querySelector('.ui-modal')?.classList.contains('ui-modal-confirm')).toBe(true);
    expect($('.sheet-emblem .dom-rank')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(copy('action.continue'));
  });
});
