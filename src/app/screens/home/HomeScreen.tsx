import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PracticeSettings } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { EmptyState, RankEmblem } from '../../../ui/components/domain/index.ts';
import { Link, useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { START_BUTTON_ID } from '../Placeholder.tsx';
import {
  effectiveLevel,
  localSuggestions,
  normalize,
  type SetupContext,
} from '../setup/model.ts';
import { SetupForm } from '../setup/SetupForm.tsx';
import { BANNER_PRIORITY, type HomeBanner, type HomeServices } from './services.ts';
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

function useSessionSuggestions(s: HomeServices): Partial<PracticeSettings>[] | null {
  const store = s.session;
  return useSyncExternalStore(
    (l) => (store ? store.subscribe(l) : () => {}),
    () => store?.getState().emptyPoolSuggestions ?? null,
    () => null,
  );
}

function pickBanner(list: readonly HomeBanner[]): HomeBanner | null {
  for (const kind of BANNER_PRIORITY) {
    const b = list.find((x) => x.kind === kind);
    if (b) return b;
  }
  return null;
}

function BannerRow({ services, banner }: { services: HomeServices; banner: HomeBanner }) {
  const navigate = useNavigate();
  const dismiss = (): void => services.dismissBanner(banner.kind);
  switch (banner.kind) {
    case 'storage-loss':
      return <Banner tone="danger" text={copy('banner.storageLoss')} action={{ label: copy('action.importBackup'), onClick: () => navigate('/settings/data') }} />;
    case 'mic-off':
      return <Banner tone="caution" text={copy('banner.micOff')} action={{ label: copy('action.checkMicrophone'), onClick: () => navigate('/calibrate') }} />;
    case 'calibrate':
      return (
        <Banner
          tone="info"
          text={copy('banner.calibrateNeeded', { seconds: banner.seconds })}
          action={{ label: copy('action.calibrate'), onClick: () => navigate('/calibrate') }}
          dismissible
          onDismiss={dismiss}
        />
      );
    case 'bluetooth':
      return <Banner tone="caution" text={copy('banner.bluetooth')} />;
    case 'level-up':
      return (
        <Banner
          tone="info"
          text={copy('level.offer', { level: banner.from, next: banner.to })}
          action={{ label: copy('action.moveUp'), onClick: () => services.moveUp(banner.instrumentId, banner.to) }}
          dismissible
          onDismiss={dismiss}
        />
      );
  }
}

function TodayStrip({ services }: { services: HomeServices }) {
  const profile = useReadable(services.profile);
  const stats = useReadable(services.today);
  const day = services.localDay();
  const rank = rankProgress(services.configs, profile);
  const days = liveStreakDays(profile, day);
  const risk = streakAtRisk(profile, day, stats);
  const rankText = rank.next
    ? copy('rank.bar', { rank: rank.name, n: rank.rank, total: rank.total, xp: rank.xp, next: rank.next.xp, nextRank: rank.next.name, level: rank.next.minLevel })
    : copy('rank.header', { n: rank.rank, total: rank.total });
  return (
    <Card className="home-today">
      <h2 className="home-today-title">{copy('common.today')}</h2>
      <p className="home-today-line" data-testid="today-line">
        {copy('home.today', { days, takes: stats.takes, xp: stats.xp })}
      </p>
      {risk ? <p className="home-today-risk">{copy('streak.atRisk', risk)}</p> : null}
      <div className="home-rank">
        <RankEmblem rank={rank.rank} state="current" size={24} />
        <span className="home-rank-name">{rank.name}</span>
        <div
          className="home-rank-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(rank.fraction * 100)}
          aria-label={rankText}
        >
          <div className="home-rank-fill" style={{ width: `${Math.round(rank.fraction * 100)}%` }} />
        </div>
        <span className="home-rank-pct">{`${Math.round(rank.fraction * 100)}%`}</span>
      </div>
      <p className="home-rank-text">{rankText}</p>
    </Card>
  );
}

function suggestionLabel(s: Partial<PracticeSettings>): string {
  if (s.meter === 'random') return copy('home.selector.setTimeRandom');
  if (s.mode === 'practice') return copy('home.selector.practiseSeen');
  if (typeof s.level === 'number') return copy('action.goToLevel', { level: s.level });
  return copy('action.tryAgain');
}

/** Home is setup (04 section 5.2). */
export function HomeScreen(_props: ScreenProps) {
  const services = useServices();
  const navigate = useNavigate();
  const settings = useReadable(services.settings);
  const profile = useReadable(services.profile);
  const banners = useReadable(services.banners);
  const sessionSuggestions = useSessionSuggestions(services);
  const [dismissedPool, setDismissedPool] = useState(false);

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

  const save = (next: PracticeSettings): void => {
    setDismissedPool(false);
    services.settings.set({ ...settings, practice: next });
  };

  const start = (): void => {
    services.settings.set({ ...settings, practice });
    if (services.onStart?.(practice) === true) return;
    navigate('/practice/scan');
  };

  const banner = pickBanner(banners);

  const suggestions = sessionSuggestions && sessionSuggestions.length > 0 ? sessionSuggestions : localSuggestions(practice, ctx);
  const level = effectiveLevel(practice, ctx);
  const inst = services.configs.instrumentById[practice.instrumentId];
  const apply = (s: Partial<PracticeSettings>): void => {
    save(normalize({ ...practice, ...s }, ctx));
  };

  return (
    <section className="home" data-testid="screen-home" data-route-id="home">
      <h1 className="home-title">{copy('nav.practice')}</h1>
      {banner ? <BannerRow key={banner.kind} services={services} banner={banner} /> : null}
      <div className="home-layout">
        <div className="home-main">
          <SetupForm value={practice} onChange={save} ctx={ctx} />
          {suggestions.length > 0 && !dismissedPool ? (
            <div className="home-empty" data-testid="empty-pool">
              <EmptyState
                icon="info"
                title={copy('empty.selector.title')}
                body={copy('home.selector.noUnseen', {
                  level,
                  meter: practice.meter === 'random' ? copy('chip.random').toLowerCase() : practice.meter,
                  instrument: inst?.label ?? practice.instrumentId,
                })}
                action={
                  <div className="home-empty-actions">
                    {suggestions.map((s) => (
                      <Button key={JSON.stringify(s)} label={suggestionLabel(s)} onClick={() => apply(s)} />
                    ))}
                  </div>
                }
              />
            </div>
          ) : null}
        </div>
        <aside className="home-side">
          <TodayStrip services={services} />
        </aside>
      </div>
      <div className="home-start-bar">
        <Button id={START_BUTTON_ID} label={copy('action.start')} variant="primary" size="hero" onClick={start} className="home-start" />
        <Link to="/credits" className="home-credits">
          {copy('common.credits')}
        </Link>
      </div>
    </section>
  );
}
