import { copy } from '../../../ui/copy/copy.ts';
import type { NeedleView } from './view.ts';

/**
 * The tuning meter (04-design §4): a ±50 cent track, the in-tune band as a green wash with green edges and a centre
 * tick, and a needle with an arrowhead. Ink outside the band, green inside, grey when held at an edge. Flat and sharp
 * are never red: this is a warm-up, not a grade. The state line and the "You" line carry the meaning in words, so the
 * meter itself is hidden from assistive technology.
 */
export function Needle({ view }: { view: NeedleView }) {
  const left = `${(0.5 - view.band) * 100}%`;
  const width = `${view.band * 200}%`;
  return (
    <div className="mt-meter" data-dim={view.dim ? 'true' : 'false'} data-testid="match-meter" aria-hidden="true">
      <div className="mt-track">
        <div className="mt-band" style={{ left, width }} />
        <div className="mt-centre" />
        {view.at !== null ? (
          <div className="mt-needle" data-tone={view.tone} data-testid="match-needle" data-at={view.at.toFixed(3)} style={{ left: `${view.at * 100}%` }}>
            <span className="mt-needle-head" />
            <span className="mt-needle-bar" />
          </div>
        ) : null}
      </div>
      <div className="mt-ticks">
        <span style={{ left: '0%' }} />
        <span style={{ left }} />
        <span style={{ left: `${(0.5 + view.band) * 100}%` }} />
        <span style={{ left: '100%' }} />
      </div>
      <div className="mt-labels">
        <span className="mt-label-end">{copy('match.summary.direction.flat')}</span>
        <span>{copy('component.inTune.label')}</span>
        <span className="mt-label-end">{copy('match.summary.direction.sharp')}</span>
      </div>
    </div>
  );
}
