// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { makeAttempt, makeCalibration, makeProfile, MemoryKv, memoryRepos } from '../../../store/test-data.ts';
import type { AppSettings, Configs, PlayerProfile } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { ToastProvider } from '../../../ui/primitives/index.ts';
import { setNativeValue, q } from '../../../ui/components/form/test-helpers.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { createSettingsScreen, type SettingsServices } from './index.ts';
import { text } from './text.ts';
import { sizeParts, normalizeDisplayName, patchSection } from './model.ts';
import { backupFileName } from './data-io.ts';
import { settingsScreenOverrides } from './index.ts';
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

/** A Writable backed by a plain variable: get is stable between sets, as the contract requires. */
function writable<T>(init: T): { get(): T; set(v: T): void; subscribe(l: () => void): () => void; value: () => T } {
  let v = init;
  const ls = new Set<() => void>();
  return {
    get: () => v,
    value: () => v,
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

function Route(): ReactElement {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  vi.restoreAllMocks();
});

interface Harness {
  services: SettingsServices;
  settings: ReturnType<typeof writable<AppSettings>>;
  profile: ReturnType<typeof writable<PlayerProfile | undefined>>;
  src: LocationSource & { navigated: string[] };
  reloaded: number[];
  repos: ReturnType<typeof memoryRepos>;
  kv: MemoryKv;
}

function harness(over: Partial<SettingsServices> = {}, withProfile = true): Harness {
  const kv = new MemoryKv();
  const repos = memoryRepos(kv);
  const settings = writable<AppSettings>(defaultAppSettings());
  const profile = writable<PlayerProfile | undefined>(withProfile ? makeProfile() : undefined);
  const reloaded: number[] = [];
  const navigated: string[] = [];
  const services: SettingsServices = {
    configs: cfg,
    repos,
    kv,
    settings,
    profile,
    about: { appVersion: '1.2.3', corpusVersion: 'c-9', configVersion: 'cfg-9', iosBeta: false },
    localDay: () => '2026-11-18',
    onDataReplaced: () => {
      reloaded.push(1);
    },
    ...over,
  };
  const src = Object.assign(
    { getHash: () => '#/settings', subscribe: () => () => undefined, navigate: (p: string) => navigated.push(p) },
    { navigated },
  );
  return { services, settings, profile, src, reloaded, repos, kv };
}

async function render(h: Harness, hash = '#/settings'): Promise<void> {
  const table = createRouteTable({ settings: createSettingsScreen(h.services) });
  const source: LocationSource = { ...h.src, getHash: () => hash };
  m = mount(
    <ToastProvider suppressed={false}>
      <RouterProvider table={table} dev={false} source={source}>
        <Route />
      </RouterProvider>
    </ToastProvider>,
  );
  await flush();
}

const label = (el: Element | null): string => el?.textContent ?? '';

/** Button's inert state is aria-disabled (it stays focusable), not the disabled property. */
const inert = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') === 'true';

function readBlob(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

/** The button with this text, last in document order (the confirm buttons sit after the page's own). */
function buttonLabelled(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text);
  const last = found[found.length - 1];
  if (!last) throw new Error(`no button "${text}"`);
  return last;
}

describe('SettingsScreen', () => {
  it('renders every section with its anchor and the version facts', async () => {
    const h = harness();
    await render(h);
    for (const id of ['audio', 'display', 'practice', 'accessibility', 'data', 'about']) {
      expect(document.getElementById(`settings-${id}`)).not.toBeNull();
    }
    expect(document.body.textContent).toContain('1.2.3');
    expect(document.body.textContent).toContain('c-9');
    expect(document.body.textContent).toContain(copy('settings.about.privacy'));
    expect(document.body.textContent).not.toContain(copy('app.beta'));
  });

  it('shows the iOS beta line when the platform is iOS', async () => {
    const h = harness({ about: { appVersion: '1', corpusVersion: '1', configVersion: '1', iosBeta: true } });
    await render(h);
    expect(document.body.textContent).toContain(copy('app.beta'));
  });

  it('applies a display change at once and keeps the other settings', async () => {
    const h = harness();
    await render(h);
    const dark = [...document.querySelectorAll('input[type="radio"]')].find(
      (el) => (el as HTMLInputElement).value === 'dark',
    ) as HTMLInputElement;
    click(dark);
    expect(h.settings.value().display.theme).toBe('dark');
    expect(h.settings.value().display.liveFeedback).toBe('full');
  });

  it('toggles a practice preference', async () => {
    const h = harness();
    await render(h);
    const tips = [...document.querySelectorAll('[role="switch"]')].find((el) => label(el.closest('label')).includes(copy('settings.practice.tips')));
    click(tips!);
    expect(h.settings.value().practicePrefs.showTips).toBe(false);
  });

  it('sets the metronome volume from the range input', async () => {
    const h = harness();
    await render(h);
    setNativeValue(q<HTMLInputElement>('#set-metronome-volume'), '40', 'input');
    expect(h.settings.value().audio.metronomeVolume).toBe(40);
  });

  it('saves the display name on blur, and ignores a blank one', async () => {
    const h = harness();
    await render(h);
    const input = q<HTMLInputElement>('#set-name');
    setNativeValue(input, '  Ada  ', 'input');
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    act(() => input.blur());
    expect(h.profile.value()?.displayName).toBe('Ada');
    setNativeValue(input, '   ', 'input');
    act(() => input.blur());
    expect(h.profile.value()?.displayName).toBe('Ada');
  });

  it('disables the name when no profile exists yet', async () => {
    const h = harness({}, false);
    await render(h);
    expect(q<HTMLInputElement>('#set-name').disabled).toBe(true);
  });

  it('shows the latest calibration on the audio row and offers Calibrate', async () => {
    const h = harness();
    await h.repos.calibrations.put({ ...makeCalibration('route-a'), measuredAt: '2026-01-01T00:00:00.000Z', method: 'loopback' });
    await h.repos.calibrations.put({ ...makeCalibration('route-b'), measuredAt: '2026-03-05T00:00:00.000Z', method: 'play-along' });
    await render(h);
    expect(document.body.textContent).toContain(text('settings.audio.calibrated', { date: '5 Mar 2026', method: text('settings.audio.method.play-along') }));
    const calibrate = [...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.calibrate'));
    click(calibrate!);
    expect(h.src.navigated).toContain('/calibrate');
  });

  it('shows the placement action only when the root provides one', async () => {
    const without = harness();
    await render(without);
    expect(document.body.textContent).not.toContain(copy('action.runPlacementAgain'));
    m?.unmount();
    m = null;
    const placed: string[] = [];
    const withIt = harness({ runPlacement: () => placed.push('go') });
    await render(withIt);
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.runPlacementAgain'));
    click(btn!);
    expect(placed).toEqual(['go']);
  });

  it('exports the whole store as a dated backup file', async () => {
    const h = harness();
    await h.repos.profile.put(makeProfile());
    await render(h);
    const created: Blob[] = [];
    const download = vi.fn();
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = download;
      return el;
    });
    click([...document.querySelectorAll('button')].find((b) => b.textContent === copy('settings.data.export'))!);
    await flush();
    expect(download).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    const body = JSON.parse(await readBlob(created[0]!)) as { format: string; profile: { id: string } };
    expect(body.format).toBe('sightread-export');
    expect(body.profile.id).toBe(makeProfile().id);
    expect(backupFileName('2026-11-18')).toBe('sightread-backup-2026-11-18.json');
  });

  it('requires the typed word before deleting everything', async () => {
    const h = harness();
    await h.repos.attempts.add(makeAttempt(0));
    await render(h);
    click([...document.querySelectorAll('button')].find((b) => b.textContent === copy('settings.data.delete'))!);
    await flush();
    const confirm = buttonLabelled(text('settings.data.deleteConfirm'));
    expect(inert(confirm)).toBe(true);
    setNativeValue(q<HTMLInputElement>('#set-delete-confirm'), 'delete', 'input');
    await flush();
    expect(inert(confirm)).toBe(false);
    click(confirm);
    await flush();
    expect(await h.repos.attempts.all()).toHaveLength(0);
    expect(await h.repos.profile.get()).toBeUndefined();
    expect(h.reloaded).toHaveLength(1);
  });

  it('keeps the data when the typed word is wrong', async () => {
    const h = harness();
    await h.repos.profile.put(makeProfile());
    await render(h);
    click([...document.querySelectorAll('button')].find((b) => b.textContent === copy('settings.data.delete'))!);
    await flush();
    setNativeValue(q<HTMLInputElement>('#set-delete-confirm'), 'Delete', 'input');
    await flush();
    const confirm = buttonLabelled(text('settings.data.deleteConfirm'));
    expect(inert(confirm)).toBe(true);
    click(confirm);
    await flush();
    expect(await h.repos.profile.get()).toBeDefined();
  });

  it('refuses a file that is not a backup and changes nothing', async () => {
    const h = harness();
    await h.repos.profile.put(makeProfile());
    await render(h);
    const input = q<HTMLInputElement>('[data-testid="import-file"]');
    const file = { text: async () => '{"hello":1}' } as unknown as File;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    // The file opened the import confirmation; confirming it runs the import, which must refuse.
    click(buttonLabelled(copy('action.importBackup')));
    await flush();
    expect(document.body.textContent).toContain(copy('error.importInvalid'));
    expect(h.reloaded).toHaveLength(0);
    expect(await h.repos.profile.get()).toBeDefined();
  });
});

describe('settings helpers', () => {
  it('splits a byte count into KB or MB', () => {
    expect(sizeParts(20_000)).toEqual({ unit: 'kb', n: 20 });
    expect(sizeParts(2_500_000)).toEqual({ unit: 'mb', n: 2.5 });
  });

  it('trims and caps a display name, and rejects an empty one', () => {
    expect(normalizeDisplayName('  Ada  ')).toBe('Ada');
    expect(normalizeDisplayName('   ')).toBeNull();
    expect(normalizeDisplayName('x'.repeat(60))).toHaveLength(40);
  });

  it('patches one section without touching the others', () => {
    const base = defaultAppSettings();
    const next = patchSection(base, 'display', { theme: 'dark' });
    expect(next.display).toEqual({ ...base.display, theme: 'dark' });
    expect(next.practice).toEqual(base.practice);
  });
});

describe('settingsScreenOverrides', () => {
  it('replaces both settings placeholders (the list and a section)', () => {
    const table = createRouteTable(settingsScreenOverrides(harness().services));
    const screens = table.filter((r) => r.id === 'settings').map((r) => r.Screen);
    expect(screens).toHaveLength(2);
    expect(screens.every((S) => S !== PlaceholderScreen)).toBe(true);
  });
});
