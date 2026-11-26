import './calibration.css';
import { copy } from '../../../ui/copy/copy.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import { CalibrationCard } from './CalibrationCard.tsx';
import { useCalibrationServices } from './services.ts';

/** Where `#/calibrate` was opened from: `?from=settings` (Settings > Sound), anything else Home. */
export function calibrateReferrer(hash: string): { path: string; label: string } {
  const q = hash.indexOf('?');
  const from = q >= 0 ? new URLSearchParams(hash.slice(q + 1)).get('from') : null;
  return from === 'settings' ? { path: '/settings/audio', label: copy('nav.settings') } : { path: '/', label: copy('nav.home') };
}

/**
 * `#/calibrate`: the calibration card; its run includes the audio self-test, so there is one flow and one result (04
 * section 3.1, 5.9). Round 3 (01-ux-review problem 10): a Back link to where the player came from, and Continue
 * returns there too.
 */
export function CalibrationScreen(props: ScreenProps) {
  const services = useCalibrationServices();
  const navigate = useNavigate();
  // Without the composition root's services (dev shell, tests of other screens) the route stays a labelled stand-in.
  if (!services) return <PlaceholderScreen {...props} />;
  const back = calibrateReferrer(typeof window === 'undefined' ? '' : window.location.hash);
  return (
    <div className="cal-screen" data-testid="screen-calibrate" data-route-id="calibrate">
      <div className="cal-screen-head">
        <Button label={back.label} variant="quiet" size="compact" icon="chevron-left" onClick={() => navigate(back.path)} className="cal-back" data-testid="calibrate-back" />
        <h1 className="cal-screen-title">{copy('action.calibrate')}</h1>
      </div>
      <CalibrationCard services={services} onDone={() => navigate(back.path)} />
    </div>
  );
}
