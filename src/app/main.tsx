/**
 * The composition root (01 §4.2): the only app module that reaches browser globals and platform/web. It reads the
 * capabilities, opens the store (storage-loss check, export version, debug pruning, persist request after the first
 * completed take), builds the web audio backend with the capture worklet and the DSP worker, loads the corpus
 * manifest (public/corpus/v1, or fixtures/corpus on the dev server when no corpus was built), wires the iOS
 * controllers, and hands everything to `composeApp`, which binds every screen route.
 *
 * `?testClock=1` (01 §13.4; in the query or the hash query): `t0` is the first captured frame plus 2.0 s
 * (`&testClockSec=` overrides it), the RTL is 0, and each take reopens the microphone right before capture starts,
 * so Chromium's fake capture file plays from its start at the capture origin. `window.__sr` then exposes the session
 * for the Playwright loop spec (e2e/loop/).
 */
import { StrictMode, useSyncExternalStore } from 'react';
import type { Root } from 'react-dom/client';
import type { MessagePortLike, PlatformServices, WorkerLike, WorkerMessage } from '../core/platform.ts';
import type { AppSettings, CorpusManifest } from '../core/types.ts';
import { createRng } from '../core/rng.ts';
import { loadManifest } from '../corpus/index.ts';
import { WebAudioBackend } from '../platform/web/audio/index.ts';
import { CAPTURE_WORKLET_URL } from '../platform/web/audio/worklet-url.ts';
import { createDspWorker } from '../platform/web/audio/dsp-worker-factory.ts';
import { readBrowserCapabilities } from '../platform/web/capabilities.ts';
import { registerServiceWorker } from '../platform/web/sw/register.ts';
import { iosBetaLabelKey } from '../platform/web/ios/hints.ts';
import { InterruptionController } from '../platform/web/ios/interruption-wiring.ts';
import { KeepAwakeController, createPersistTrigger, wakeLockFromNavigator } from '../platform/web/ios/keep-awake.ts';
import { LocalStorageMirror, openStore } from '../platform/web/store/index.ts';
import { defaultAppSettings } from '../store/defaults.ts';
import { acknowledgeStorageLoss, checkStorage } from '../store/storage-loss.ts';
import { App } from './App.tsx';
import { appearanceFromSettings } from './appearance.tsx';
import { composeApp, type AppRuntime } from './compose/app-services.ts';
import { appConfigs } from './compose/configs.ts';
import { createValue } from './compose/values.ts';
import { testClockRequested } from './dev/slice-url.ts';
import type { RouteDef } from './routes.tsx';
import { pickMicBrowser } from './screens/states/index.ts';
import { hashFromPath, pathFromHash } from './route-match.ts';
import type { Readable } from './screens/home/services.ts';

const APP_VERSION = '0.1.0';
const CORPUS_ROOT = 'corpus/v1/';
const FIXTURE_CORPUS_ROOT = 'fixtures/corpus/';

const pad = (n: number): string => String(n).padStart(2, '0');
const localDayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function hashQuery(name: string): string | null {
  const q = (s: string): string => (s.includes('?') ? s.slice(s.indexOf('?') + 1) : '');
  return new URLSearchParams(q(window.location.search)).get(name) ?? new URLSearchParams(q(window.location.hash)).get(name);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

/** Corpus assets: public/corpus/v1/ as built by the corpus pipeline; on the dev server, fixtures/corpus/ when absent. */
async function corpusAssets(): Promise<{ assets: PlatformServices['assets']; manifest: CorpusManifest }> {
  const direct: PlatformServices['assets'] = { getJson: (p) => fetchJson(p) };
  try {
    return { assets: direct, manifest: await loadManifest(direct) };
  } catch (e) {
    if (!import.meta.env.DEV) throw e;
    const fixtures: PlatformServices['assets'] = { getJson: (p) => fetchJson(p.startsWith(CORPUS_ROOT) ? FIXTURE_CORPUS_ROOT + p.slice(CORPUS_ROOT.length) : p) };
    return { assets: fixtures, manifest: await loadManifest(fixtures) };
  }
}

/** The capture origin is the first frame after a fresh stream: Chromium's fake device restarts its file per stream. */
class TestClockBackend extends WebAudioBackend {
  override async startCapture(sink: MessagePortLike | ((m: WorkerMessage) => void)): Promise<void> {
    await this.reopenInput();
    return super.startCapture(sink);
  }
}

function Root({ table, settings, resultOpen }: { table: readonly RouteDef[]; settings: Readable<AppSettings>; resultOpen: () => boolean }) {
  const s = useSyncExternalStore(settings.subscribe, settings.get, settings.get);
  return <App table={table} appearance={appearanceFromSettings(s)} dev={import.meta.env.DEV} resultOpen={resultOpen} />;
}

function bootError(root: Root, e: unknown): void {
  console.error(e);
  root.render(
    <main className="boot-error" data-testid="boot-error" role="alert">
      <p>{e instanceof Error ? e.message : String(e)}</p>
    </main>,
  );
}

export async function boot(root: Root): Promise<void> {
  try {
    const testClock = testClockRequested(window.location.search, window.location.hash);
    const configs = appConfigs();
    const store = await openStore();
    const { repos, kv } = store;
    const mirror = new LocalStorageMirror();
    const idGen = (): string => crypto.randomUUID();
    const clockWall = (): string => new Date().toISOString();
    const lossDeps = { kv, repos, mirror, idGen, clockWall };
    const [storage, savedSettings, profile, corpus] = await Promise.all([
      checkStorage(lossDeps),
      repos.settings.get().catch(() => defaultAppSettings()),
      repos.profile.get(),
      corpusAssets(),
    ]);

    const persistedNow = typeof navigator.storage?.persisted === 'function' ? await navigator.storage.persisted().catch(() => false) : false;
    const capabilities = readBrowserCapabilities(persistedNow);
    const t0After = Number(hashQuery('testClockSec') ?? 2);
    const backendOpts = {
      capabilities,
      workletUrl: CAPTURE_WORKLET_URL,
      outputMode: savedSettings.practice.outputMode,
      ...(testClock ? { testClockT0AfterCaptureSec: Number.isFinite(t0After) ? t0After : 2 } : {}),
    };
    const audio = testClock ? new TestClockBackend(backendOpts) : new WebAudioBackend(backendOpts);

    const timers = {
      setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
      clearTimeout: (h: unknown): void => clearTimeout(h as number),
      setInterval: (fn: () => void, ms: number): unknown => setInterval(fn, ms),
      clearInterval: (h: unknown): void => clearInterval(h as number),
    };
    const wakeLockFailed = createValue(false);
    const keepAwake = new KeepAwakeController({ wakeLock: wakeLockFromNavigator(navigator as unknown as Parameters<typeof wakeLockFromNavigator>[0]), timers });
    const persist = createPersistTrigger(kv, navigator.storage);
    const platform: PlatformServices & { audio: WebAudioBackend } = {
      audio,
      repos,
      kv,
      async keepAwake(on) {
        if (!on) return keepAwake.keepAwake(false);
        const ok = await keepAwake.startPractice();
        // The hint's copy names iOS's Auto-Lock setting (05 W11): only iPhone and iPad get it.
        if (!ok && (capabilities.osFamily === 'ios' || capabilities.osFamily === 'ipados')) wakeLockFailed.set(true);
      },
      clockWall,
      localDay: () => localDayOf(new Date()),
      idGen,
      assets: corpus.assets,
      lifecycle: {
        onVisibility(cb) {
          const on = (): void => cb(document.visibilityState === 'visible');
          document.addEventListener('visibilitychange', on);
          return () => document.removeEventListener('visibilitychange', on);
        },
      },
    };
    document.addEventListener('visibilitychange', () => keepAwake.onVisibility(document.visibilityState === 'visible'));
    const interruption = new InterruptionController({
      audio,
      timers,
      firstNotePlayed: () => composed.session.view.getState().firstNoteHeard,
      // The session voids the take itself (backend interruptions and page visibility); the controller adds the
      // close-on-hide and idle policies (05 W2).
      // A close between takes drops the session's route, so the next take reopens audio from its gesture rather than
      // scheduling on a closed context.
      sink: { onVoid: () => undefined, onStaleCalibration: () => undefined, onAudioClosed: () => composed.session.audioClosed() },
    });
    interruption.start();

    const idle = (run: () => void): void => {
      const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === 'function') ric(run, { timeout: 2000 });
      else setTimeout(run, 200);
    };

    const runtime: AppRuntime = {
      platform,
      capabilities,
      configs,
      manifest: corpus.manifest,
      workerFactory: (): WorkerLike => createDspWorker(),
      settings: { ...defaultAppSettings(), ...savedSettings },
      profile,
      storageLost: storage.status === 'lost',
      async acknowledgeStorageLoss() {
        await acknowledgeStorageLoss(lossDeps);
      },
      attemptCompleted() {
        void persist.attemptCompleted().catch(() => null);
      },
      pruneDebug() {
        idle(() => void repos.pruneDebug(clockWall()).catch(() => 0));
      },
      localDayOf: (iso) => localDayOf(new Date(iso)),
      rng: createRng(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1),
      timers,
      idle,
      micBrowser: pickMicBrowser(capabilities, /firefox/i.test(navigator.userAgent) ? 'firefox' : undefined),
      async inputDevices() {
        const md = navigator.mediaDevices;
        if (!md?.enumerateDevices) return [];
        const all = await md.enumerateDevices();
        return all.filter((d) => d.kind === 'audioinput' && d.deviceId).map((d) => ({ id: d.deviceId, label: d.label || d.deviceId }));
      },
      async storageUsed() {
        const est = await navigator.storage?.estimate?.();
        return est?.usage ?? null;
      },
      download(name, text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      keepAwake,
      wakeLockFailed,
      onSessionState: (s) => interruption.setSession(s),
      versions: { app: APP_VERSION, build: import.meta.env.MODE, core: APP_VERSION },
      iosBeta: iosBetaLabelKey(capabilities.osFamily) !== null,
      testClock,
      dev: import.meta.env.DEV,
    };
    const composed = composeApp(runtime);

    // Leaving the practice flow releases the wake lock and, between takes, closes the microphone (05 W2, W11).
    let lastPath = pathFromHash(window.location.hash);
    window.addEventListener('hashchange', () => {
      const path = pathFromHash(window.location.hash);
      const wasPractice = lastPath.startsWith('/practice/');
      lastPath = path;
      keepAwake.touch();
      if (wasPractice && !path.startsWith('/practice/') && !['count-in', 'performing', 'finishing'].includes(composed.session.state)) {
        keepAwake.leavePractice();
        interruption.leavePractice();
      }
    });
    document.addEventListener('pointerdown', () => {
      keepAwake.touch();
      interruption.touch();
    });

    const start = composed.initialPath(pathFromHash(window.location.hash));
    if (start !== null) window.history.replaceState(window.history.state, '', hashFromPath(start));

    if (testClock) (window as unknown as { __sr: unknown }).__sr = { session: composed.session, configs };

    // Offline shell and corpus cache (P19). Production builds only: dev has no worker. A new build waits and takes
    // over on the next launch (all tabs closed); there is no in-app update prompt in v1, so a take is never reloaded.
    if (import.meta.env.PROD) {
      void registerServiceWorker({
        container: navigator.serviceWorker as unknown as Parameters<typeof registerServiceWorker>[0]['container'],
        capabilities,
        reload: () => window.location.reload(),
        onUpdateReady: () => undefined,
      });
    }

    // `#/practice/tips` goes back to the open result, else to Practice (decision 13).
    const resultOpen = (): boolean => composed.session.view.getState().record !== null;
    root.render(
      <StrictMode>
        <Root table={composed.table} settings={composed.settings} resultOpen={resultOpen} />
      </StrictMode>,
    );
  } catch (e) {
    bootError(root, e);
  }
}
