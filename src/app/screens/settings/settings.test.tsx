// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfigs } from '../../../rules/index.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { makeAttempt, makeProfile, MemoryKv, memoryRepos } from '../../../store/test-data.ts';
import type { AppSettings, Configs, PlayerProfile } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { act, click, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { ToastProvider } from '../../../ui/primitives/index.ts';
import { setNativeValue, q } from '../../../ui/components/form/test-helpers.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import { createStore } from 'zustand/vanilla';
import { idleSoundView, type SoundView } from '../../../session/index.ts';
import { createSettingsScreen, type SettingsServices } from './index.ts';
import { text } from './text.ts';
import { sizeParts, normalizeDisplayName, patchSection } from './model.ts';
import { backupFileName } from './data-io.ts';
import { settingsScreenOverrides } from './index.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import type { CalStatus } from '../../compose/calibration-status.ts';
import { calTexts } from '../../../ui/components/calibration-status/index.ts';
import type { DiagnosticsExport } from '../states/services.ts';
import type { DiagnosticsServices } from '../states/services.ts';

const CAL_OK: CalStatus = { state: 'ok', output: 'speakers', oldOutput: null, when: 'today', ms: 80, reason: null };
const NOT_CAL: CalStatus = { state: 'none', output: null, oldOutput: null, when: null, ms: null, reason: null };

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
    calibrationStatus: writable<CalStatus>(NOT_CAL),
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

  it('shows the shared calibration status on the sound card and offers Recalibrate when it is OK', async () => {
    const h = harness({ calibrationStatus: writable<CalStatus>(CAL_OK) });
    await render(h);
    expect(q('[data-testid="cal-status"]').getAttribute('data-state')).toBe('ok');
    const recalibrate = [...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.recalibrate'));
    click(recalibrate!);
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

describe('Settings > Sound', () => {
  const radios = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('input[name="set-sound"]')];
  const playButton = (sound: string): HTMLButtonElement => q<HTMLButtonElement>(`button[data-sound="${sound}"]`);

  it('offers Classic, Woodblock and Beep, each with its hint, and Classic is the default', async () => {
    const h = harness();
    await render(h);
    expect(radios().map((r) => r.value)).toEqual(['classic', 'woodblock', 'beep']);
    for (const [id, name] of [['classic', 'Classic'], ['woodblock', 'Woodblock'], ['beep', 'Beep']] as const) {
      expect(document.body.textContent).toContain(name);
      expect(document.body.textContent).toContain(copy(`settings.audio.click.${id}.hint`));
      expect(playButton(id).getAttribute('aria-label')).toBe(copy('settings.audio.click.play', { sound: name }));
    }
    expect(radios().find((r) => r.checked)?.value).toBe('classic');
    expect(document.body.textContent).toContain(copy('settings.audio.click.keepsCalibration'));
  });

  it('shows Classic selected for a stored tick, and Woodblock for a stored wood', async () => {
    const h = harness();
    h.settings.set(patchSection(h.settings.value(), 'practice', { clickTimbre: 'tick' }));
    await render(h);
    expect(radios().find((r) => r.checked)?.value).toBe('classic');
    m?.unmount();
    m = null;
    const w = harness();
    w.settings.set(patchSection(w.settings.value(), 'practice', { clickTimbre: 'wood' }));
    await render(w);
    expect(radios().find((r) => r.checked)?.value).toBe('woodblock');
  });

  it('stores the chosen sound and keeps the other settings', async () => {
    const h = harness();
    await render(h);
    for (const id of ['woodblock', 'beep', 'classic'] as const) {
      click(radios().find((r) => r.value === id)!);
      expect(h.settings.value().practice.clickTimbre).toBe(id);
    }
    expect(h.settings.value().practice.a4Hz).toBe(defaultAppSettings().practice.a4Hz);
  });

  it('previews each sound from its own button, one at a time, and shows Stop while it plays', async () => {
    const sounds = createStore<SoundView>(idleSoundView);
    const previews: string[] = [];
    let stops = 0;
    const h = harness({
      sounds,
      previewSound: async (sound) => {
        previews.push(sound);
        sounds.setState({ ...idleSoundView(), playing: 'preview', caption: { kind: 'preview', sound } });
      },
      stopSounds: () => {
        stops += 1;
        sounds.setState(idleSoundView());
      },
    });
    await render(h);
    for (const id of ['classic', 'woodblock', 'beep'] as const) {
      click(playButton(id));
      await flush();
      expect(previews.at(-1)).toBe(id);
      expect(playButton(id).textContent).toContain(copy('action.stop'));
      expect(playButton(id).getAttribute('aria-label')).toBe(copy('action.stop'));
      expect(document.body.textContent).toContain(copy('settings.audio.click.playing', { sound: copy(`settings.audio.click.${id}`) }));
      // The others still offer their preview.
      for (const other of ['classic', 'woodblock', 'beep'].filter((x) => x !== id)) {
        expect(playButton(other).textContent).not.toContain(copy('action.stop'));
      }
      click(playButton(id));
      await flush();
      expect(playButton(id).textContent).not.toContain(copy('action.stop'));
    }
    expect(previews).toEqual(['classic', 'woodblock', 'beep']);
    expect(stops).toBe(3);
    // A preview does not change the chosen sound.
    expect(h.settings.value().practice.clickTimbre).toBe(defaultAppSettings().practice.clickTimbre);
  });

  it('stops a preview that is sounding when the screen is left', async () => {
    let stops = 0;
    const h = harness({ stopSounds: () => void (stops += 1) });
    await render(h);
    m?.unmount();
    m = null;
    expect(stops).toBeGreaterThan(0);
  });

  it('switches the accent for the first beat, on by default', async () => {
    const h = harness();
    await render(h);
    const accent = [...document.querySelectorAll<HTMLInputElement>('[role="switch"]')].find((el) => label(el.closest('label')).includes(copy('settings.audio.accent')))!;
    expect(accent.checked).toBe(true);
    click(accent);
    expect(h.settings.value().practice.accentFirstBeat).toBe(false);
    click(accent);
    expect(h.settings.value().practice.accentFirstBeat).toBe(true);
  });

  it('plays one click of the chosen sound when the volume slider is released, not while it moves', async () => {
    const clicks: string[] = [];
    const h = harness({ playClick: async (sound) => void clicks.push(sound) });
    h.settings.set(patchSection(h.settings.value(), 'practice', { clickTimbre: 'beep' }));
    await render(h);
    const range = q<HTMLInputElement>('#set-metronome-volume');
    setNativeValue(range, '55', 'input');
    setNativeValue(range, '60', 'input');
    expect(clicks).toEqual([]);
    expect(h.settings.value().audio.metronomeVolume).toBe(60);
    act(() => range.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(clicks).toEqual(['beep']);
    act(() => range.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })));
    expect(clicks).toEqual(['beep', 'beep']);
    expect(document.body.textContent).toContain('60%');
  });

  it('offers Calibrate before any calibration, and the tuning pitch with its hint', async () => {
    const h = harness();
    await render(h);
    expect(document.body.textContent).toContain(copy('settings.audio.a4.hint'));
    expect(q('[data-testid="cal-status"]').getAttribute('data-state')).toBe('none');
    click([...document.querySelectorAll('button')].find((b) => b.textContent === calTexts(NOT_CAL).action)!);
    expect(h.src.navigated).toContain('/calibrate');
  });

  it('shows the changed-output status with the caution tone, and no Recalibrate button until it is OK', async () => {
    const h = harness({ calibrationStatus: writable<CalStatus>({ ...CAL_OK, state: 'changed', output: 'bluetooth', oldOutput: 'speakers' }) });
    await render(h);
    expect(q('[data-testid="cal-status"]').getAttribute('data-state')).toBe('changed');
    // The only button with that label is the pill's own link, not the separate Recalibrate action (shown when OK).
    const matches = [...document.querySelectorAll('button')].filter((b) => b.textContent === copy('action.recalibrate'));
    expect(matches.every((b) => b.classList.contains('cs-link'))).toBe(true);
  });

  it('leaves the calibration row out when the root does not provide the shared status', async () => {
    const h = harness();
    delete (h.services as { calibrationStatus?: unknown }).calibrationStatus;
    await render(h);
    expect(document.querySelector('[data-testid="cal-status"]')).toBeNull();
    expect(document.body.textContent).toContain(copy('settings.section.audio'));
  });

  it('keeps the Technical details disclosure closed, holding the build facts', async () => {
    const h = harness();
    await render(h);
    const details = q<HTMLDetailsElement>('details.set-details');
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(copy('settings.about.technical'));
    expect(details.textContent).toContain('1.2.3');
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

describe('Settings round 2 additions', () => {
  const voiceId = Object.values(cfg.instrumentById).find((i) => i.family === 'voice')!.id;
  const flatId = Object.values(cfg.instrumentById).find((i) => i.family !== 'voice')!.id;
  const switchFor = (name: string): HTMLInputElement | undefined =>
    [...document.querySelectorAll<HTMLInputElement>('[role="switch"]')].find((el) => label(el.closest('label')).includes(name));

  function withInstrument(h: Harness, instrumentId: string): void {
    const base = defaultAppSettings();
    h.settings.set({ ...base, practice: { ...base.practice, instrumentId } });
  }

  function diagnosticsFake(over: Partial<DiagnosticsServices> = {}): DiagnosticsServices {
    return {
      supportAddress: null,
      soundOptInShown: true,
      exportTry: vi.fn(async () => null),
      exportLast: vi.fn(async () => null),
      exportRecent: vi.fn(async (): Promise<DiagnosticsExport | null> => ({
        fileName: 'sightread-tries-2026-11-18-1440.json',
        text: '{"tries":[]}',
        file: { tries: [] } as never,
      })),
      settings: vi.fn(async () => ({ includeAudio: false }) as never),
      setSettings: vi.fn(async () => undefined),
      download: vi.fn(),
      ...over,
    } as DiagnosticsServices;
  }

  it('shows the starting-pitch switch only for a voice, and stores the choice', async () => {
    const h = harness();
    withInstrument(h, flatId);
    await render(h);
    expect(switchFor(copy('settings.practice.autoReference'))).toBeUndefined();
    m?.unmount();
    m = null;

    const v = harness();
    withInstrument(v, voiceId);
    await render(v);
    const sw = switchFor(copy('settings.practice.autoReference'));
    expect(sw?.checked).toBe(true);
    click(sw!);
    expect(v.settings.value().practice.autoReference).toBe(false);
  });

  it('Practice has the beat line switch for every instrument, on by default, and stores it', async () => {
    const h = harness();
    await render(h);
    const sw = switchFor(copy('settings.practice.beatLine'));
    expect(sw?.checked).toBe(true);
    expect(sw!.closest('#practice, [id="practice"], section')).not.toBeNull();
    click(sw!);
    expect(h.settings.value().display.beatLine).toBe(false);
    click(switchFor(copy('settings.practice.beatLine'))!);
    expect(h.settings.value().display.beatLine).toBe(true);
  });

  it('Display has the note colours switch, off by default, with a colour key, and stores it (PLAN R69)', async () => {
    const h = harness();
    await render(h);
    const sw = switchFor(copy('settings.display.noteColours'));
    expect(sw?.checked).toBe(false);
    expect(sw!.closest('section')?.getAttribute('data-section')).toBe('display');
    const key = q<HTMLElement>('[data-testid="note-colour-key"]');
    expect(key.getAttribute('role')).toBe('img');
    expect(key.getAttribute('aria-label')).toBe(copy('settings.display.noteColours.key'));
    expect(key.textContent).toBe('CDEFGAB');
    expect([...key.querySelectorAll('svg')].map((e) => e.getAttribute('data-letter'))).toEqual(['c', 'd', 'e', 'f', 'g', 'a', 'b']);
    click(sw!);
    expect(h.settings.value().display.noteColours).toBe(true);
    expect(switchFor(copy('settings.display.noteColours'))?.checked).toBe(true);
    click(switchFor(copy('settings.display.noteColours'))!);
    expect(h.settings.value().display.noteColours).toBe(false);
  });

  it('chooses how played notes show live and stores it', async () => {
    const h = harness();
    await render(h);
    expect(q<HTMLInputElement>('input[type="radio"][value="from4"]').checked).toBe(true);
    click(q<HTMLInputElement>('input[type="radio"][value="always"]'));
    expect(h.settings.value().display.ghostsLive).toBe('always');
  });

  it('toggles what the app hears, off by default, and stores it', async () => {
    const h = harness();
    await render(h);
    const sw = switchFor(copy('settings.display.showHeard'));
    expect(sw?.checked).toBe(false);
    click(sw!);
    expect(h.settings.value().display.showHeard).toBe(true);
  });

  it('shows no diagnostics card when the root does not provide the services', async () => {
    const h = harness();
    await render(h);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === copy('action.exportDiagnostics'))).toBe(false);
  });

  it('exports every stored trace in the one file the service names', async () => {
    const diagnostics = diagnosticsFake();
    const h = harness({ diagnostics });
    await render(h);
    click([...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.exportDiagnostics'))!);
    await flush();
    expect(diagnostics.exportRecent).toHaveBeenCalledOnce();
    expect(diagnostics.download).toHaveBeenCalledWith('sightread-tries-2026-11-18-1440.json', '{"tries":[]}');
  });

  it('saves nothing when no try is stored yet', async () => {
    const diagnostics = diagnosticsFake({ exportRecent: vi.fn(async () => null) });
    const h = harness({ diagnostics });
    await render(h);
    click([...document.querySelectorAll('button')].find((b) => b.textContent === copy('action.exportDiagnostics'))!);
    await flush();
    expect(diagnostics.download).not.toHaveBeenCalled();
  });

  it('shows the microphone-audio opt-in when the build shows it, reads it and stores a change', async () => {
    const diagnostics = diagnosticsFake({ settings: vi.fn(async () => ({ includeAudio: true }) as never) });
    const h = harness({ diagnostics });
    await render(h);
    const sw = switchFor(copy('diagnostics.keepSound'));
    expect(sw?.checked).toBe(true);
    click(sw!);
    await flush();
    expect(diagnostics.setSettings).toHaveBeenCalledWith({ includeAudio: false });
  });

  it('hides the microphone-audio opt-in when the build does not show it', async () => {
    const h = harness({ diagnostics: diagnosticsFake({ soundOptInShown: false }) });
    await render(h);
    expect(document.body.textContent).not.toContain(copy('diagnostics.keepSound'));
    expect(document.body.textContent).toContain(copy('settings.data.exportDiagnostics'));
  });
});
