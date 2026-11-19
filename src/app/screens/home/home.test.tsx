// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { loadConfigs } from '../../../rules/index.ts';
import { countEligible } from '../../../corpus/select/index.ts';
import { shippedManifest } from '../../../corpus/select/testing/shipped.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { makeProfile } from '../../../store/test-data.ts';
import type { AppSettings, Configs, PlayerProfile, PracticeSettings } from '../../../core/types.ts';
import { initialSessionView, type RankedAvailability, type SessionView } from '../../../session/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, key, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { createHomeScreen, WIDE_QUERY } from './index.ts';
import type { HomeBanner, HomeServices, Readable } from './services.ts';
import { keyName, concertKey } from '../setup/key-names.ts';
import { allowedKeys, beatUnit, localSuggestions, normalize, randomBonusPercent, tempoRange, type SetupContext } from '../setup/model.ts';
import { SetupSheet } from '../setup/SetupSheet.tsx';

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
const manifest = shippedManifest((f) => readFileSync(join(process.cwd(), 'public/corpus/v1', f), 'utf8'));
const shippedEligible: HomeServices['countEligible'] = (id, level, meter) => countEligible(manifest, id, level, meter, cfg);

function store<T>(init: T): Readable<T> & { set(v: T): void } {
  let v = init;
  const ls = new Set<() => void>();
  return {
    get: () => v,
    set(n) {
      v = n;
      ls.forEach((l) => l());
    },
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

/** Music everywhere except: level 10 empty; 2/4 thin at every level (6, "few pieces"); 6/8 has 2 (left out). */
const defaultEligible = (_id: string, level: number, meter: string | null): number => {
  if (level === 10) return 0;
  if (meter === '2/4') return 6;
  if (meter === '6/8') return 2;
  if (meter === null) return level === 9 ? 4 : 30;
  return 12;
};

interface Fixture {
  services: HomeServices;
  settings: ReturnType<typeof store<AppSettings>>;
  location: LocationSource & { hash: string };
  started: PracticeSettings[];
  banners: ReturnType<typeof store<readonly HomeBanner[]>>;
  availability: ReturnType<typeof store<RankedAvailability>>;
  session: StoreApi<SessionView>;
  heard: { tempo: [number, number][]; notes: number[]; stops: number };
}

function fixture(
  over: { eligible?: HomeServices['countEligible']; profile?: PlayerProfile | undefined; practice?: Partial<PracticeSettings>; turnOnMic?: HomeServices['turnOnMic'] } = {},
): Fixture {
  const base = defaultAppSettings();
  const settings = store<AppSettings>({ ...base, practice: { ...base.practice, ...over.practice } });
  const started: PracticeSettings[] = [];
  const banners = store<readonly HomeBanner[]>([]);
  const availability = store<RankedAvailability>({ available: true, block: null });
  const session = createStore<SessionView>(() => initialSessionView());
  const heard = { tempo: [] as [number, number][], notes: [] as number[], stops: 0 };
  const listeners = new Set<() => void>();
  const location = {
    hash: '',
    getHash: () => location.hash,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    navigate(path: string) {
      location.hash = `#${path}`;
      listeners.forEach((l) => l());
    },
  };
  const services: HomeServices = {
    configs: cfg,
    countEligible: over.eligible ?? defaultEligible,
    settings: { get: settings.get, subscribe: settings.subscribe, set: settings.set },
    profile: store<PlayerProfile | undefined>('profile' in over ? over.profile : makeProfile({ rank: 2, xp: 420, streak: { days: 6, lastDay: '2026-05-04' } })),
    today: store({ takes: 9, ranked: 2, xp: 214 }),
    banners,
    dismissBanner: (k) => banners.set(banners.get().filter((b) => b.kind !== k)),
    moveUp: () => {},
    localDay: () => '2026-05-05',
    session,
    onStart: (s) => {
      started.push(s);
      return true;
    },
    hearTempo: (bpm, beats) => {
      heard.tempo.push([bpm, beats]);
      return Promise.resolve();
    },
    playNote: (midi) => {
      heard.notes.push(midi);
      return Promise.resolve();
    },
    stopSounds: () => {
      heard.stops++;
    },
    rankedAvailability: availability,
    ...(over.turnOnMic ? { turnOnMic: over.turnOnMic } : {}),
  };
  return { services, settings, location, started, banners, availability, session, heard };
}

// ---- Layout: wide (no matchMedia, as in jsdom) or narrow (a phone) ------------------------------------------------

let narrow = false;
beforeEach(() => {
  narrow = false;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: q === WIDE_QUERY ? !narrow : q.includes('max-width') ? narrow : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
});

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function Screen() {
  const route = useRoute();
  const { Screen: S } = route.def;
  return <S route={route} />;
}

function render(f: Fixture): void {
  const table = createRouteTable({ home: createHomeScreen(f.services) });
  m = mount(
    <RouterProvider table={table} source={f.location}>
      <Screen />
    </RouterProvider>,
  );
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const $$ = (sel: string, root: ParentNode = document): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];
const slot = (row: string): HTMLElement => $(`[data-setup-slot="${row}"]`);
const button = (name: string, root: ParentNode = document): HTMLButtonElement => {
  const b = $$('button', root).find((x) => (x.getAttribute('aria-label') ?? x.textContent?.trim()) === name);
  if (!b) throw new Error(`no button ${name}`);
  return b as HTMLButtonElement;
};
const radiosIn = (row: string): HTMLElement[] => $$('[role="radio"]', slot(row));
const flush = (): void => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
};
const practice = (f: Fixture): PracticeSettings => f.settings.get().practice;

describe('Practice screen, wide (1024 px and up)', () => {
  it('shows the instrument card, the setup rows in order, and Mode and Start in the foot; no Credits link', () => {
    render(fixture());
    expect($$('[data-setup-slot]').map((el) => el.dataset['setupSlot'])).toEqual(['difficulty', 'key', 'time', 'tempo', 'length']);
    const foot = $('[data-testid="setup-foot"]');
    expect(foot.querySelector('[data-setup-row="mode"]')).toBeTruthy();
    expect(foot.querySelector('#start-practice')!.textContent).toContain(copy('action.start'));
    expect($('[data-testid="setup-scroll"]').querySelector('[data-setup-row="mode"]')).toBeNull();
    expect(button(copy('setup.changeInstrument'))).toBeTruthy();
    expect($('[data-testid="range-picture"]')).toBeTruthy();
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === copy('common.credits'))).toBe(false);
    expect(document.querySelector('select')).toBeNull();
  });

  it('Start saves the settings, then calls onStart; without onStart it goes to the cover', () => {
    const f = fixture();
    render(f);
    click($('#start-practice'));
    expect(f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({ instrumentId: 'flute', mode: 'ranked' });
    m!.unmount();
    const g = fixture();
    delete (g.services as { onStart?: unknown }).onStart;
    render(g);
    click($('#start-practice'));
    expect(g.location.hash).toBe('#/practice/scan');
  });

  it('shows Today with non-breaking parts and the rank line, with the difficulty gate only while unmet', () => {
    render(fixture());
    const today = $('[data-testid="today-line"]');
    expect(today.getAttribute('aria-label')).toBe('Streak 6 days · 9 takes · 214 XP today');
    expect($$('.home-nb', today).map((e) => e.textContent)).toEqual(['Streak 6 days', '9 takes', '214 XP today']);
    expect(document.body.textContent).toContain(copy('streak.atRisk', { n: 1, days: 6 }));
    const rank = $('[data-testid="rank-line"]');
    const next = cfg.progression.ranks.table.find((r) => r.rank === 3)!;
    expect(rank.textContent).toContain(` · `);
    expect(rank.textContent).toContain(next.name);
    const gate = copy('rank.bar.needsLevel', { level: next.minLevel });
    const profile = makeProfile({ rank: 2, xp: 420 });
    const needs = next.minLevel > Math.max(0, ...Object.values(profile.instruments).map((i) => i?.level ?? 0));
    expect(rank.textContent?.includes(gate)).toBe(needs);
    const now = Number($('[role="progressbar"]', rank).getAttribute('aria-valuenow'));
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(100);
  });

  it('steps over a difficulty with no music and says so; a thin difficulty says few pieces', () => {
    const f = fixture({ practice: { level: 9 } });
    render(f);
    expect(slot('difficulty').textContent).toContain(copy('home.levelFewMusic'));
    expect(slot('difficulty').textContent).toContain(copy('home.levelNoMusic', { instrument: 'Flute', levels: '10' }));
    const plus = $$('.ui-stepper-button', slot('difficulty'))[1]!;
    expect(plus.getAttribute('aria-disabled')).toBe('true');
  });

  it('leaves out a meter with too little music and names it; a thin meter says few pieces', () => {
    render(fixture({ practice: { level: 4 } }));
    const names = radiosIn('time').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names.some((n) => n?.startsWith(copy('setup.time.a11y', { beats: 6, unit: 8 })))).toBe(false);
    expect(slot('time').textContent).toContain('6/8');
    expect(slot('time').textContent).toContain(copy('setup.time.few'));
  });

  it('a difficulty change re-filters key, meter and length, keeps what is still valid, and shows the fallback note', async () => {
    vi.useFakeTimers();
    const f = fixture({ practice: { level: 6, writtenKey: { fifths: 5, mode: 'major' }, meter: '4/4', bpm: 120, bars: 12 } });
    render(f);
    click($$('.ui-stepper-button', slot('difficulty'))[0]!); // difficulty 5: up to 4 accidentals, no 12 bars, tempo max 112
    const p = practice(f);
    expect(p.level).toBe(5);
    expect(p.writtenKey).toBe('random');
    expect(p.meter).toBe('4/4');
    expect(p.bars).toBe('random');
    expect(p.bpm).toBe(112);
    const note = copy('setup.fallback.key', { key: keyName({ fifths: 5, mode: 'major' }), level: 5 });
    expect(slot('key').textContent).toContain(note);
    await act(async () => {
      await Promise.resolve();
    });
    const live = $('[role="status"].setup-live').textContent ?? '';
    expect(live).toContain(note);
    expect(live).toContain(copy('setup.fallback.length', { bars: 12, level: 5 }));
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(slot('key').textContent).not.toContain(note);
  });

  it('Follow my progress and Any tempo are switches: on sends random, off sends a value', () => {
    const f = fixture({ practice: { level: 3, bpm: 'random' } });
    render(f);
    const follow = $('[role="switch"]', slot('difficulty'));
    click(follow);
    expect(practice(f).level).toBe('random');
    expect(slot('difficulty').querySelector('.ui-stepper')).toBeNull();
    click($('[role="switch"]', slot('difficulty')));
    expect(typeof practice(f).level).toBe('number');
    const anyTempo = $<HTMLInputElement>('[role="switch"]', slot('tempo'));
    expect(anyTempo.checked).toBe(true);
    click(anyTempo);
    expect(typeof practice(f).bpm).toBe('number');
    expect(slot('tempo').querySelector('input[type="range"]')).toBeTruthy();
    click($('[role="switch"]', slot('tempo')));
    expect(practice(f).bpm).toBe('random');
  });

  it('shows the concert key under each key for a transposing instrument', () => {
    render(fixture({ practice: { instrumentId: 'trumpet-bb', level: 5 } }));
    const e = radiosIn('key').find((r) => r.dataset['key'] === '4:major')!;
    expect(e.textContent).toContain(copy('setup.key.concert', { key: keyName(concertKey({ fifths: 4, mode: 'major' }, cfg.instrumentById['trumpet-bb']!)) }));
  });

  it('the XP line counts Any key, time and tempo, and is hidden in practice', () => {
    const f = fixture();
    render(f);
    expect($('[data-setup-xp]').textContent).toBe(copy('xp.randomHint', { percent: 24 }));
    click(radiosIn('key').find((r) => r.dataset['key'] === '1:major')!);
    expect($('[data-setup-xp]').textContent).toBe(copy('xp.randomHint', { percent: 16 }));
    click(button(copy('mode.practice')));
    expect(practice(f).mode).toBe('practice');
    expect(document.querySelector('[data-setup-xp]')).toBeNull();
  });

  it('Hear the tempo plays one bar through the session; a range note plays its sounding pitch', () => {
    const f = fixture({ practice: { bpm: 70, meter: '3/4' } });
    render(f);
    click(button(copy('action.hearTempo')));
    expect(f.heard.tempo).toEqual([[70, 3]]);
    const note = $$('button', $('[data-testid="range-picture"]')).find((b) => b.getAttribute('aria-label')?.startsWith('Hear'))!;
    click(note);
    expect(f.heard.notes).toHaveLength(1);
    m!.unmount();
    m = null;
    expect(f.heard.stops).toBeGreaterThan(0);
  });

  it('Change instrument opens the picker; Done applies the new instrument', () => {
    const f = fixture();
    render(f);
    click(button(copy('setup.changeInstrument')));
    const card = $('[data-instrument="voice-baritone"]');
    click(card);
    click(button(copy('setup.done')));
    expect(practice(f).instrumentId).toBe('voice-baritone');
    expect($('.home-inst-name').textContent).toBe(copy('instrument.name.voice-baritone'));
  });
});

describe('Practice screen states', () => {
  it('shows one notice at a time in priority order', () => {
    const f = fixture();
    f.banners.set([{ kind: 'calibrate', seconds: 8 }, { kind: 'storage-loss' }, { kind: 'bluetooth' }]);
    render(f);
    expect(document.body.textContent).toContain(copy('banner.storageLoss'));
    expect(document.body.textContent).not.toContain(copy('banner.calibrateNeeded', { seconds: 8 }));
    act(() => f.banners.set([{ kind: 'calibrate', seconds: 8 }, { kind: 'bluetooth' }]));
    expect(document.body.textContent).toContain(copy('banner.calibrateNeeded', { seconds: 8 }));
    expect(document.body.textContent).not.toContain(copy('banner.bluetooth'));
    click(button(copy('action.calibrate')));
    expect(f.location.hash).toBe('#/calibrate');
  });

  it('Ranked unavailable: practice is shown, the reason and the fix are visible, Start sends practice', () => {
    const f = fixture();
    f.availability.set({ available: false, block: 'calibration' });
    render(f);
    const ranked = $$('[data-setup-row="mode"] [role="radio"]')[0]!;
    expect(ranked.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(ranked.getAttribute('aria-describedby')!)!;
    expect(reason.textContent).toBe(copy('setup.mode.blocked.calibration'));
    click($('#start-practice'));
    expect(f.started[0]!.mode).toBe('practice');
    expect(practice(f).mode).toBe('ranked');
    click(button(copy('action.calibrateNow')));
    expect(f.location.hash).toBe('#/calibrate');
  });

  it('permission denied: Turn on microphone that fails shows the browser steps', async () => {
    const f = fixture({ turnOnMic: () => Promise.resolve({ ok: false }) });
    f.availability.set({ available: false, block: 'mic' });
    f.banners.set([{ kind: 'mic-off' }]);
    render(f);
    expect(document.body.textContent).toContain(copy('banner.micOff'));
    await act(async () => {
      button(copy('action.turnOnMic')).click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain(copy('permission.denied.title'));
    expect(document.body.textContent).not.toContain(copy('banner.micOff'));
  });

  it('loading: Start reads Loading music…, is busy and does not start', () => {
    const f = fixture();
    render(f);
    act(() => f.session.setState({ state: 'loading' }));
    const start = $('#start-practice');
    expect(start.textContent).toContain(copy('home.loadingMusic'));
    expect(start.getAttribute('aria-busy')).toBe('true');
    click(start);
    expect(f.started).toHaveLength(0);
  });

  it('empty: the card offers one-tap fixes and Start is disabled with the card as its reason', () => {
    const f = fixture({ practice: { meter: '3/4', level: 3 } });
    render(f);
    act(() => f.session.setState({ emptyPoolSuggestions: [{ meter: 'random' }, { level: 2 }, { mode: 'practice' }] }));
    const card = $('[data-testid="empty-pool"]');
    expect(card.textContent).toContain(copy('setup.empty.title'));
    expect(document.querySelector('[data-setup-xp]')).toBeNull();
    const start = $('#start-practice');
    expect(start.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(start.getAttribute('aria-describedby')!)!.textContent).toBe(copy('setup.empty.title'));
    click(start);
    expect(f.started).toHaveLength(0);
    click(button(copy('home.selector.setTimeRandom'), card));
    expect(practice(f).meter).toBe('random');
    expect(document.querySelector('[data-testid="empty-pool"]')).toBeNull();
  });

  it('error: the library failed card has Try again, and the setup stays visible', () => {
    const f = fixture();
    render(f);
    act(() => f.session.setState({ state: 'error', error: { code: 'corpus-load' } }));
    const card = $('[data-testid="corpus-error"]');
    expect(card.textContent).toContain(copy('error.corpus'));
    expect($('[data-setup-slot="key"]')).toBeTruthy();
    click(button(copy('action.tryAgain'), card));
    expect(f.started).toHaveLength(1);
  });
});

describe('Practice screen, narrow (below 1024 px)', () => {
  beforeEach(() => {
    narrow = true;
  });

  it('shows Today, the summary chips in order with their values, the first-time hint, Mode, the rank card and the dock', () => {
    const f = fixture({ practice: { instrumentId: 'voice-baritone', level: 2, writtenKey: { fifths: 1, mode: 'major' }, meter: '4/4' } });
    render(f);
    expect(document.querySelector('[data-setup-slot]')).toBeNull();
    const chips = $$('[data-chip]');
    expect(chips.map((c) => c.dataset['chip'])).toEqual(['difficulty', 'key', 'time', 'tempo', 'length']);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      copy('setup.chip.a11y', { row: copy('row.level'), value: '2' }),
      copy('setup.chip.a11y', { row: copy('row.key'), value: 'G major' }),
      copy('setup.chip.a11y', { row: copy('row.time'), value: '4/4' }),
      copy('setup.chip.a11y', { row: copy('row.tempo'), value: copy('setup.length.any') }),
      copy('setup.chip.a11y', { row: copy('row.length'), value: copy('setup.length.chip', { bars: 8 }) }),
    ]);
    expect(document.body.textContent).toContain(copy('setup.firstTimeHint'));
    expect($('.home-summary-inst').textContent).toContain(copy('instrument.name.voice-baritone'));
    const dock = $('[data-testid="start-dock"]');
    expect(dock.querySelector('#start-practice')).toBeTruthy();
    expect(dock.querySelector('[data-setup-xp]')!.textContent).toBe(copy('xp.randomHint', { percent: 8 }));
    expect($('.home-mode [data-setup-row="mode"]')).toBeTruthy();
  });

  it('a chip opens the setup sheet at its row with focus on its control; Done returns focus to the chip', () => {
    vi.useFakeTimers();
    const f = fixture({ practice: { writtenKey: { fifths: 1, mode: 'major' } } });
    render(f);
    const chip = $('[data-chip="key"]');
    chip.focus();
    click(chip);
    const sheet = $('[data-testid="setup-sheet"]');
    expect(sheet.querySelector('[data-testid="range-picture"]')).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
    expect((document.activeElement as HTMLElement).dataset['key']).toBe('1:major');
    click(button(copy('setup.done')));
    flush();
    expect(document.querySelector('[data-testid="setup-sheet"]')).toBeNull();
    expect(document.activeElement).toBe($('[data-chip="key"]'));
  });

  it('Escape closes the sheet; changes made in it are kept', () => {
    vi.useFakeTimers();
    const f = fixture();
    render(f);
    click($('[data-chip="time"]'));
    expect(document.activeElement?.textContent).toContain(copy('setup.time.any'));
    click(radiosIn('time').find((r) => r.getAttribute('aria-label') === copy('setup.time.a11y', { beats: 3, unit: 4 }))!);
    expect(practice(f).meter).toBe('3/4');
    key(document, 'Escape');
    flush();
    expect(document.querySelector('[data-testid="setup-sheet"]')).toBeNull();
    expect($('[data-chip="time"]').getAttribute('aria-label')).toBe(copy('setup.chip.a11y', { row: copy('row.time'), value: '3/4' }));
    expect(document.activeElement).toBe($('[data-chip="time"]'));
  });

  it('the instrument row opens the picker', () => {
    const f = fixture();
    render(f);
    click($('.home-summary-inst'));
    click($('[data-instrument="voice-bass"]'));
    click(button(copy('setup.done')));
    expect(practice(f).instrumentId).toBe('voice-bass');
  });
});

/** Choosing a key and a meter reaches Start; choosing Any sends `random` (05 section 16 items 5 and 6). */
describe.each(['flute', 'voice-bass', 'voice-baritone', 'trumpet-bb'])('key and time are served (%s)', (instrumentId) => {
  const chooseAndStart = (f: Fixture, wide: boolean): void => {
    const open = (row: string): void => {
      if (!wide) click($(`[data-chip="${row}"]`));
    };
    const close = (): void => {
      if (!wide) click(button(copy('setup.done')));
    };
    open('key');
    const keys = radiosIn('key').filter((r) => r.dataset['key']);
    expect(keys.length).toBeGreaterThan(1);
    const chosenKey = keys[keys.length - 1]!.dataset['key']!;
    click(keys[keys.length - 1]!);
    close();
    open('time');
    const meters = radiosIn('time').slice(1);
    expect(meters.length).toBeGreaterThan(0);
    const label = meters[meters.length - 1]!.getAttribute('aria-label')!;
    click(meters[meters.length - 1]!);
    close();
    click($('#start-practice'));
    const s = f.started[f.started.length - 1]!;
    expect(s.instrumentId).toBe(instrumentId);
    expect(s.writtenKey).not.toBe('random');
    const k = s.writtenKey as { fifths: number; mode: string };
    expect(`${k.fifths}:${k.mode}`).toBe(chosenKey);
    const [beats, unit] = (s.meter as string).split('/').map(Number);
    expect(copy('setup.time.a11y', { beats: beats!, unit: unit! })).toBe(label.split(',')[0]);

    open('key');
    click(radiosIn('key')[0]!);
    close();
    open('time');
    click(radiosIn('time')[0]!);
    close();
    click($('#start-practice'));
    const any = f.started[f.started.length - 1]!;
    expect(any.writtenKey).toBe('random');
    expect(any.meter).toBe('random');
  };

  it('wide', () => {
    const f = fixture({ eligible: shippedEligible, practice: { instrumentId, level: 4, mode: 'practice' } });
    render(f);
    chooseAndStart(f, true);
  });

  it('narrow', () => {
    vi.useFakeTimers();
    narrow = true;
    const f = fixture({ eligible: shippedEligible, practice: { instrumentId, level: 4, mode: 'practice' } });
    render(f);
    chooseAndStart(f, false);
  });
});

describe('SetupSheet on its own (results uses it)', () => {
  it('applies changes as they are made and closes with Done', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const ctx: SetupContext = { cfg, eligible: defaultEligible, showBeta: false, playerLevel: () => 2 };
    const value = normalize(defaultAppSettings().practice, ctx);
    m = mount(<SetupSheet open value={value} ctx={ctx} onChange={onChange} onClose={onClose} row="key" />);
    click(radiosIn('key').find((r) => r.dataset['key'] === '0:major')!);
    expect(onChange.mock.calls[0]![0]).toMatchObject({ writtenKey: { fifths: 0, mode: 'major' } });
    click(button(copy('setup.done')));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('setup model', () => {
  const ctx: SetupContext = { cfg, eligible: defaultEligible, showBeta: false, playerLevel: () => 3 };
  const base = defaultAppSettings().practice;

  it('names keys and concert keys', () => {
    expect(keyName({ fifths: -3, mode: 'major' })).toBe('E♭ major');
    expect(keyName({ fifths: 0, mode: 'minor' })).toBe('A minor');
    expect(keyName({ fifths: 6, mode: 'major' })).toBe('F♯ major');
    const clar = cfg.instrumentById['clarinet-bb']!;
    expect(keyName(concertKey({ fifths: 2, mode: 'major' }, clar))).toBe('C major');
    const horn = cfg.instrumentById['horn-f']!;
    expect(keyName(concertKey({ fifths: 1, mode: 'major' }, horn))).toBe('C major');
  });

  it('level 1 allows majors with at most one accidental', () => {
    expect(allowedKeys(cfg.levelByNumber[1]!).map((k) => `${k.fifths}${k.mode}`)).toEqual(['-1major', '0major', '1major']);
  });

  it('compound meters use the dotted range on levels 4 and 5 and show a dotted beat', () => {
    expect(tempoRange(cfg, cfg.levelByNumber[4]!, '6/8')).toEqual({ min: 40, max: 66 });
    expect(tempoRange(cfg, cfg.levelByNumber[6]!, '6/8')).toEqual({ min: 72, max: 120 });
    expect(beatUnit('6/8')).toBe('♩.');
    expect(beatUnit('4/4')).toBe('♩');
  });

  it('random bonus follows 02: +8% each, cap +25%', () => {
    expect(randomBonusPercent(cfg, base)).toBe(24);
    expect(randomBonusPercent(cfg, { ...base, bpm: 80, meter: '4/4', writtenKey: { fifths: 0, mode: 'major' } })).toBe(0);
  });

  it('normalize moves off an empty level to the nearest level with music', () => {
    expect(normalize({ ...base, level: 10 }, ctx).level).toBe(9);
  });

  it('local suggestions offer Random time and the nearest level', () => {
    const c: SetupContext = { ...ctx, eligible: (_i, l, meter) => (meter !== null ? 0 : l === 2 || l === 3 || l === 4 ? 20 : 0) };
    const s = localSuggestions({ ...base, level: 3, meter: '4/4' }, c);
    expect(s).toEqual([{ meter: 'random' }, { level: 2 }]);
  });
});
