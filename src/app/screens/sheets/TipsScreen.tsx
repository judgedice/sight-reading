/** Tips interstitial (04 section 5.6) with the "Done for now" session summary. */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Tip } from '../../../core/types.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { Button, Toggle } from '../../../ui/components/form/index.ts';
import { TipCard, type TipContent } from '../../../ui/components/domain/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { dimensionLabel, patternDef, tipHeadline } from '../results/model.ts';
import { text } from '../results/text.ts';
import { SessionSummary } from './SessionSummary.tsx';
import type { TipsServices } from './services.ts';
import { summarizeSession } from './summary.ts';
import './sheets.css';

const Services = createContext<TipsServices | null>(null);
export const TipsServicesProvider = Services.Provider;

function useServices(): TipsServices {
  const s = useContext(Services);
  if (!s) throw new Error('Tips needs TipsServicesProvider');
  return s;
}

function useReadable<T>(r: { get(): T; subscribe(l: () => void): () => void }): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

export function TipsScreen(_props: ScreenProps) {
  const services = useServices();
  const navigate = useNavigate();
  const view = useSyncExternalStore(services.session.subscribe, services.session.getState, services.session.getState);
  const settings = useReadable(services.settings);
  const profile = useReadable(services.profile);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const record = view.record;

  useEffect(() => {
    if (!record) navigate('/', { replace: true });
  }, [record, navigate]);
  if (!record) return null;

  const cfg = services.configs;
  const instrument = cfg.instrumentById[record.instrumentId];
  const tips: readonly Tip[] = view.tips.slice(0, cfg.tips.selection.maxTips);
  const primary = tips.find((t) => t.primary) ?? tips[0];
  const secondary = tips.find((t) => t !== primary);
  const incomplete = record.score?.status === 'incomplete';

  const next = (): void => {
    if (services.onNext?.() !== true) navigate('/practice/scan');
  };
  const finish = (): void => {
    setSummaryOpen(false);
    services.onFinish?.();
    navigate('/');
  };

  const content = (t: Tip): TipContent => {
    const def = patternDef(cfg, t.patternId);
    return {
      instrumentAbbr: text(`instrument.abbr.${record.instrumentId}` as never),
      instrumentName: instrument?.label ?? record.instrumentId,
      dimension: dimensionLabel(def?.dimension ?? 'none'),
      headline: tipHeadline(cfg, t),
      body: t.text,
      evidence: t.evidence,
    };
  };

  const actions = (
    <div className="tips-actions">
      <Button label={text('action.nextExcerpt')} variant="primary" onClick={next} data-autofocus="" />
      <Button label={text('action.doneForNow')} variant="tertiary" onClick={() => setSummaryOpen(true)} />
    </div>
  );

  return (
    <section className="tips-screen" data-testid="screen-practice.tips" aria-label={text('tips.header')}>
      <div className="tips-card">
        {primary ? (
          <>
            <TipCard
              tip={content(primary)}
              {...(secondary ? { secondary: content(secondary), index: 1, total: 2 } : {})}
              actions={actions}
            />
            {incomplete ? <p className="tips-incomplete">{text('tips.incomplete')}</p> : null}
          </>
        ) : (
          <Card>
            <h1 className="tips-heading">{text('tips.header')}</h1>
            <p className="tips-body" data-testid="tips-none">
              {incomplete ? text('tips.incomplete') : text('tips.noTips')}
            </p>
            {actions}
          </Card>
        )}
        <Toggle
          checked={settings.practicePrefs.showTips}
          label={text('tips.showBetween')}
          onChange={(v) => services.settings.set({ ...settings, practicePrefs: { ...settings.practicePrefs, showTips: v } })}
        />
      </div>
      <SessionSummary
        open={summaryOpen}
        data={summarizeSession(services.sessionAttempts(), cfg, profile)}
        onKeepGoing={() => {
          setSummaryOpen(false);
          next();
        }}
        onFinish={finish}
      />
    </section>
  );
}
