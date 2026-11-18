/** Attempt detail (04 section 5.8): the results panel read-only, the credit line and the source sheet. */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AttemptRecord, AttributionsFile } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Link } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { SourceSheet } from '../about/SourceSheet.tsx';
import { text as aboutText } from '../about/text.ts';
import { ResultsPanel } from '../results/ResultsPanel.tsx';
import { creditLine } from '../results/model.ts';
import type { HistoryServices } from './services.ts';
import { text } from './text.ts';
import './history.css';

const Services = createContext<HistoryServices | null>(null);
export const AttemptServicesProvider = Services.Provider;

function useServices(): HistoryServices {
  const s = useContext(Services);
  if (!s) throw new Error('Attempt detail needs AttemptServicesProvider');
  return s;
}

const NO_PROFILE = { get: () => undefined, subscribe: () => () => undefined };

/** `undefined` while loading, `null` when the take is not on this device. */
type Found = AttemptRecord | null | undefined;

export function AttemptScreen({ route }: ScreenProps) {
  const services = useServices();
  const id = route.params['attemptId'] ?? '';
  const profileStore = services.profile ?? NO_PROFILE;
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.get, profileStore.get);
  const [record, setRecord] = useState<Found>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [attributions, setAttributions] = useState<AttributionsFile | null>(null);

  useEffect(() => {
    let live = true;
    setRecord(undefined);
    services.repos.attempts.byId(id).then(
      (r) => live && setRecord(r ?? null),
      () => live && setRecord(null),
    );
    return () => {
      live = false;
    };
  }, [id, services]);

  // The attributions file loads the first time the sheet opens.
  useEffect(() => {
    if (!sheetOpen || attributions || !services.loadAttributions) return undefined;
    let live = true;
    services.loadAttributions().then(
      (a) => live && setAttributions(a),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [sheetOpen, attributions, services]);

  if (record === undefined) {
    return (
      <section className="hist-attempt" data-testid="screen-history.attempt" data-route-id="history.attempt">
        <p role="status">{text('history.loading')}</p>
      </section>
    );
  }
  if (record === null) {
    return (
      <section className="hist-attempt" data-testid="screen-history.attempt" data-route-id="history.attempt">
        <p>{text('history.notFound')}</p>
        <Link to="/history">{text('history.backToList')}</Link>
      </section>
    );
  }

  const playAgain = services.playAgain;
  return (
    <section className="hist-attempt" data-testid="screen-history.attempt" data-route-id="history.attempt">
      <header className="hist-attempt-head">
        <Link to="/history" className="hist-back">
          {copy('common.back')}
        </Link>
        <button type="button" className="hist-credit" aria-label={aboutText('source.open')} onClick={() => setSheetOpen(true)}>
          {creditLine(record.credit)}
        </button>
      </header>
      <ResultsPanel
        record={record}
        configs={services.configs}
        readOnly
        {...(profile ? { profile } : {})}
        {...(playAgain ? { onPlayAgain: () => playAgain(record) } : {})}
      />
      <SourceSheet
        open={sheetOpen}
        record={record}
        configs={services.configs}
        attributions={attributions}
        onClose={() => setSheetOpen(false)}
      />
    </section>
  );
}
