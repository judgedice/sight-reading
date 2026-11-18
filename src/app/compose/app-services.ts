/**
 * The composition root's wiring (01 §4.2): one `PracticeSession`, the settings and profile values, and every screen's
 * services, bound into the route table. Browser globals stay in src/app/main.tsx, which builds the `AppRuntime` this
 * module takes; here only modules are wired.
 */
import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import type { AudioBackend, KeyValue, PlatformCapabilities, PlatformServices, WorkerLike, MessagePortLike } from '../../core/platform.ts';
import type { AppSettings, AttemptRecord, AttributionsFile, Calibration, Configs, CorpusManifest, PlayerProfile, PracticeSettings, Rng } from '../../core/types.ts';
import { PracticeSession, type PracticeSessionOptions } from '../../session/index.ts';
import { countEligible, prefetchNeighbours } from '../../corpus/index.ts';
import { createProfile, postRevealSkipAllowed, respondToLevelOffer, setInstrumentLevel, startPlacement } from '../../grade/index.ts';
import { ghostPitch } from '../../follow/index.ts';
import { bindNotation, type FrameNotation } from '../../ui/score-frame/index.ts';
import { createRouteTable, type RouteDef, type ScreenOverrides } from '../routes.tsx';
import type { ScreenComponent, ScreenProps } from '../route-types.ts';
import { creditsScreenOverrides } from '../screens/about/index.ts';
import { CalibrationScreen, CalibrationServicesProvider, type CalibrationServices } from '../screens/calibration/index.ts';
import { historyScreenOverrides } from '../screens/history/index.ts';
import { homeScreenOverrides, type HomeBanner, type HomeServices, type Readable, type TodayStats } from '../screens/home/index.ts';
import { OnboardingScreen, OnboardingServicesProvider, type MicOutcome, type OnboardingResult, type OnboardingServices } from '../screens/onboarding/index.ts';
import { progressScreenOverrides } from '../screens/progress/index.ts';
import { createReviewRenderer } from '../screens/results/review/index.ts';
import { resultsScreenOverrides, type ResultsServices } from '../screens/results/index.ts';
import { practiceFlowScreenOverrides, type PracticeFlowServices } from '../screens/scan/index.ts';
import type { SettingsServices } from '../screens/settings/context.ts';
import { tipsScreenOverrides, type TipsServices } from '../screens/sheets/index.ts';
import { classifyMicError, type MicBrowser } from '../screens/states/index.ts';
import { createCalibrationServices, type CalibrationBackendExtras } from './calibration-services.ts';
import { createValue, derived, jsonEqual, type Value } from './values.ts';

/** Backend members beyond the frozen seam (WebAudioBackend has them). */
export type AppBackend = AudioBackend &
  CalibrationBackendExtras & {
    setInputEnabled?(on: boolean): void;
    close?(): Promise<void>;
  };

/** What src/app/main.tsx hands the wiring: the browser side, already built. */
export interface AppRuntime {
  platform: PlatformServices & { audio: AppBackend };
  capabilities: PlatformCapabilities;
  configs: Configs;
  manifest: CorpusManifest;
  workerFactory: () => WorkerLike;
  createCaptureChannel?: () => { port1: MessagePortLike; port2: unknown };
  settings: AppSettings;
  profile: PlayerProfile | undefined;
  storageLost: boolean;
  /** Writes a fresh install marker after an import, a delete or a dismissed storage-loss card. */
  acknowledgeStorageLoss(): Promise<void>;
  /** `requestPersistOnce` after the first completed attempt (05 W12). */
  attemptCompleted(): void;
  /** Debug field pruning, called now and then (01 §6.5). */
  pruneDebug(): void;
  /** Local day of an ISO time (the device's time zone). */
  localDayOf(iso: string): string;
  rng: Rng;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void };
  idle(run: () => void): void;
  micBrowser: MicBrowser;
  inputDevices(): Promise<{ id: string; label: string }[]>;
  storageUsed?(): Promise<number | null>;
  download(name: string, text: string): void;
  keepAwake: { enterResults(): void; leaveResults(): void; leavePractice(): void; touch(): void };
  wakeLockFailed?: Readable<boolean>;
  /** Called on every session state (interruption policy, keep-awake idle). */
  onSessionState?(state: PracticeSession['state']): void;
  versions: { app: string; build: string; core: string };
  iosBeta: boolean;
  /** `?testClock=1` (01 §13.4): RTL 0, calibration skipped. */
  testClock: boolean;
  dev: boolean;
  rightsContact?: string;
}

export interface ComposedApp {
  table: readonly RouteDef[];
  settings: Readable<AppSettings>;
  session: PracticeSession;
  /** The path to open at start-up: onboarding on a first run. */
  initialPath(currentPath: string): string | null;
  /** The screens' services, as bound into the table (tests and the dev tools read them). */
  services: { home: HomeServices; onboarding: OnboardingServices; flow: PracticeFlowServices; results: ResultsServices; tips: TipsServices; calibration: CalibrationServices; settings: SettingsServices };
  dispose(): void;
}

const PRACTICE_PATHS = /^\/practice\//;

export function composeApp(rt: AppRuntime): ComposedApp {
  const { platform, configs: cfg, manifest } = rt;
  const repos = platform.repos;
  const kv: KeyValue = platform.kv;

  // ---- values ------------------------------------------------------------------------------------
  const settings: Value<AppSettings> = createValue(rt.settings, (next) => {
    void repos.settings.put(next).catch(() => undefined);
  });
  const profile: Value<PlayerProfile | undefined> = createValue(rt.profile);
  const dismissed = createValue<readonly HomeBanner['kind'][]>([]);
  const storageLost = createValue(rt.storageLost);
  const hasCalibration = createValue(false);
  const today = createValue<TodayStats>({ takes: 0, ranked: 0, xp: 0 });
  const sessionAttempts: AttemptRecord[] = [];

  const sessionOptions: PracticeSessionOptions = {
    appVersion: rt.versions.app,
    coreVersion: rt.versions.core,
    appBuild: rt.versions.build,
    rng: rt.rng,
    timers: rt.timers,
    dev: rt.dev,
    ...(rt.createCaptureChannel ? { createCaptureChannel: rt.createCaptureChannel } : {}),
    ...(rt.testClock ? { rtlOverrideMs: 0 } : {}),
  };
  const session = new PracticeSession({ platform, configs: cfg, manifest, workerFactory: rt.workerFactory }, sessionOptions);

  const refreshToday = async (): Promise<void> => {
    const day = platform.localDay();
    const recent = await repos.attempts.recent(200);
    const todays = recent.filter((a) => rt.localDayOf(a.createdAt) === day);
    today.set({
      takes: todays.length,
      ranked: todays.filter((a) => a.score?.ranked === true).length,
      xp: todays.reduce((n, a) => n + (a.score?.xp.total ?? 0), 0),
    });
  };
  const refreshCalibrations = async (): Promise<void> => {
    hasCalibration.set((await repos.calibrations.all()).some((c) => c.method !== 'reported'));
  };
  void refreshToday().catch(() => undefined);
  void refreshCalibrations().catch(() => undefined);

  const saveProfile = async (p: PlayerProfile): Promise<void> => {
    await repos.profile.put(p);
    profile.replace(p);
    session.invalidateProfile();
  };
  const changeProfile = (f: (p: PlayerProfile) => PlayerProfile): void => {
    const p = session.currentProfile ?? profile.get();
    if (!p) return;
    void saveProfile(f(p)).catch(() => undefined);
  };
  const setPracticeLevel = (instrumentId: string, level: number): void => {
    const s = settings.get();
    if (s.practice.instrumentId === instrumentId && s.practice.level !== 'random') settings.set({ ...s, practice: { ...s.practice, level } });
  };

  // Keep the profile, today and the attempt list current after every take (04 section 5.7).
  let sawCompleted = false;
  const unsubs: (() => void)[] = [];
  unsubs.push(
    session.events.on((e) => {
      if (e.type === 'record') {
        sessionAttempts.push(e.record);
        const p = session.currentProfile;
        if (p) profile.replace(p);
        void refreshToday().catch(() => undefined);
        if (e.record.endReason === 'complete' && !sawCompleted) {
          sawCompleted = true;
          rt.attemptCompleted();
        }
      } else if (e.type === 'progress') {
        const p = session.currentProfile;
        if (p) profile.replace(p);
        for (const ev of e.events) if (ev.type === 'level-up-auto' || ev.type === 'placement-step' || ev.type === 'placement-done') setPracticeLevel(ev.instrumentId, 'to' in ev ? ev.to : 'nextLevel' in ev ? ev.nextLevel : ev.level);
      } else if (e.type === 'state') {
        rt.onSessionState?.(e.state);
        if (e.state === 'results') rt.keepAwake.enterResults();
        else if (e.prev === 'results') rt.keepAwake.leaveResults();
      }
    }),
  );

  // ---- shared helpers ------------------------------------------------------------------------------
  const loadNotation = (): Promise<FrameNotation> => import('../../notation/index.ts').then((m) => bindNotation(m));
  let attributions: Promise<AttributionsFile> | null = null;
  const loadAttributions = (): Promise<AttributionsFile> => {
    attributions ??= platform.assets.getJson<AttributionsFile>(`corpus/v1/${manifest.attributions.file}`);
    attributions.catch(() => {
      attributions = null;
    });
    return attributions;
  };
  /** Prepare the next excerpt for the current settings; the scan screen follows the session's state. */
  const prepareNext = (s: PracticeSettings = settings.get().practice): void => {
    session.prepare(s).catch(() => undefined);
    const level = typeof s.level === 'number' ? s.level : null;
    if (level !== null) rt.idle(() => void prefetchNeighbours(manifest, level, platform.assets, rt.idle));
  };
  const reducedMotion = (): boolean => {
    const m = settings.get().accessibility.reduceMotion;
    return m === 'on' ? true : m === 'off' ? false : document.documentElement.getAttribute('data-motion') === 'reduced';
  };
  const highContrast = (): boolean => settings.get().accessibility.highContrast;

  // ---- calibration ---------------------------------------------------------------------------------
  const calibration: CalibrationServices = createCalibrationServices({
    audio: platform.audio,
    capabilities: rt.capabilities,
    configs: cfg,
    rng: rt.rng,
    settings,
    saveSettings: (s) => settings.set(s),
    async saveCalibration(c: Calibration) {
      await repos.calibrations.put(c);
      await refreshCalibrations();
    },
    clockWall: () => platform.clockWall(),
    timers: rt.timers,
    inputDevices: () => rt.inputDevices(),
    download: (n, t) => rt.download(n, t),
    appBuild: rt.versions.build,
  });

  // ---- home ----------------------------------------------------------------------------------------
  const banners = derived<readonly HomeBanner[]>(
    [storageLost, settings, hasCalibration, dismissed],
    () => {
      const out: HomeBanner[] = [];
      const off = dismissed.get();
      if (storageLost.get() && !off.includes('storage-loss')) out.push({ kind: 'storage-loss' });
      if (!settings.get().practice.listening && !off.includes('mic-off')) out.push({ kind: 'mic-off' });
      else if (!hasCalibration.get() && !rt.testClock && !off.includes('calibrate')) out.push({ kind: 'calibrate', seconds: 8 });
      return out;
    },
    jsonEqual,
  );
  const home: HomeServices = {
    configs: cfg,
    countEligible: (instrumentId, level, meter) => countEligible(manifest, instrumentId, level, meter, cfg),
    settings,
    profile,
    today,
    banners,
    dismissBanner(kind) {
      dismissed.set([...dismissed.get(), kind]);
      if (kind === 'storage-loss') {
        storageLost.set(false);
        void rt.acknowledgeStorageLoss().catch(() => undefined);
      }
    },
    moveUp(instrumentId, to) {
      changeProfile((p) => (p.instruments[instrumentId]?.pendingOffer ? respondToLevelOffer(p, instrumentId, true, cfg).profile : setInstrumentLevel(p, instrumentId, to, cfg)));
      setPracticeLevel(instrumentId, to);
    },
    session: session.view,
    localDay: () => platform.localDay(),
    onStart(s) {
      prepareNext(s);
      return false;
    },
  };

  // ---- onboarding ----------------------------------------------------------------------------------
  const onboarding: OnboardingServices = {
    capabilities: rt.capabilities,
    instruments: cfg.instruments.instruments,
    initial: { instrumentId: settings.get().practice.instrumentId, showBeta: settings.get().practicePrefs.showBeta },
    placement: { excerpts: cfg.progression.placement.excerpts, minutes: Math.max(1, Math.round(cfg.progression.placement.excerpts * 1.5)) },
    levelCount: cfg.levels.levels.length,
    levelDescription: (level) => cfg.levelByNumber[level]?.description ?? '',
    micBrowser: rt.micBrowser,
    requestMic(): Promise<MicOutcome> {
      platform.audio.setInputEnabled?.(true);
      let p: Promise<unknown>;
      try {
        p = platform.audio.unlock();
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(
        () => ({ ok: true }),
        (e: unknown) => ({ ok: false, problem: classifyMicError(e) }),
      );
    },
    calibration,
    async finish(r: OnboardingResult) {
      const now = platform.clockWall();
      let p = profile.get() ?? createProfile(platform.idGen(), r.displayName, now, r.instrumentId, cfg);
      p = { ...p, displayName: r.displayName, activeInstrumentId: r.instrumentId };
      let level: number;
      if (r.level.kind === 'placement') {
        const placed = startPlacement(p, r.instrumentId, cfg);
        p = placed.profile;
        level = placed.firstLevel;
      } else {
        p = setInstrumentLevel(p, r.instrumentId, r.level.level, cfg);
        level = r.level.level;
      }
      await saveProfile(p);
      const s = settings.get();
      const next: AppSettings = {
        ...s,
        onboardingDone: true,
        practice: { ...s.practice, instrumentId: r.instrumentId, level, listening: r.micAllowed, mode: r.micAllowed ? s.practice.mode : 'practice' },
        practicePrefs: { ...s.practicePrefs, showBeta: r.showBeta },
      };
      settings.set(next);
      await repos.settings.put(next);
      if (r.level.kind === 'placement') {
        prepareNext(next.practice);
        return '/practice/scan';
      }
      return '/';
    },
  };

  // ---- practice flow ------------------------------------------------------------------------------
  const flow: PracticeFlowServices = {
    configs: cfg,
    session,
    view: session.view,
    loadNotation,
    settings,
    practiceInstead() {
      prepareNext({ ...settings.get().practice, mode: 'practice' });
    },
    skipLimitReached() {
      const p = session.currentProfile ?? profile.get();
      return p ? !postRevealSkipAllowed(p, cfg) : false;
    },
    ...(rt.wakeLockFailed ? { wakeLockFailed: rt.wakeLockFailed } : {}),
    reducedMotion,
    highContrast,
  };

  // ---- results and tips ----------------------------------------------------------------------------
  const tipsWillShow = (): boolean => {
    const v = session.view.getState();
    return settings.get().practicePrefs.showTips && v.tips.length > 0 && !!v.record?.score;
  };
  const results: ResultsServices = {
    configs: cfg,
    session: session.view,
    profile,
    settings,
    // 02 section 6.1 item 8: the every-10-attempts session summary opens from Next on results.
    sessionAttempts: () => sessionAttempts,
    onFinish() {
      rt.keepAwake.leavePractice();
    },
    actions: {
      next() {
        // The tips interstitial prepares the next excerpt when the player leaves it.
        if (!tipsWillShow()) prepareNext();
        return false;
      },
      tryAgain() {
        try {
          session.tryAgain();
        } catch {
          return false;
        }
        return false;
      },
      moveUp: (id, to) => home.moveUp(id, to),
      stayAt(id) {
        changeProfile((p) => respondToLevelOffer(p, id, false, cfg).profile);
      },
      undoLevelUp(id, from) {
        changeProfile((p) => setInstrumentLevel(p, id, from, cfg));
        setPracticeLevel(id, from);
      },
      goToLevel(id, level) {
        changeProfile((p) => setInstrumentLevel(p, id, level, cfg));
        setPracticeLevel(id, level);
      },
    },
    renderReview: createReviewRenderer({ configs: cfg, session: session.view, settings, loadNotation, spell: ghostPitch }),
  };
  const tips: TipsServices = {
    configs: cfg,
    session: session.view,
    settings,
    profile,
    sessionAttempts: () => sessionAttempts,
    onNext() {
      prepareNext();
      return false;
    },
    onFinish() {
      rt.keepAwake.leavePractice();
    },
  };

  // ---- settings (lazy: export and import validation stay out of the initial chunk) -------------------
  const settingsServices: SettingsServices = {
    configs: cfg,
    repos,
    kv,
    settings,
    profile: {
      get: profile.get,
      subscribe: profile.subscribe,
      set(next) {
        if (next) void saveProfile(next).catch(() => undefined);
      },
    },
    about: { appVersion: rt.versions.app, corpusVersion: manifest.corpusVersion, configVersion: cfg.configVersion, iosBeta: rt.iosBeta },
    localDay: () => platform.localDay(),
    async onDataReplaced() {
      const [s, p] = await Promise.all([repos.settings.get(), repos.profile.get()]);
      settings.replace(s);
      profile.replace(p);
      session.invalidateProfile();
      storageLost.set(false);
      await rt.acknowledgeStorageLoss();
      await Promise.all([refreshToday(), refreshCalibrations()]);
    },
    listInputDevices: () => rt.inputDevices(),
    ...(rt.storageUsed ? { storageUsed: rt.storageUsed } : {}),
    runPlacement() {
      const s = settings.get();
      changeProfile((p) => startPlacement(p, s.practice.instrumentId, cfg).profile);
    },
    ...(rt.rightsContact ? { rightsContact: rt.rightsContact } : {}),
  };
  // The export file records the app version (01 §11); export lives in this lazy chunk, so the version is set here.
  const LazySettings = lazy(() =>
    Promise.all([import('../screens/settings/index.ts'), import('../../store/export-import.ts')]).then(([m, io]) => {
      io.setExportAppVersion(rt.versions.app);
      return { default: m.createSettingsScreen(settingsServices) };
    }),
  );
  const SettingsRoute: ScreenComponent = (props: ScreenProps) => createElement(Suspense, { fallback: null }, createElement(LazySettings, props));

  // ---- route table ---------------------------------------------------------------------------------
  const withProvider = <S>(Provider: ComponentType<{ value: S; children?: ReactNode }>, value: S, Screen: ScreenComponent): ScreenComponent =>
    function Bound(props: ScreenProps) {
      return createElement(Provider, { value }, createElement(Screen, props));
    };

  const overrides: ScreenOverrides = {
    ...homeScreenOverrides(home),
    ...practiceFlowScreenOverrides(flow),
    ...resultsScreenOverrides(results),
    ...tipsScreenOverrides(tips),
    ...progressScreenOverrides({ configs: cfg, profile }),
    ...historyScreenOverrides({ configs: cfg, repos, localDay: () => platform.localDay(), profile, loadAttributions }),
    ...creditsScreenOverrides({ configs: cfg, loadAttributions, ...(rt.rightsContact ? { rightsContact: rt.rightsContact } : {}) }),
    welcome: withProvider(OnboardingServicesProvider, onboarding, OnboardingScreen),
    calibrate: withProvider(CalibrationServicesProvider, calibration, CalibrationScreen),
    settings: SettingsRoute,
  };

  rt.pruneDebug();

  return {
    table: createRouteTable(overrides),
    settings,
    session,
    services: { home, onboarding, flow, results, tips, calibration, settings: settingsServices },
    initialPath(current) {
      if (!settings.get().onboardingDone) return current === '/welcome' ? null : '/welcome';
      // A reload lands outside a take: the practice routes need a prepared excerpt.
      if (PRACTICE_PATHS.test(current) && session.state === 'idle') return '/';
      return null;
    },
    dispose() {
      unsubs.forEach((u) => u());
      session.dispose();
    },
  };
}
