import './calibration.css';
import { copy } from '../../../ui/copy/copy.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PlaceholderScreen } from '../Placeholder.tsx';
import { CalibrationCard } from './CalibrationCard.tsx';
import { SelfTestPanel } from './SelfTestPanel.tsx';
import { useCalibrationServices } from './services.ts';

/** `#/calibrate`: the calibration card, then the audio self-test (04 section 3.1, 5.9). */
export function CalibrationScreen(props: ScreenProps) {
  const services = useCalibrationServices();
  const navigate = useNavigate();
  // Without the composition root's services (dev shell, tests of other screens) the route stays a labelled stand-in.
  if (!services) return <PlaceholderScreen {...props} />;
  return (
    <div className="cal-screen" data-testid="screen-calibrate" data-route-id="calibrate">
      <h1 className="cal-screen-title">{copy('action.calibrate')}</h1>
      <CalibrationCard services={services} onDone={() => navigate('/')} />
      <SelfTestPanel services={services} />
    </div>
  );
}
