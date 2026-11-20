import './match.css';
import { createContext, useContext, useMemo } from 'react';
import { copy } from '../../../ui/copy/copy.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import { ROUND_SIZE } from './model.ts';
import { MatchPanel } from './MatchPanel.tsx';
import type { MatchServices } from './services.ts';
import { useMatch } from './use-match.ts';

const Ctx = createContext<MatchServices | null>(null);
export const MatchServicesProvider = Ctx.Provider;

function Match({ services }: { services: MatchServices }) {
  const navigate = useNavigate();
  // The instrument is read once, when the screen opens.
  const instrument = useMemo(() => services.instrument, [services]);
  const ctl = useMatch(services, instrument, 'practice');
  const { state } = ctl;
  const leave = (): void => navigate('/');
  // Dots: one per note of the round, filled green for a hit, outlined for a miss, ringed for the current note.
  const dots = Array.from({ length: ROUND_SIZE }, (_, i) => {
    const r = state.results[i];
    if (r) return r.hit ? 'hit' : 'miss';
    return i === state.index && state.phase !== 'summary' ? 'current' : 'todo';
  });
  return (
    <div className="mt" data-testid="screen-match" data-route-id="match">
      <header className="mt-head">
        <button type="button" className="mt-back" onClick={leave}>
          <Glyph id="chevron-left" size={22} />
          <span className="mt-back-label">{copy('nav.practice')}</span>
        </button>
        <h1 className="mt-title">{copy('match.title')}</h1>
        <div className="mt-progress" aria-hidden="true">
          {dots.map((d, i) => (
            <span key={i} className="mt-dot" data-done={d} />
          ))}
        </div>
      </header>
      <div className="mt-main">
        <MatchPanel ctl={ctl} instrument={instrument} cfg={services.cfg} chips onDone={leave} />
      </div>
    </div>
  );
}

/** `#/match` (01-ux §3, 04-design §4). Focused chrome: back, the title, the round's dots; no tabs. */
export function MatchScreen(props: ScreenProps) {
  const services = useContext(Ctx);
  if (!services) return <PlaceholderScreen {...props} />;
  return <Match services={services} />;
}
