import { copy } from '../../copy/copy.ts';
import { Button } from '../form/Button.tsx';
import './sounds.css';

export interface CoachMarkProps {
  onDismiss: () => void;
}

/**
 * The first-time note (06 section 6.8, designer's note 16): inline, on a brass wash with a 40% brass edge, between
 * "Start playing" and the sounds (above the dock row on phones). It takes its place in the page and pushes content
 * down; it is never positioned over anything. The screen shows it on the first read-through only.
 */
export function CoachMark({ onDismiss }: CoachMarkProps) {
  return (
    <div className="sd-coach" role="note" data-testid="coach-mark">
      <p className="sd-coach-text">{copy('scan.coach')}</p>
      <Button variant="secondary" size="compact" label={copy('action.gotIt')} onClick={onDismiss} />
      <span className="sd-coach-arrow" aria-hidden="true" />
    </div>
  );
}
