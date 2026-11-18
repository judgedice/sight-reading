/** The progress route (04 section 5.7): rank header, rank ladder, instruments, streak, common slips. */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { copy } from '../../../ui/copy/copy.ts';
import { EmptyState, RankEmblem } from '../../../ui/components/domain/index.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { rankBar } from '../results/model.ts';
import type { ScreenProps } from '../../route-types.ts';
import { ladder, instrumentCards, slipsInstrument, topSlips, SLIPS_MIN_ATTEMPTS, type InstrumentCard } from './model.ts';
import type { ProgressServices } from './services.ts';
import { text } from './text.ts';
import './progress.css';

const Services = createContext<ProgressServices | null>(null);
export const ProgressServicesProvider = Services.Provider;

function useServices(): ProgressServices {
  const s = useContext(Services);
  if (!s) throw new Error('Progress needs ProgressServicesProvider');
  return s;
}

function useReadable<T>(r: { get(): T; subscribe(l: () => void): () => void }): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

function InstrumentCardView({ card }: { card: InstrumentCard }) {
  const attemptsLabel = text('progress.attempts', { n: card.attemptsRanked });
  return (
    <Card className="prog-instrument">
      <h3 className="prog-instrument-name">{card.label}</h3>
      <p className="prog-instrument-level">{copy('progress.instrumentLevel', { level: card.level })}</p>
      <ol className="prog-window" aria-label={text('progress.window.label')}>
        {card.squares.map((sq, i) => {
          if (!sq) {
            return (
              <li key={i} className="prog-window-square" data-state="empty">
                <span className="ui-visually-hidden">{text('progress.window.empty')}</span>
              </li>
            );
          }
          return (
            <li key={i} className="prog-window-square" data-state={sq.passed ? 'pass' : 'short'}>
              <span className="prog-window-score">{sq.score}</span>
              {sq.passed ? <Glyph id="check" size={14} className="prog-window-check" /> : null}
              {sq.midTempo ? (
                <span className="prog-window-tempo" title={text('progress.window.midTempo')} aria-label={text('progress.window.midTempo')} />
              ) : null}
            </li>
          );
        })}
      </ol>
      {card.best.length > 0 ? (
        <>
          <h4 className="prog-subheading">{text('progress.level.best')}</h4>
          <ul className="prog-best">
            {card.best.map((b) => (
              <li key={b.level}>{text('progress.best', { level: b.level, score: Math.round(b.score) })}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="prog-muted">{attemptsLabel}</p>
    </Card>
  );
}

export function ProgressScreen(_props: ScreenProps) {
  const services = useServices();
  const profile = useReadable(services.profile);
  const cfg = services.configs;

  if (!profile) {
    return (
      <section className="prog-screen" data-testid="screen-progress" data-route-id="progress">
        <h1 className="prog-title">{copy('nav.progress')}</h1>
        <EmptyState icon="mic" title={copy('empty.progress.title')} body={copy('empty.progress.body')} />
      </section>
    );
  }

  const rb = rankBar(cfg, profile);
  const rungs = ladder(cfg, profile);
  const cards = instrumentCards(cfg, profile);
  const slipsId = slipsInstrument(profile);
  const slipsProgress = slipsId ? profile.instruments[slipsId] : undefined;
  const slips = topSlips(cfg, slipsProgress);
  const streakMin = cfg.progression.xp.streakMinRankedPerDay;

  return (
    <section className="prog-screen" data-testid="screen-progress" data-route-id="progress">
      <h1 className="prog-title">{copy('nav.progress')}</h1>

      <div className="prog-layout">
        <div className="prog-column">
          <Card className="prog-rank">
            <div className="prog-rank-head">
              <RankEmblem rank={rb.rank} state="current" size={64} />
              <div>
                <h2 className="prog-rank-name">{rb.name}</h2>
                <p className="prog-muted">{copy('rank.header', { n: rb.rank, total: rb.total })}</p>
                <p className="prog-xp">{text('progress.xp', { xp: profile.xp.toLocaleString('en') })}</p>
              </div>
            </div>
            <div
              className="prog-rank-bar"
              role="progressbar"
              aria-label={rb.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rb.fraction * 100)}
            >
              <span className="prog-rank-bar-fill" style={{ inlineSize: `${Math.round(rb.fraction * 100)}%` }} />
            </div>
            <p className="prog-muted">{rb.label}</p>
          </Card>

          <Card className="prog-streak">
            <h2 className="prog-heading">{text('progress.streak.title')}</h2>
            {profile.streak.days > 0 ? (
              <p>{text('progress.streak.days', { n: profile.streak.days })}</p>
            ) : (
              <p>{text('progress.streak.none')}</p>
            )}
            <p className="prog-muted">{copy('streak.needs', { n: streakMin })}</p>
          </Card>

          <Card className="prog-slips">
            <h2 className="prog-heading">{copy('progress.slips.title')}</h2>
            {slipsProgress && slipsProgress.attemptsRanked >= SLIPS_MIN_ATTEMPTS && slips.length > 0 ? (
              <ul className="prog-slip-list">
                {slips.map((s) => (
                  <li key={s.id} className="prog-slip">
                    <span>{s.name}</span>
                    <span className="prog-muted">{text('progress.slips.times', { n: s.count })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="info" title={copy('empty.slips.title')} body={copy('empty.slips.body')} />
            )}
          </Card>
        </div>

        <div className="prog-column">
          <section className="prog-ladder-section" aria-label={text('progress.ladder.label')}>
            <ol className="prog-ladder">
              {rungs.map((r) => (
                <li key={r.rank} className="prog-rung" data-state={r.state} aria-current={r.state === 'current' ? 'step' : undefined}>
                  <RankEmblem rank={r.rank} state={r.state} size={24} />
                  <span className="prog-rung-name">{r.name}</span>
                  <span className="prog-muted">
                    {r.state === 'achieved'
                      ? text('progress.ladder.achieved')
                      : r.state === 'current'
                        ? text('progress.ladder.current')
                        : text('progress.ladder.future', { xp: r.xp.toLocaleString('en'), level: r.minLevel })}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="prog-instruments" aria-label={text('progress.instruments.title')}>
            {cards.length === 0 ? (
              <p className="prog-muted">{text('progress.instruments.none')}</p>
            ) : (
              cards.map((c) => <InstrumentCardView key={c.id} card={c} />)
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
