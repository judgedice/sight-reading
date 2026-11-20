import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Clef, PracticeSettings } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { Banner } from '../../../ui/components/containers/index.ts';
import { CalStatusPill } from '../../../ui/components/calibration-status/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { RankEmblem } from '../../../ui/components/domain/index.ts';
import { PICKER_GROUPS, voiceClef, type PickerResult, type PickerSoundView } from '../../../ui/components/picker/index.ts';
import { RangePicture } from '../../../ui/components/range/index.ts';
import { ModeControl, XpLine, lineText, type RankedBlock } from '../../../ui/components/setup/index.ts';
import { splitAt } from '../../../ui/components/setup/text.ts';
import { Glyph } from '../../../ui/primitives/Glyph.tsx';
import { openOverlayCount } from '../../../ui/primitives/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { START_BUTTON_ID } from '../Placeholder.tsx';
import { deniedStepsKey } from '../states/mic.ts';
import { applySetupChange, effectiveLevel, localSuggestions, normalize, setupModel, type FallbackNote, type SetupContext } from '../setup/model.ts';
import { SETUP_ROWS, SetupForm, rowValueText, useFallbackNotes, type SetupRowId } from '../setup/SetupForm.tsx';
import { InstrumentTile, SetupInstrumentPicker, SetupSheet, rangeDataFor } from '../setup/SetupSheet.tsx';
import { BANNER_PRIORITY, type HomeBanner, type HomeServices, type LastTry } from './services.ts';
import { liveStreakDays, rankProgress, streakAtRisk } from './today.ts';
import './home.css';

const Services = createContext<HomeServices | null>(null);

export const HomeServicesProvider = Services.Provider;

function useServices(): HomeServices {
  const s = useContext(Services);
  if (!s) throw new Error('Home needs HomeServicesProvider');
  return s;
}

function useReadable<T>(r: { get(): T; subscribe(l: () => void): () => void }): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

const NONE = { get: () => null, subscribe: () => () => {} };
function useOptionalReadable<T>(r: { get(): T; subscribe(l: () => void): () => void } | undefined): T | null {
  const src = r ?? (NONE as unknown as { get(): T | null; subscribe(l: () => void): () => void });
  return useSyncExternalStore(src.subscribe, src.get, src.get);
}

/** The two-column layout from the lg breakpoint (05 section 5.2). Without `matchMedia` (tests), the wide layout. */
export const WIDE_QUERY = '(min-width: 64em)';
function useWide(): boolean {
  const subscribe = useCallback((l: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(WIDE_QUERY);
    mq.addEventListener?.('change', l);
    return () => mq.removeEventListener?.('change', l);
  }, []);
  const get = (): boolean => (typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(WIDE_QUERY).matches);
  return useSyncExternalStore(subscribe, get, () => true);
}

function useSessionView(s: HomeServices): { state: string; corpusError: boolean; suggestions: Partial<PracticeSettings>[] | null } {
  const store = s.session;
  const state = useSyncExternalStore(
    (l) => (store ? store.subscribe(l) : () => {}),
    () => store?.getState().state ?? 'idle',
    () => 'idle',
  );
  const corpusError = useSyncExternalStore(
    (l) => (store ? store.subscribe(l) : () => {}),
    () => store?.getState().error?.code === 'corpus-load',
    () => false,
  );
  const suggestions = useSyncExternalStore(
    (l) => (store ? store.subscribe(l) : () => {}),
    () => store?.getState().emptyPoolSuggestions ?? null,
    () => null,
  );
  return { state, corpusError, suggestions };
}

/** The clef named under the instrument, the one its range picture is drawn in ("Voice · bass clef"). */
const CLEF_NAME = {
  treble: 'clef.treble',
  'treble-8vb': 'clef.treble-8vb',
  bass: 'clef.bass',
  alto: 'clef.alto',
  tenor: 'clef.tenor',
} as const satisfies Record<Clef, string>;

const GROUP_LABEL = {
  voice: 'onboarding.family.voice',
  woodwinds: 'onboarding.family.woodwinds',
  brass: 'onboarding.family.brass',
  strings: 'onboarding.family.strings',
  keyboard: 'onboarding.family.keyboard',
} as const;

/** The catalogue's list separator in "Streak 6 days · 9 takes · 214 XP today" (each part is a non-breaking unit). */
const SEPARATOR = '\u00B7';

const EMPTY_REASON_ID = 'home-empty-reason';

const ROW_LABEL = { difficulty: 'row.level', key: 'row.key', time: 'row.time', tempo: 'row.tempo', length: 'row.length' } as const;

// ---- Notices -------------------------------------------------------------------------------------------------

type Notice = Exclude<HomeBanner, { kind: 'calibrate' }> | { kind: 'mic-denied' };

/**
 * Notices in priority order (05 section 8.6): storage loss, microphone off (or blocked), Bluetooth, offer. There is no
 * calibration banner (round 2, 01-ux section 4): the status pill and the Mode line say it.
 */
function pickNotice(list: readonly HomeBanner[], micDenied: boolean): Notice | null {
  for (const kind of BANNER_PRIORITY) {
    if (kind === 'calibrate') continue;
    if (kind === 'mic-off' && micDenied) return { kind: 'mic-denied' };
    const b = list.find((x) => x.kind === kind);
    if (b && b.kind !== 'calibrate') return b;
  }
  return micDenied ? { kind: 'mic-denied' } : null;
}

/** The browser's own steps to unblock the microphone (05 section 8.6 permission state); Chromium's when unknown. */
function deniedSteps(services: HomeServices): string {
  const browser = services.micBrowser ?? 'chrome';
  return copy(deniedStepsKey(browser));
}

function NoticeRow({ services, notice }: { services: HomeServices; notice: Notice }) {
  const navigate = useNavigate();
  const dismiss = (): void => {
    if (notice.kind !== 'mic-denied') services.dismissBanner(notice.kind);
  };
  switch (notice.kind) {
    case 'storage-loss':
      return <Banner tone="danger" text={copy('banner.storageLoss')} action={{ label: copy('action.importBackup'), onClick: () => navigate('/settings/data') }} />;
    case 'mic-off':
      return <Banner tone="caution" text={copy('banner.micOff')} action={{ label: copy('action.checkMicrophone'), onClick: () => navigate('/calibrate') }} />;
    case 'mic-denied':
      return <Banner tone="caution" text={`${copy('permission.denied.title')} ${deniedSteps(services)}`} />;
    case 'bluetooth':
      return <Banner tone="caution" text={copy('banner.bluetooth')} />;
    case 'level-up':
      return (
        <Banner
          tone="info"
          text={copy('level.offer', { level: notice.from, next: notice.to })}
          action={{ label: copy('action.moveUp'), onClick: () => services.moveUp(notice.instrumentId, notice.to) }}
          dismissible
          onDismiss={dismiss}
        />
      );
  }
}

// ---- Today and rank --------------------------------------------------------------------------------------------

/** "Streak 6 days · 9 takes · 214 XP today": each part is a non-breaking unit; the line wraps between parts. */
function TodayLine({ services, className }: { services: HomeServices; className: string }) {
  const profile = useReadable(services.profile);
  const stats = useReadable(services.today);
  const day = services.localDay();
  const days = liveStreakDays(profile, day);
  const risk = streakAtRisk(profile, day, stats);
  const text = copy('home.today', { days, takes: stats.tries ?? stats.takes, xp: stats.xp });
  const parts = text.split(` ${SEPARATOR} `);
  return (
    <div className={className} role="group" aria-label={copy('common.today')}>
      <p className="home-today-line" data-testid="today-line">
        {/* A <p> may not carry aria-label: the plain sentence is read, the drawn parts are not. */}
        <span className="ui-visually-hidden">{text}</span>
        <Glyph id="flame" size={16} className="home-today-icon" />
        {parts.map((p, i) => (
          <span key={i} className="home-today-part" aria-hidden="true">
            {i > 0 ? <span className="home-today-dot">{SEPARATOR}</span> : null}
            <span className="home-nb">{p}</span>
          </span>
        ))}
      </p>
      {risk ? <p className="home-today-risk">{copy('streak.atRisk', risk)}</p> : null}
    </div>
  );
}

/**
 * "Novice · 12% to Apprentice" with a small progress ring, in the header beside the Today line (round 2, 01-ux
 * section 6). The difficulty gate, while unmet, is in the ring's name and tooltip.
 */
function RankLine({ services }: { services: HomeServices }) {
  const profile = useReadable(services.profile);
  const rank = rankProgress(services.configs, profile);
  const percent = Math.round(rank.fraction * 100);
  const reached = Math.max(0, ...Object.values(profile?.instruments ?? {}).map((i) => i?.level ?? 0));
  const gate = rank.next && reached < rank.next.minLevel ? copy('rank.bar.needsLevel', { level: rank.next.minLevel }) : null;
  const line = rank.next ? copy('home.rankLine', { rank: rank.name, percent, nextRank: rank.next.name }) : copy('rank.header', { n: rank.rank, total: rank.total });
  const cut = line.indexOf(' · ');
  const name = gate ? `${line}. ${gate}` : line;
  return (
    <div className="home-rank" data-testid="rank-line" title={gate ?? undefined}>
      <span
        className="home-rank-ring"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={name}
        style={{ ['--home-rank-p' as string]: `${percent}%` }}
      >
        <RankEmblem rank={rank.rank} state="current" size={24} />
      </span>
      <p className="home-rank-text">
        {rank.next && cut > 0 ? (
          <>
            <b>{line.slice(0, cut)}</b>
            <span className="home-muted">{line.slice(cut)}</span>
          </>
        ) : (
          <b>{line}</b>
        )}
        {gate ? <span className="ui-visually-hidden">{` ${gate}`}</span> : null}
      </p>
    </div>
  );
}

/** "Last try: B 84, Melody in F major · All tries" (round 2, 01-ux section 5.3); phones drop the title. */
function LastTryLine({ last, short, onAll }: { last: LastTry; short: boolean; onAll: () => void }) {
  let lead: ReactNode;
  if (last.grade === null || last.score === null) {
    lead = copy('home.lastTry.notGraded', { title: last.title });
  } else {
    const key = short ? 'home.lastTry.short' : 'home.lastTry';
    const [before, after] = splitAt(key, { score: last.score, title: last.title }, 'grade');
    lead = (
      <>
        {before}
        <b className="home-last-grade">{last.grade}</b>
        {after}
      </>
    );
  }
  return (
    <p className="home-last" data-testid="last-try">
      <Glyph id="history" size={16} className="home-last-icon" />
      <span className="home-last-text">{lead}</span>
      <span className="home-today-dot" aria-hidden="true">
        {SEPARATOR}
      </span>
      <button type="button" className="su-link home-last-all" onClick={onAll}>
        {copy('home.allTries')}
      </button>
    </p>
  );
}

/** "Match a note": the warm-up row (round 2, 01-ux section 3.2). Desktop: a card row with a line; phone: one line. */
function MatchRow({ phone, voice, onOpen }: { phone: boolean; voice: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={phone ? 'home-match home-match-phone' : 'home-match'} data-testid="match-entry" onClick={onOpen}>
      <span className="home-match-badge" aria-hidden="true">
        <Glyph id="tuning-fork" size={20} />
      </span>
      <span className="home-match-text">
        <span className="home-match-title">{copy(phone ? 'match.entry.phone' : 'match.entry')}</span>
        {phone ? null : <span className="home-match-body">{copy(voice ? 'home.matchEntry.body' : 'home.matchEntry.body.instrument')}</span>}
      </span>
      <Glyph id="chevron-right" size={20} className="home-match-chevron" />
    </button>
  );
}

// ---- Empty and error cards -------------------------------------------------------------------------------------

function suggestionLabel(s: Partial<PracticeSettings>): string {
  if (s.meter === 'random') return copy('home.selector.setTimeRandom');
  if (s.mode === 'practice') return copy('home.selector.practiseSeen');
  if (typeof s.level === 'number') return copy('action.goToLevel', { level: s.level });
  return copy('action.tryAgain');
}

function StateCard({
  icon,
  title,
  titleId,
  body,
  children,
  testId,
}: {
  icon: 'note' | 'alert-triangle';
  title: string;
  titleId?: string;
  body?: string;
  children?: ReactNode;
  testId: string;
}) {
  return (
    <div className="home-state" data-testid={testId} role={testId === 'corpus-error' ? 'alert' : undefined}>
      <span className="home-state-icon" aria-hidden="true">
        <Glyph id={icon} size={20} />
      </span>
      <div className="home-state-body">
        <p id={titleId} className="home-state-title">
          {title}
        </p>
        {body ? <p className="home-state-text">{body}</p> : null}
        {children}
      </div>
    </div>
  );
}

// ---- Screen ----------------------------------------------------------------------------------------------------

/** Practice: see and change the setup, know whether the take will count, start (05 sections 5 and 8.6). */
/** Space belongs to a focused control (a button, a field, a radio) before it starts a take. */
const isControl = (t: EventTarget | null): boolean =>
  t instanceof Element &&
  t.closest('button, a, input, select, textarea, [contenteditable], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], [role="option"], [role="dialog"]') !== null;

export function HomeScreen(_props: ScreenProps) {
  const services = useServices();
  const navigate = useNavigate();
  const wide = useWide();
  const settings = useReadable(services.settings);
  const profile = useReadable(services.profile);
  const banners = useReadable(services.banners);
  const availability = useOptionalReadable(services.rankedAvailability);
  const calStatus = useOptionalReadable(services.calibrationStatus);
  const lastTry = useOptionalReadable(services.lastTry);
  const pickerSound = services.pickerSound;
  const rangeSound = useOptionalReadable(pickerSound?.state);
  // "Play my range" inside the instrument picker: the same session sound as the card's button.
  const pickerView = useMemo<PickerSoundView | undefined>(
    () =>
      pickerSound
        ? {
            play: (id, midis) => pickerSound.play(id, midis),
            stop: () => pickerSound.stop(),
            prepare: (id) => pickerSound.prepare(id),
            playing: rangeSound?.playing ?? null,
            index: rangeSound?.index ?? null,
            failed: rangeSound?.failed ?? false,
          }
        : undefined,
    [pickerSound, rangeSound],
  );
  const view = useSessionView(services);
  const fallback = useFallbackNotes();
  const [stalePool, setStalePool] = useState<Partial<PracticeSettings>[] | null>(null);
  const [sheetRow, setSheetRow] = useState<SetupRowId | null>(null);
  const [picking, setPicking] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const chipRefs = useRef<Partial<Record<SetupRowId, HTMLButtonElement | null>>>({});
  const lastRow = useRef<SetupRowId | null>(null);

  const ctx = useMemo<SetupContext>(
    () => ({
      cfg: services.configs,
      eligible: services.countEligible,
      showBeta: settings.practicePrefs.showBeta,
      playerLevel: (id) => profile?.instruments[id]?.level ?? (typeof settings.practice.level === 'number' && id === settings.practice.instrumentId ? settings.practice.level : 1),
    }),
    [services, settings.practicePrefs.showBeta, settings.practice.level, settings.practice.instrumentId, profile],
  );

  // Last settings are kept, but re-filtered against the current config and music (instrument removed, level empty).
  const practice = useMemo(() => normalize(settings.practice, ctx), [settings.practice, ctx]);
  useEffect(() => {
    if (practice !== settings.practice && JSON.stringify(practice) !== JSON.stringify(settings.practice)) {
      services.settings.set({ ...settings, practice });
    }
  }, [practice, settings, services.settings]);

  // Leaving Practice stops any sound it started.
  const stopSounds = services.stopSounds;
  useEffect(
    () => () => {
      stopSounds?.();
      pickerSound?.stop();
    },
    [stopSounds, pickerSound],
  );

  const save = (next: PracticeSettings, notes: FallbackNote[] = []): void => {
    // The session's suggestions were for the settings before this change.
    setStalePool(view.suggestions);
    fallback.push(notes);
    services.settings.set({ ...services.settings.get(), practice: next });
  };
  const apply = (patch: Partial<PracticeSettings>): void => {
    const { next, notes } = applySetupChange(practice, patch, ctx);
    save(next, notes);
  };

  const block: RankedBlock | null = availability && !availability.available ? availability.block : null;
  const mode = block ? 'practice' : practice.mode;

  const inst = services.configs.instrumentById[practice.instrumentId];
  const level = effectiveLevel(practice, ctx);
  const model = useMemo(() => setupModel(practice, ctx), [practice, ctx]);
  const range = useMemo(() => (inst ? rangeDataFor(services.configs, inst, level) : null), [services.configs, inst, level]);

  const sessionPool = view.suggestions && view.suggestions.length > 0 && view.suggestions !== stalePool ? view.suggestions : null;
  const suggestions = sessionPool ?? localSuggestions(practice, ctx);
  const empty = suggestions.length > 0;
  const loading = view.state === 'loading';

  const start = (): void => {
    if (empty || loading) return;
    services.settings.set({ ...services.settings.get(), practice });
    const s = mode === practice.mode ? practice : { ...practice, mode };
    if (services.onStart?.(s) === true) return;
    navigate('/practice/scan');
  };

  // Space starts on desktop, as the keycap on Start says (06 mockup); never from a control or an open sheet.
  useEffect(() => {
    if (!wide) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== ' ' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isControl(e.target) || openOverlayCount() > 0) return;
      e.preventDefault();
      start();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const hearNote = services.playNote ? (midi: number): void => void services.playNote?.(midi).catch(() => undefined) : undefined;
  const hearTempo = services.hearTempo
    ? (bpm: number, beats: number): void => void services.hearTempo?.(bpm, beats).catch(() => undefined)
    : undefined;

  const calibrate = (): void => navigate('/calibrate');
  const openMatch = (): void => (services.openMatch ? services.openMatch() : navigate('/match'));
  const allTries = (): void => navigate('/history');

  const fix = (b: RankedBlock): void => {
    if (b === 'calibration') {
      calibrate();
      return;
    }
    const on = services.turnOnMic?.();
    if (!on) {
      navigate('/calibrate');
      return;
    }
    void on.then((r) => setMicDenied(!r.ok)).catch(() => setMicDenied(true));
  };

  const pickInstrument = (r: PickerResult): void => {
    setPicking(false);
    if (r.showLessTested !== settings.practicePrefs.showBeta) {
      const cur = services.settings.get();
      services.settings.set({ ...cur, practicePrefs: { ...cur.practicePrefs, showBeta: r.showLessTested } });
    }
    if (r.instrumentId !== practice.instrumentId) apply({ instrumentId: r.instrumentId });
  };

  const openRow = (row: SetupRowId): void => {
    lastRow.current = row;
    setSheetRow(row);
  };

  const notice = pickNotice(banners, micDenied);
  const name = inst ? instrumentName(inst) : practice.instrumentId;
  const group = inst ? PICKER_GROUPS.find((g) => g.families.includes(inst.family)) : undefined;
  const voice = inst?.family === 'voice';

  // "Play my range": the four notes of the picture, low to high, at concert pitch, in the instrument's sound.
  const playing = rangeSound?.playing === practice.instrumentId;
  const soundingSlot = playing ? (rangeSound?.index ?? null) : null;
  const playRange = (): void => {
    if (!pickerSound || !range) return;
    if (playing) {
      pickerSound.stop();
      return;
    }
    const c = range.model.concert;
    void pickerSound.play(practice.instrumentId, [c.full[0], c.served[0], c.served[1], c.full[1]]).catch(() => undefined);
  };

  const emptyCard = empty ? (
    <StateCard
      testId="empty-pool"
      titleId={EMPTY_REASON_ID}
      icon="note"
      title={copy('setup.empty.title')}
      body={copy('home.selector.noUnseen', {
        level,
        meter: practice.meter === 'random' ? copy('setup.time.anyChip') : practice.meter,
        instrument: name,
      })}
    >
      <div className="home-state-actions">
        {suggestions.map((s) => (
          <Button
            key={JSON.stringify(s)}
            size="compact"
            variant={s.mode === 'practice' ? 'quiet' : 'secondary'}
            label={suggestionLabel(s)}
            onClick={() => apply(s)}
          />
        ))}
      </div>
    </StateCard>
  ) : null;
  const errorCard = view.corpusError && !loading ? (
    <StateCard testId="corpus-error" icon="alert-triangle" title={copy('error.corpus')}>
      <div className="home-state-actions">
        <Button size="compact" variant="secondary" label={copy('action.tryAgain')} onClick={start} />
      </div>
    </StateCard>
  ) : null;

  const startButton = (
    <Button
      id={START_BUTTON_ID}
      label={loading ? copy('home.loadingMusic') : copy('action.start')}
      variant="primary"
      size="hero"
      loading={loading}
      disabled={empty}
      aria-describedby={empty ? EMPTY_REASON_ID : undefined}
      onClick={start}
      className="home-start"
      {...(wide ? { kbd: copy('shortcuts.spaceKey') } : {})}
    />
  );
  // One Calibrate control (round 2, 01-ux section 4): on the desktop it is the link in the Mode line; on the phone the
  // summary card's calibration row has it, so the Mode line names the reason without a link.
  const modeFix = wide || block !== 'calibration' || !calStatus ? fix : undefined;
  const modeControl = <ModeControl value={mode} rankedBlock={block} onFix={modeFix} onChange={(m) => apply({ mode: m })} />;
  const xpLine = empty ? null : <XpLine line={model.xp.line} none={model.xp.none} />;
  const lastLine = lastTry ? <LastTryLine last={lastTry} short={!wide} onAll={allTries} /> : null;

  if (wide) {
    return (
      <section className="home home-wide" data-testid="screen-home" data-route-id="home">
        <div className="home-head">
          <h1 className="home-title">{copy('setup.title')}</h1>
          <div className="home-head-status">
            <TodayLine services={services} className="home-today home-today-inline" />
            <span className="home-head-rule" aria-hidden="true" />
            <RankLine services={services} />
            {calStatus ? (
              <>
                <span className="home-head-rule" aria-hidden="true" />
                <CalStatusPill status={calStatus} variant="header" onCalibrate={calibrate} onSettings={() => navigate('/settings/audio')} />
              </>
            ) : null}
          </div>
        </div>
        {notice ? <NoticeRow key={notice.kind} services={services} notice={notice} /> : null}
        <div className="home-grid">
          <section className="home-card home-inst" aria-label={copy('row.instrument')}>
            {inst ? (
              <div className="home-inst-head">
                <InstrumentTile instrument={inst} />
                <div className="home-inst-text">
                  <h2 className="home-inst-name">{name}</h2>
                  {group ? <p className="home-inst-sub">{copy('home.instrumentSub', { family: copy(GROUP_LABEL[group.id]), clef: copy(CLEF_NAME[range?.staff.firstClef ?? voiceClef(inst)]) })}</p> : null}
                </div>
                <Button size="compact" variant="secondary" label={copy('setup.changeInstrument')} onClick={() => setPicking(true)} />
              </div>
            ) : null}
            {range ? (
              <div className="home-range">
                <div className="home-range-head">
                  <h3 className="home-range-title">{copy('home.rangeTitle')}</h3>
                  {pickerSound ? (
                    <Button
                      size="compact"
                      variant="tonal"
                      icon={playing ? 'stop' : 'play'}
                      label={copy(playing ? 'picker.play.stop' : 'picker.play.range')}
                      onClick={playRange}
                      onPointerEnter={() => pickerSound.prepare(practice.instrumentId)}
                      onFocus={() => pickerSound.prepare(practice.instrumentId)}
                      data-testid="play-range"
                    />
                  ) : hearNote ? (
                    <p className="home-range-hint">{copy('home.rangeHint')}</p>
                  ) : null}
                </div>
                <RangePicture data={range} instrumentName={name} onHearNote={hearNote} soundingSlot={soundingSlot} />
              </div>
            ) : null}
            <MatchRow phone={false} voice={voice} onOpen={openMatch} />
          </section>
          <section className="home-card home-setup" aria-label={copy('action.changeSetup')}>
            <SetupForm
              layout="form"
              value={practice}
              ctx={ctx}
              onChange={save}
              notes={fallback.notes}
              onNoteExpire={fallback.expire}
              onHearTempo={hearTempo}
              onMatch={openMatch}
            />
            <div className="home-setup-foot setup" data-testid="setup-foot">
              <div className="home-setup-mode">{modeControl}</div>
              {errorCard}
              {emptyCard}
              {xpLine}
              {startButton}
              {lastLine}
            </div>
          </section>
        </div>
        <SetupInstrumentPicker open={picking} value={practice} ctx={ctx} onDone={pickInstrument} onCancel={() => setPicking(false)} onHearNote={hearNote} sound={pickerView} />
      </section>
    );
  }

  return (
    <section className="home home-narrow" data-testid="screen-home" data-route-id="home">
      <div className="home-head home-head-narrow">
        <h1 className="home-title">{copy('setup.title')}</h1>
        <TodayLine services={services} className="home-today home-today-strip" />
      </div>
      {notice ? <NoticeRow key={notice.kind} services={services} notice={notice} /> : null}
      <section className="home-card home-summary" aria-label={copy('action.changeSetup')}>
        {inst && range ? (
          <button type="button" className="home-summary-inst" onClick={() => setPicking(true)}>
            <InstrumentTile instrument={inst} small />
            <span className="home-summary-inst-text">
              <span className="home-summary-inst-name">{name}</span>
              <span className="home-summary-inst-range">
                <RangePicture data={range} instrumentName={name} size="bar" barWidth={64} />
                <span>{lineText(range.model.servedLine)}</span>
              </span>
            </span>
            <span className="ui-visually-hidden">{copy('setup.changeInstrument')}</span>
            <Glyph id="chevron-right" size={20} />
          </button>
        ) : null}
        <div className="home-chips">
          {SETUP_ROWS.map((row) => {
            const label = copy(ROW_LABEL[row]);
            const value = rowValueText(row, practice, ctx);
            return (
              <button
                key={row}
                ref={(el) => {
                  chipRefs.current[row] = el;
                }}
                type="button"
                className="home-chip"
                data-chip={row}
                aria-haspopup="dialog"
                aria-label={copy('setup.chip.a11y', { row: label, value })}
                onClick={() => openRow(row)}
              >
                {/* The space keeps the visible text "Difficulty 1" inside the accessible name (axe label-content-name-mismatch). */}
                <span className="home-chip-label">{label}</span>{' '}
                <span className="home-chip-line">
                  <span className="home-chip-value">{value}</span>
                  <Glyph id="chevron-down" size={16} className="home-chip-chevron" />
                </span>
              </button>
            );
          })}
        </div>
        {calStatus ? <CalStatusPill status={calStatus} variant="card-row" onCalibrate={calibrate} onSettings={() => navigate('/settings/audio')} className="home-cal-row" /> : null}
      </section>
      {errorCard}
      {emptyCard}
      <div className="home-mode setup">{modeControl}</div>
      <div className="home-go">
        {startButton}
        {lastLine}
      </div>
      <MatchRow phone voice={voice} onOpen={openMatch} />
      <SetupSheet
        open={sheetRow !== null}
        row={sheetRow}
        value={practice}
        ctx={ctx}
        onChange={save}
        onClose={() => setSheetRow(null)}
        notes={fallback.notes}
        onNoteExpire={fallback.expire}
        onHearNote={hearNote}
        onHearTempo={hearTempo}
        onShowLessTested={(on) => {
          const cur = services.settings.get();
          services.settings.set({ ...cur, practicePrefs: { ...cur.practicePrefs, showBeta: on } });
        }}
        returnFocus={() => (lastRow.current ? (chipRefs.current[lastRow.current] ?? null) : null)}
      />
      <SetupInstrumentPicker open={picking} value={practice} ctx={ctx} onDone={pickInstrument} onCancel={() => setPicking(false)} onHearNote={hearNote} sound={pickerView} />
    </section>
  );
}
