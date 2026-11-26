// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { loadConfigs } from '../../../rules/index.ts';
import { loadScales } from '../../../corpus/index.ts';
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
import type { CalStatus } from '../../compose/calibration-status.ts';
import type { HomeBanner, HomeServices, LastTry, Readable } from './services.ts';
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
  cal: ReturnType<typeof store<CalStatus>>;
  last: ReturnType<typeof store<LastTry | null>>;
  matched: number[];
}

const NOT_CALIBRATED: CalStatus = { state: 'none', output: null, oldOutput: null, when: null, ms: null, reason: null };

function fixture(
  over: { eligible?: HomeServices['countEligible']; profile?: PlayerProfile | undefined; practice?: Partial<PracticeSettings>; turnOnMic?: HomeServices['turnOnMic'] } = {},
): Fixture {
  const base = defaultAppSettings();
  // Practice by default: its difficulty is free (Ranked is locked at the player's own, R76); Ranked has its own tests.
  const settings = store<AppSettings>({ ...base, practice: { ...base.practice, mode: 'practice', ...over.practice } });
  const started: PracticeSettings[] = [];
  const banners = store<readonly HomeBanner[]>([]);
  const availability = store<RankedAvailability>({ available: true, block: null });
  const session = createStore<SessionView>(() => initialSessionView());
  const heard = { tempo: [] as [number, number][], notes: [] as number[], stops: 0 };
  const cal = store<CalStatus>(NOT_CALIBRATED);
  const last = store<LastTry | null>(null);
  const matched: number[] = [];
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
    today: store({ takes: 9, ranked: 2, xp: 214, tries: 9 }),
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
    calibrationStatus: cal,
    lastTry: last,
    openMatch: () => matched.push(1),
    ...(over.turnOnMic ? { turnOnMic: over.turnOnMic } : {}),
  };
  return { services, settings, location, started, banners, availability, session, heard, cal, last, matched };
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
  it('shows the instrument card, Mode at the top of the setup card, the rows in order, the pill and Start in the foot; no Credits link', () => {
    render(fixture());
    // Difficulty 1 has one length: it sits at the right of the Tempo row (round 2, 04-design section 1).
    expect($$('[data-setup-slot]').map((el) => el.dataset['setupSlot'])).toEqual(['difficulty', 'key', 'time', 'tempo']);
    expect($('[data-setup-row="length"]', slot('tempo')).textContent).toBe(`${copy('row.length')}${copy('setup.length.chip', { bars: 8 })}`);
    const foot = $('[data-testid="setup-foot"]');
    // Mode sits at the top of the setup card, since what difficulty means depends on it (round 3, 01-ux-review §4.2).
    const form = $('[data-testid="setup-form"]');
    expect(form.firstElementChild?.querySelector('[data-setup-row="mode"]')).toBeTruthy();
    expect(foot.querySelector('[data-setup-row="mode"]')).toBeNull();
    expect(foot.querySelector('#start-practice')!.textContent).toContain(copy('action.startPractice'));
    expect(foot.querySelector('[data-testid="mode-pill"]')!.getAttribute('data-mode')).toBe('practice');
    // No scroll area inside the setup (round 2, 01-ux section 6).
    expect(document.querySelector('[data-testid="setup-scroll"]')).toBeNull();
    m!.unmount();
    render(fixture({ practice: { level: 3 } }));
    expect($$('[data-setup-slot]').map((el) => el.dataset['setupSlot'])).toEqual(['difficulty', 'key', 'time', 'tempo', 'length']);
    expect(button(copy('setup.changeInstrument'))).toBeTruthy();
    expect($('[data-testid="range-picture"]')).toBeTruthy();
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === copy('common.credits'))).toBe(false);
    expect(document.querySelector('select')).toBeNull();
  });

  it('the instrument card reads "Voice · bass clef" and heads the picture "Your range / Tap a note to hear it" without a range sound', () => {
    render(fixture({ practice: { instrumentId: 'voice-baritone', level: 2 } }));
    const card = $('.home-inst');
    expect($('.home-inst-sub', card).textContent).toBe(copy('home.instrumentSub', { family: copy('onboarding.family.voice'), clef: copy('clef.bass') }));
    expect($('.home-inst-sub', card).textContent).toBe('Voice · bass clef');
    expect($('.home-range-title', card).textContent).toBe('Your range');
    expect($('.home-range-hint', card).textContent).toBe('Tap a note to hear it');
    m!.unmount();
    render(fixture({ practice: { instrumentId: 'cello' } }));
    expect($('.home-inst-sub').textContent).toBe(`${copy('onboarding.family.strings')} · ${copy('clef.bass')}`);
  });

  it('Start shows Space as a keycap, and Space starts unless a control has focus', () => {
    const f = fixture();
    render(f);
    const kbd = $('#start-practice kbd');
    expect(kbd.textContent).toBe(copy('shortcuts.spaceKey'));
    expect(kbd.getAttribute('aria-hidden')).toBe('true');
    expect($('#start-practice > span').textContent).toBe(copy('action.startPractice'));
    key($('[data-setup-slot="key"] [role="radio"]'), ' ');
    expect(f.started).toHaveLength(0);
    key(document.body, ' ');
    expect(f.started).toHaveLength(1);
  });

  it('Start saves the settings, then calls onStart; without onStart it goes to the cover', () => {
    const f = fixture();
    render(f);
    click($('#start-practice'));
    expect(f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({ instrumentId: 'flute', mode: 'practice' });
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
    expect(today.querySelector('.ui-visually-hidden')?.textContent).toBe('Streak 6 days · 9 tries · 214 XP today');
    expect($$('.home-nb', today).map((e) => e.textContent)).toEqual(['Streak 6 days', '9 tries', '214 XP today']);
    expect(document.body.textContent).toContain(copy('streak.atRisk', { n: 1, days: 6 }));
    const rank = $('[data-testid="rank-line"]');
    const next = cfg.progression.ranks.table.find((r) => r.rank === 3)!;
    expect(rank.textContent).toContain(` · `);
    expect(rank.textContent).toContain(next.name);
    const gate = copy('rank.bar.needsLevel', { level: next.minLevel });
    const profile = makeProfile({ rank: 2, xp: 420 });
    const needs = next.minLevel > Math.max(0, ...Object.values(profile.instruments).map((i) => i?.level ?? 0));
    expect(rank.textContent?.includes(gate)).toBe(needs);
    expect(rank.closest('.home-head')).not.toBeNull();
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

  it('leaves out a meter with too little music and names it; a thin meter carries a dot and says so in its name', () => {
    render(fixture({ practice: { level: 4 } }));
    const names = radiosIn('time').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(names.some((n) => n?.startsWith(copy('setup.time.a11y', { beats: 6, unit: 8 })))).toBe(false);
    expect(slot('time').textContent).toContain(copy('setup.time.noneShort', { meter: '6/8', level: 4 }));
    expect(names).toContain(copy('setup.time.a11yFew', { beats: 2, unit: 4 }));
    expect(radiosIn('time').find((r) => r.getAttribute('aria-label') === '2/4, few pieces')!.querySelector('.su-few-dot')).not.toBeNull();
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

  it('no Follow my progress switch (R76); Tempo is Any or a set tempo: random, then a value, then random', () => {
    const f = fixture({ practice: { level: 3, bpm: 'random' } });
    render(f);
    expect(slot('difficulty').querySelector('[role="switch"]')).toBeNull();
    // A stored "Follow my progress" reads as your difficulty and is written back as a number.
    act(() => f.settings.set({ ...f.settings.get(), practice: { ...practice(f), level: 'random' } }));
    expect(typeof practice(f).level).toBe('number');
    const [anyTempo, setTempo] = radiosIn('tempo');
    expect(anyTempo!.getAttribute('aria-checked')).toBe('true');
    click(setTempo!);
    expect(typeof practice(f).bpm).toBe('number');
    expect(slot('tempo').querySelector('input[type="range"]')).toBeTruthy();
    click(radiosIn('tempo')[0]!);
    expect(practice(f).bpm).toBe('random');
  });

  it('above eight keys the Key row is one button; its popover names the concert key for a transposing instrument', () => {
    const f = fixture({ practice: { instrumentId: 'trumpet-bb', level: 5 } });
    render(f);
    expect(radiosIn('key')).toHaveLength(0);
    const button = $('[data-key-button]', slot('key'));
    expect(button.textContent).toContain(copy('setup.key.any'));
    expect(slot('key').textContent).toContain(copy('setup.key.many', { n: 18, max: 4 }));
    click(button);
    const e = $$('[data-key-popover] [role="radio"]').find((r) => r.dataset['key'] === '4:major')!;
    expect(e.getAttribute('aria-label')).toContain(keyName(concertKey({ fifths: 4, mode: 'major' }, cfg.instrumentById['trumpet-bb']!)));
    click(e);
    expect(practice(f).writtenKey).toEqual({ fifths: 4, mode: 'major' });
  });

  it('difficulty 1: the key note says what it uses and what comes next, "Few pieces"; Match a note is in Warm up', () => {
    const f = fixture({ practice: { level: 1 }, eligible: (_i, _l, meter) => (meter === null ? 6 : 6) });
    render(f);
    expect(slot('key').textContent).toContain('Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2.');
    expect(document.body.textContent).not.toContain('More keys from');
    expect($('[data-setup-few]', slot('difficulty')).textContent).toContain(copy('home.levelFewMusic'));
    // The difficulty row no longer repeats the Warm up group's Match a note (round 3, one Warm up group).
    expect(document.querySelector('[data-setup-match]')).toBeNull();
    click($('.home-warmups [data-testid="match-entry"]'));
    expect(f.matched).toEqual([1]);
  });

  it('one XP line counts Any key, time and tempo, in either mode; none chosen asks for Any', () => {
    const f = fixture();
    render(f);
    expect($$('[data-setup-xp]')).toHaveLength(1);
    expect($('[data-setup-xp]').textContent).toBe(copy('setup.xp.line', { percent: 24 }));
    expect(document.body.textContent).not.toContain(copy('setup.xpTag', { percent: 8 }));
    click(radiosIn('key').find((r) => r.dataset['key'] === '1:major')!);
    expect($('[data-setup-xp]').textContent).toBe(copy('setup.xp.line', { percent: 16 }));
    click(button(copy('mode.practice')));
    expect(practice(f).mode).toBe('practice');
    expect($('[data-setup-xp]').textContent).toBe(copy('setup.xp.line', { percent: 16 }));
    click(radiosIn('time')[1]!);
    click(radiosIn('tempo')[1]!);
    expect($('[data-setup-xp]').textContent).toBe(copy('setup.xp.none'));
  });

  it('Hear the tempo plays one bar through the session; a range note plays its sounding pitch', () => {
    const f = fixture({ practice: { bpm: 70, meter: '3/4' } });
    render(f);
    click($('[data-hear-tempo]'));
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
  it('shows one notice at a time in priority order, and never a calibration or audio-delay banner (round 3, R80)', () => {
    const f = fixture();
    f.banners.set([{ kind: 'calibrate', seconds: 8 }, { kind: 'storage-loss' }, { kind: 'mic-off' }]);
    render(f);
    expect(document.body.textContent).toContain(copy('banner.storageLoss'));
    act(() => f.banners.set([{ kind: 'calibrate', seconds: 8 }, { kind: 'mic-off' }]));
    expect(document.body.textContent).toContain(copy('banner.micOff'));
    expect(document.body.textContent).not.toContain(copy('banner.bluetooth'));
    act(() => f.banners.set([{ kind: 'calibrate', seconds: 8 }]));
    expect(document.body.textContent).not.toContain('Calibrate once');
    expect(document.querySelector('.ui-banner, [role="alert"]')).toBeNull();
  });

  it('the header carries the calibration pill; it opens the detail with Calibrate', () => {
    const f = fixture();
    render(f);
    const pill = $('.home-head [data-testid="cal-status"]');
    expect(pill.textContent).toContain(copy('calStatus.none'));
    click(pill);
    click(button(copy('calStatus.action.calibrate')));
    expect(f.location.hash).toBe('#/calibrate?from=home');
  });

  it('the last-try line: grade, score and title, then All tries opens History; absent before the first try', () => {
    const f = fixture();
    render(f);
    expect(document.querySelector('[data-testid="last-try"]')).toBeNull();
    act(() => f.last.set({ id: 'a1', excerptId: 'e1', title: 'Melody in F major', grade: 'B', score: 84 }));
    const line = $('[data-testid="last-try"]');
    expect(line.textContent).toBe(`${copy('home.lastTry', { grade: 'B', score: 84, title: 'Melody in F major' })}·${copy('home.allTries')}`);
    expect($('b', line).textContent).toBe('B');
    act(() => f.last.set({ id: 'a2', excerptId: 'e1', title: 'Melody in F major', grade: null, score: null }));
    expect($('[data-testid="last-try"]').textContent).toContain(copy('home.lastTry.notGraded', { title: 'Melody in F major' }));
    click(button(copy('home.allTries')));
    expect(f.location.hash).toBe('#/history');
  });

  it('Play my range plays the four range notes in the instrument sound; while it plays the button stops it and the note is lit', () => {
    const f = fixture({ practice: { instrumentId: 'voice-baritone', level: 1 } });
    const state = store<{ playing: string | null; index: number | null; failed: boolean }>({ playing: null, index: null, failed: false });
    const played: [string, readonly number[]][] = [];
    let stopped = 0;
    f.services.pickerSound = {
      play: (id, midis) => {
        played.push([id, midis]);
        return Promise.resolve();
      },
      stop: () => {
        stopped++;
      },
      prepare: () => undefined,
      state,
    };
    render(f);
    expect(document.querySelector('.home-range-hint')).toBeNull();
    click($('[data-testid="play-range"]'));
    expect(played).toHaveLength(1);
    expect(played[0]![0]).toBe('voice-baritone');
    expect(played[0]![1]).toHaveLength(4);
    act(() => state.set({ playing: 'voice-baritone', index: 1, failed: false }));
    expect($('[data-testid="play-range"]').textContent).toBe(copy('picker.play.stop'));
    expect($('[data-sounding="true"]')).toBeTruthy();
    click($('[data-testid="play-range"]'));
    expect(stopped).toBe(1);
  });

  it('the instrument picker offers Play my range through the same picker sound, and never plays on selection', () => {
    const f = fixture({ practice: { instrumentId: 'flute', level: 1 } });
    const state = store<{ playing: string | null; index: number | null; failed: boolean }>({ playing: null, index: null, failed: false });
    const played: string[] = [];
    f.services.pickerSound = {
      play: (id) => {
        played.push(id);
        return Promise.resolve();
      },
      stop: () => undefined,
      prepare: () => undefined,
      state,
    };
    render(f);
    click(button(copy('setup.changeInstrument')));
    click($('[data-instrument="voice-baritone"]'));
    expect(played).toEqual([]);
    click(button(copy('picker.play.range'), $('[role="dialog"]')));
    expect(played).toEqual(['voice-baritone']);
  });

  it('the Match a note row on the instrument card opens Match a note', () => {
    const f = fixture({ practice: { instrumentId: 'voice-baritone' } });
    render(f);
    const row = $('.home-inst [data-testid="match-entry"]');
    expect(row.textContent).toBe(`${copy('match.entry')}${copy('home.matchEntry.body')}`);
    click(row);
    expect(f.matched).toEqual([1]);
  });

  it('Ranked unavailable: practice is shown, the reason and the fix are visible, Start sends practice', () => {
    const f = fixture({ practice: { mode: 'ranked' } });
    f.availability.set({ available: false, block: 'calibration' });
    render(f);
    // Practice first, then Ranked (round 3 mockups).
    const ranked = $$('[data-setup-row="mode"] [role="radio"]')[1]!;
    expect(ranked.textContent).toContain(copy('mode.ranked'));
    expect(ranked.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(ranked.getAttribute('aria-describedby')!)!;
    expect(reason.textContent).toBe(copy('setup.mode.blocked.calibration.link', { link: '' }).trim());
    click($('#start-practice'));
    expect(f.started[0]!.mode).toBe('practice');
    expect(practice(f).mode).toBe('ranked');
    // One Calibrate control: the link in the Mode line (the header pill reads "Not calibrated" and stays closed).
    const calibrate = $$('button').filter((b) => b.textContent?.trim() === copy('calStatus.action.calibrate'));
    expect(calibrate).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Calibrate once');
    expect(document.body.textContent).not.toContain(copy('action.calibrateNow'));
    // Nothing says Ranked: the pill and Start say Practice (R79).
    expect($('[data-testid="setup-foot"] [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('practice');
    expect($('#start-practice').textContent).toContain(copy('action.startPractice'));
    click(calibrate[0]!);
    expect(f.location.hash).toBe('#/calibrate?from=home');
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

  it('shows Today, the summary chips (label above value), the calibration row, Mode, Start and the warm-up row', () => {
    const f = fixture({ practice: { instrumentId: 'voice-baritone', level: 2, writtenKey: { fifths: 1, mode: 'major' }, meter: '4/4' } });
    render(f);
    expect(document.querySelector('[data-setup-slot]')).toBeNull();
    const chips = $$('[data-chip]');
    expect(chips.map((c) => c.dataset['chip'])).toEqual(['difficulty', 'key', 'time', 'tempo', 'length']);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      copy('setup.chip.a11y', { row: copy('row.level'), value: '2' }),
      copy('setup.chip.a11y', { row: copy('row.key'), value: 'G major' }),
      copy('setup.chip.a11y', { row: copy('row.time'), value: '4/4' }),
      copy('setup.chip.a11y', { row: copy('row.tempo'), value: copy('setup.time.any') }),
      copy('setup.chip.a11y', { row: copy('row.length'), value: copy('setup.length.chip', { bars: 8 }) }),
    ]);
    // The label has its own line; the chevron sits with the value (critique change 1).
    for (const c of chips) {
      expect(c.firstElementChild!.className).toBe('home-chip-label');
      expect(c.querySelector('.home-chip-line .home-chip-chevron')).not.toBeNull();
    }
    expect($('[data-chip="time"] .home-chip-label').textContent).toBe('Time signature');
    expect($('.home-summary-inst').textContent).toContain(copy('instrument.name.voice-baritone'));
    // The calibration status is the card's last row.
    expect($('.home-summary').lastElementChild!.getAttribute('data-testid')).toBe('cal-status');
    expect(document.querySelector('[data-testid="start-dock"]')).toBeNull();
    // No keyboard on a phone: no keycap on Start (06 mockup, Practice phone).
    expect(document.querySelector('#start-practice kbd')).toBeNull();
    expect($('.home-mode [data-setup-row="mode"]')).toBeTruthy();
    // One "Warm up" group, named the same as on the desktop (01-ux-review problem 12).
    expect($('[data-testid="match-entry"]').textContent).toBe(copy('match.entry'));
    expect($('.home-warmups .home-warmup-title').textContent).toBe(copy('home.warmup'));
    // Mode sits above the summary card on the phone (01-ux-review §4.2), the pill and Start below it.
    expect($('.home-mode').compareDocumentPosition($('.home-summary')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($('.home-go [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('practice');
    expect(document.querySelector('.home-rank-card')).toBeNull();
  });

  it('Ranked blocked by calibration: the calibration row is the one Calibrate control; the short last-try line', () => {
    const f = fixture();
    f.availability.set({ available: false, block: 'calibration' });
    f.last.set({ id: 'a1', excerptId: 'e1', title: 'Melody in F major', grade: 'B', score: 84 });
    render(f);
    expect($$('button').filter((b) => b.textContent?.includes(copy('calStatus.action.calibrate')))).toHaveLength(1);
    expect($('.home-mode').textContent).toContain(copy('setup.mode.blocked.calibration.link', { link: '' }).trim());
    expect($('[data-testid="last-try"]').textContent).toContain(copy('home.lastTry.short', { grade: 'B', score: 84 }));
    expect($('[data-testid="last-try"]').textContent).not.toContain('Melody');
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
    // Above eight keys the wide form folds them behind one button (04-design section 1).
    const folded = wide ? document.querySelector<HTMLElement>('[data-setup-slot="key"] [data-key-button]') : null;
    const keyRadios = (): HTMLElement[] => {
      if (!folded) return radiosIn('key');
      if (!document.querySelector('[data-key-popover]')) click(folded);
      return $$('[data-key-popover] [role="radio"]');
    };
    const keys = keyRadios().filter((r) => r.dataset['key']);
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
    click(keyRadios().find((r) => !r.dataset['key'])!);
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

  it('local suggestions offer Random time and the nearest level; Ranked offers Practice instead (R76)', () => {
    const c: SetupContext = { ...ctx, eligible: (_i, l, meter) => (meter !== null ? 0 : l === 2 || l === 3 || l === 4 ? 20 : 0) };
    const s = localSuggestions({ ...base, mode: 'practice', level: 3, meter: '4/4' }, c);
    expect(s).toEqual([{ meter: 'random' }, { level: 2 }]);
    expect(localSuggestions({ ...base, mode: 'ranked', level: 3, meter: '4/4' }, c)).toEqual([{ meter: 'random' }, { mode: 'practice' }]);
  });
});

describe('Scales on Practice (PLAN ruling 68)', () => {
  const scalesConfig = loadScales(read('config/scales.json'), cfg);
  function withScales(f: Fixture): { started: [string, number | null][] } {
    const started: [string, number | null][] = [];
    f.services.scales = scalesConfig;
    f.services.startScale = (id, bpm) => void started.push([id, bpm]);
    return { started };
  }

  it('the baritone gets a Scales row under Match a note; it opens the chooser, and a scale goes straight to the read-through', () => {
    const f = fixture({ practice: { instrumentId: 'voice-baritone' } });
    const { started } = withScales(f);
    render(f);
    const rows = $$('.home-inst .home-warmups > button').map((b) => b.getAttribute('data-testid'));
    expect(rows).toEqual(['match-entry', 'scales-entry']);
    const entry = $('.home-inst [data-testid="scales-entry"]');
    expect(entry.textContent).toBe(`${copy('scales.entry')}${copy('scales.entry.body')}`);
    expect(entry.getAttribute('aria-haspopup')).toBe('dialog');
    expect(document.querySelector('[data-testid="scales-chooser"]')).toBeNull();
    click(entry);
    const dialog = $('[role="dialog"]');
    expect(dialog.querySelector('h2')!.textContent).toBe(copy('scales.chooser.title'));
    const chooser = $('[data-testid="scales-chooser"]', dialog);
    const scaleRows = $$('[data-testid="scale-row"]', chooser);
    expect(scaleRows.map((r) => r.getAttribute('data-scale-id'))).toEqual(['five-note-c', 'five-note-d', 'five-note-bb', 'octave-c', 'octave-bb', 'arpeggio-c', 'octave-a-minor']);
    expect(scaleRows[2]!.textContent).toContain('Five-note scale in B♭ major');
    expect(scaleRows[2]!.textContent).toContain(copy('scales.row.detail', { pattern: copy('scales.pattern.five-note'), low: 'B♭2', high: 'F3', tempo: '♩ = 66' }));
    expect(chooser.textContent).toContain(copy('scales.chooser.practice'));
    click(scaleRows[1]!);
    expect(started).toEqual([['five-note-d', null]]);
    expect(f.location.hash).toBe('#/practice/scan');
    expect(document.querySelector('[data-testid="scales-chooser"]')).toBeNull();
  });

  it('the tempo set in the chooser goes to every scale, and Usual tempos puts each back', () => {
    const f = fixture({ practice: { instrumentId: 'voice-baritone' } });
    const { started } = withScales(f);
    render(f);
    click($('[data-testid="scales-entry"]'));
    const tempo = $('[data-testid="scales-tempo"]');
    expect(tempo.textContent).toContain(copy('scales.chooser.tempo.own'));
    click(button(copy('stepper.increase', { label: copy('scales.chooser.tempo') }), tempo));
    expect(tempo.textContent).toContain(copy('scales.chooser.tempo.set', { tempo: '♩ = 67' }));
    expect($$('[data-testid="scale-row"]').every((r) => r.textContent?.includes('♩ = 67'))).toBe(true);
    click(button(copy('scales.chooser.tempo.reset'), tempo));
    expect($('[data-testid="scale-row"][data-scale-id="arpeggio-c"]').textContent).toContain('♩ = 60');
    click(button(copy('stepper.decrease', { label: copy('scales.chooser.tempo') }), tempo));
    click($('[data-testid="scale-row"][data-scale-id="octave-c"]'));
    expect(started).toEqual([['octave-c', 65]]);
  });

  it('is hidden for an instrument with no scales, and without the scales config', () => {
    const flute = fixture({ practice: { instrumentId: 'flute' } });
    withScales(flute);
    render(flute);
    expect(document.querySelector('[data-testid="scales-entry"]')).toBeNull();
    expect(document.querySelector('[data-testid="match-entry"]')).not.toBeNull();
    m?.unmount();
    m = null;
    render(fixture({ practice: { instrumentId: 'voice-baritone' } }));
    expect(document.querySelector('[data-testid="scales-entry"]')).toBeNull();
  });

  it('phone: a "Sing a scale" row under the match row in the Warm up group, and the chooser is a sheet', () => {
    narrow = true;
    const f = fixture({ practice: { instrumentId: 'voice-baritone' } });
    withScales(f);
    render(f);
    const entry = $('[data-testid="scales-entry"]');
    expect(entry.textContent).toBe(copy('scales.entry'));
    expect(entry.previousElementSibling?.getAttribute('data-testid')).toBe('match-entry');
    click(entry);
    expect($('.ui-sheet [data-testid="scales-chooser"]')).toBeTruthy();
  });
});

describe('Home, round 3: mode honesty and difficulty (R76, R77, R79)', () => {
  const flute2 = (): PlayerProfile => {
    const p = makeProfile();
    return { ...p, instruments: { ...p.instruments, flute: { ...p.instruments['flute']!, level: 2 } } };
  };

  it('Ranked: the difficulty is a read-only row at your difficulty, the pill is brass and Start says "Start ranked try"', () => {
    const f = fixture({ profile: flute2(), practice: { mode: 'ranked', level: 5 } });
    render(f);
    expect(slot('difficulty').querySelector('.ui-stepper')).toBeNull();
    expect($('[data-locked="true"]', slot('difficulty')).textContent).toContain('Difficulty 2 of 10');
    expect(slot('difficulty').textContent).toContain(copy('setup.difficulty.rankedLocked'));
    expect($('[data-testid="setup-foot"] [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('ranked');
    expect($('#start-practice').textContent).toContain(copy('action.startRanked'));
    click($('#start-practice'));
    // What Start sends is the shown mode; the composition root serves Ranked at the player's level.
    expect(f.started[0]).toMatchObject({ mode: 'ranked' });
    // The Practice choice is kept for Practice.
    expect(practice(f).level).toBe(5);
  });

  it('Practice: a stepper at the chosen difficulty, the mark at yours, "One above your difficulty", and Find my difficulty when Ranked is available', () => {
    const f = fixture({ profile: flute2(), practice: { mode: 'practice', level: 3 } });
    let placed = 0;
    f.services.startPlacement = () => void placed++;
    render(f);
    expect(slot('difficulty').querySelector('.ui-stepper')).not.toBeNull();
    expect($('.su-diff-meter', slot('difficulty')).getAttribute('data-yours')).toBe('2');
    expect(slot('difficulty').textContent).toContain('One above your difficulty (2).');
    click($('[data-testid="find-difficulty"]'));
    expect(placed).toBe(1);
    expect(f.location.hash).toBe('#/practice/scan');
    m!.unmount();
    // Ranked not available: placement's pieces could not be ranked, so no link.
    const g = fixture({ profile: flute2(), practice: { mode: 'practice', level: 3 } });
    g.services.startPlacement = () => undefined;
    g.availability.set({ available: false, block: 'calibration' });
    render(g);
    expect(document.querySelector('[data-testid="find-difficulty"]')).toBeNull();
  });

  it('nothing says Ranked while the check has not answered (R79)', () => {
    const f = fixture({ practice: { mode: 'ranked' } });
    f.availability.set({ available: false, block: null });
    render(f);
    expect($('[data-testid="setup-foot"] [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('practice');
    expect($('#start-practice').textContent).toContain(copy('action.startPractice'));
    act(() => f.availability.set({ available: true, block: null }));
    expect($('[data-testid="setup-foot"] [data-testid="mode-pill"]').getAttribute('data-mode')).toBe('ranked');
  });

  it('R77: every piece at your difficulty read, Ranked offers the next difficulty early', () => {
    const f = fixture({ profile: flute2(), practice: { mode: 'ranked' } });
    const moved: [string, number][] = [];
    f.services.unseenRanked = (_id, level) => (level === 2 ? 0 : 5);
    f.services.moveUp = (id, to) => void moved.push([id, to]);
    render(f);
    expect($('[data-testid="exhausted-offer"]').textContent).toContain("You've read every piece at difficulty 2. Move up to difficulty 3, or practise pieces you've seen.");
    click(button(copy('action.goToLevel', { level: 3 })));
    expect(moved).toEqual([['flute', 3]]);
    m!.unmount();
    // Not in Practice, and not while unseen pieces remain.
    const g = fixture({ profile: flute2(), practice: { mode: 'practice' } });
    g.services.unseenRanked = () => 0;
    render(g);
    expect(document.querySelector('[data-testid="exhausted-offer"]')).toBeNull();
  });

  it('the tab and title are "Home"; Practice and Ranked are only modes (R78)', () => {
    render(fixture());
    expect($('.home-title').textContent).toBe('Home');
  });
});
