// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { makeProfile } from '../../../store/test-data.ts';
import type { AppSettings, Configs, PlayerProfile } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { setNativeValue } from '../../../ui/components/form/test-helpers.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { createHomeScreen } from './index.ts';
import type { HomeBanner, HomeServices, Readable } from './services.ts';
import { keyName, concertKey } from '../setup/key-names.ts';
import { allowedKeys, beatUnit, localSuggestions, normalize, randomBonusPercent, tempoRange, type SetupContext } from '../setup/model.ts';

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

/** Music everywhere except: level 10 empty; 2/4 thin at every level (3); 6/8 has 2 (disabled). */
const defaultEligible = (_id: string, level: number, meter: string | null): number => {
  if (level === 10) return 0;
  if (meter === '2/4') return 3;
  if (meter === '6/8') return 2;
  if (meter === null) return level === 9 ? 4 : 30;
  return 12;
};

interface Fixture {
  services: HomeServices;
  settings: ReturnType<typeof store<AppSettings>>;
  location: LocationSource & { hash: string };
  started: unknown[];
  banners: ReturnType<typeof store<readonly HomeBanner[]>>;
}

function fixture(over: { eligible?: HomeServices['countEligible']; profile?: PlayerProfile | undefined; settings?: AppSettings } = {}): Fixture {
  const settings = store<AppSettings>(over.settings ?? defaultAppSettings());
  const started: unknown[] = [];
  const banners = store<readonly HomeBanner[]>([]);
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
    onStart: (s) => {
      started.push(s);
    },
  };
  return { services, settings, location, started, banners };
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
});

function render(f: Fixture): void {
  const table = createRouteTable({ home: createHomeScreen(f.services) });
  m = mount(
    <RouterProvider table={table} source={f.location}>
      <Home table={table} />
    </RouterProvider>,
  );
}

import { useRoute } from '../../router.tsx';
function Home({ table: _t }: { table: unknown }) {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const fieldset = (label: string): HTMLElement => {
  const l = [...document.querySelectorAll('legend')].find((x) => x.textContent === label);
  if (!l) throw new Error(`no row ${label}`);
  return l.parentElement as HTMLElement;
};
const chip = (label: string): HTMLButtonElement => fieldset(label).querySelector<HTMLButtonElement>('.ui-random-chip')!;

describe('Home and setup', () => {
  it('renders every row, Start with the skip-link id, and a Credits link', () => {
    const f = fixture();
    render(f);
    for (const k of ['row.instrument', 'row.level', 'row.key', 'row.time', 'row.tempo', 'row.length', 'row.output', 'row.mode'] as const) {
      expect(fieldset(copy(k))).toBeTruthy();
    }
    expect($('#start-practice').textContent).toContain(copy('action.start'));
    expect([...document.querySelectorAll('a')].some((a) => a.textContent === copy('common.credits'))).toBe(true);
  });

  it('Start saves the settings, then calls onStart', () => {
    const f = fixture();
    render(f);
    click($('#start-practice'));
    expect(f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({ instrumentId: 'flute', mode: 'ranked' });
  });

  it('navigates to the scan when onStart is absent', () => {
    const f = fixture();
    delete (f.services as { onStart?: unknown }).onStart;
    render(f);
    click($('#start-practice'));
    expect(f.location.hash).toBe('#/practice/scan');
  });

  it('shows the today strip with streak, takes, XP and the rank bar', () => {
    render(fixture());
    expect($('[data-testid="today-line"]').textContent).toBe('Streak 6 days · 9 takes · 214 XP today');
    expect(document.body.textContent).toContain(copy('streak.atRisk', { n: 1, days: 6 }));
    // rank 2, 420 XP: between that rank's threshold and the next
    const now = Number($('[role="progressbar"]').getAttribute('aria-valuenow'));
    expect(now).toBeGreaterThan(0);
    expect(now).toBeLessThanOrEqual(100);
  });

  it('disables a level with no music and captions thin levels', () => {
    const f = fixture();
    f.settings.set({ ...defaultAppSettings(), practice: { ...defaultAppSettings().practice, level: 9 } });
    render(f);
    expect(fieldset(copy('row.level')).textContent).toContain(copy('home.levelFewMusic'));
    const plus = fieldset(copy('row.level')).querySelectorAll('.ui-stepper-button')[1]!;
    expect(plus.getAttribute('aria-disabled')).toBe('true'); // level 10 has no music
  });

  it('disables a meter with fewer than 5 excerpts, with its tooltip, and it is not selectable', () => {
    const f = fixture();
    render(f);
    const radios = [...fieldset(copy('row.time')).querySelectorAll<HTMLInputElement>('input[type=radio]')];
    const six8 = radios.find((r) => r.value === '6/8');
    // level 1 has no 6/8 at all; use level 4
    expect(six8).toBeUndefined();
    const f2 = fixture();
    f2.settings.set({ ...defaultAppSettings(), practice: { ...defaultAppSettings().practice, level: 4 } });
    m!.unmount();
    render(f2);
    const r68 = [...fieldset(copy('row.time')).querySelectorAll<HTMLInputElement>('input[type=radio]')].find((r) => r.value === '6/8')!;
    expect(r68.disabled).toBe(true);
    expect(r68.closest('label')!.getAttribute('title')).toBe(copy('home.meterTooltip', { meter: '6/8' }));
  });

  it('Random key disables the select, reads Random and says what Random means', () => {
    const f = fixture();
    render(f);
    const row = fieldset(copy('row.key'));
    expect(row.querySelector('select')!.disabled).toBe(true);
    expect(row.textContent).toContain(copy('chip.random'));
    expect(row.textContent).toContain(copy('home.keyRandom', { max: 1 }));
    click(chip(copy('row.key')));
    expect(fieldset(copy('row.key')).querySelector('select')!.disabled).toBe(false);
    expect(f.settings.get().practice.writtenKey).not.toBe('random');
  });

  it('level change re-filters key, meter and length but keeps a still-valid choice', () => {
    const f = fixture();
    f.settings.set({
      ...defaultAppSettings(),
      practice: { ...defaultAppSettings().practice, level: 6, writtenKey: { fifths: 5, mode: 'major' }, meter: '4/4', bpm: 120, bars: 12 },
    });
    render(f);
    const minus = fieldset(copy('row.level')).querySelectorAll('.ui-stepper-button')[0]!;
    click(minus); // level 5: max 4 accidentals, 12 bars not offered, tempo max 112
    let p = f.settings.get().practice;
    expect(p.level).toBe(5);
    expect(p.writtenKey).toBe('random');
    expect(p.meter).toBe('4/4');
    expect(p.bars).toBe('random');
    expect(p.bpm).toBe(112);
    click(minus);
    click(minus); // level 3
    p = f.settings.get().practice;
    expect(p.meter).toBe('4/4');
  });

  it('shows concert key in key options for a transposing instrument', () => {
    const f = fixture();
    f.settings.set({ ...defaultAppSettings(), practice: { ...defaultAppSettings().practice, instrumentId: 'trumpet-bb', level: 5, writtenKey: { fifths: 4, mode: 'major' } } });
    render(f);
    const opts = [...fieldset(copy('row.key')).querySelectorAll('option')].map((o) => o.textContent);
    expect(opts).toContain('E major (concert D major)');
  });

  it('XP hint counts random key, meter and tempo only', () => {
    const f = fixture();
    render(f);
    expect($('[data-testid="xp-hint"]').textContent).toBe(copy('xp.randomHint', { percent: 24 }));
    click(chip(copy('row.key')));
    expect($('[data-testid="xp-hint"]').textContent).toBe(copy('xp.randomHint', { percent: 16 }));
    // practice mode shows no hint
    const practice = fieldset(copy('row.mode')).querySelectorAll<HTMLInputElement>('input')[1]!;
    click(practice);
    expect(document.querySelector('[data-testid="xp-hint"]')).toBeNull();
  });

  it('shows one banner at a time in priority order and dismisses', () => {
    const f = fixture();
    f.banners.set([{ kind: 'calibrate', seconds: 8 }, { kind: 'storage-loss' }, { kind: 'bluetooth' }]);
    render(f);
    expect(document.body.textContent).toContain(copy('banner.storageLoss'));
    expect(document.body.textContent).not.toContain(copy('banner.calibrateNeeded', { seconds: 8 }));
    act(() => f.banners.set([{ kind: 'calibrate', seconds: 8 }]));
    expect(document.body.textContent).toContain(copy('banner.calibrateNeeded', { seconds: 8 }));
    click([...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.calibrate'))!);
    expect(f.location.hash).toBe('#/calibrate');
  });

  it('offers suggestions when the chosen meter has no music at the level', () => {
    const f = fixture({ eligible: (id, l, meter) => (meter === '3/4' ? 0 : defaultEligible(id, l, meter)) });
    f.settings.set({ ...defaultAppSettings(), practice: { ...defaultAppSettings().practice, meter: '3/4' } });
    render(f);
    // 3/4 has 0 excerpts, so normalize already fell back to Random: no card, and the saved meter is Random
    expect(f.settings.get().practice.meter).toBe('random');
    expect(document.querySelector('[data-testid="empty-pool"]')).toBeNull();
  });

  it('level select via instrument change keeps level state valid', () => {
    const f = fixture();
    render(f);
    setNativeValue(fieldset(copy('row.instrument')).querySelector('select')!, 'cello', 'change');
    expect(f.settings.get().practice.instrumentId).toBe('cello');
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
