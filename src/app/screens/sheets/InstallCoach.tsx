/** iOS install coach mark (04 section 5.10): once, iOS Safari tab mode, after the first graded attempt. */
import type { AppSettings, AttemptRecord } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { Sheet } from '../../../ui/primitives/index.ts';
import { text } from '../results/text.ts';
import './sheets.css';

/**
 * Whether the coach mark is due: not shown before, iOS or iPadOS in a browser tab (not the installed app), and the
 * attempt was graded. The caller also keeps it out of a visit that shows the rank-up card.
 */
export function installCoachDue(record: AttemptRecord | null, settings: Pick<AppSettings, 'shown'>): boolean {
  if (!record || record.score === null || !record.listening) return false;
  if (settings.shown.installCoach) return false;
  const env = record.audioEnv;
  return (env.osFamily === 'ios' || env.osFamily === 'ipados') && env.displayMode === 'browser';
}

export interface InstallCoachProps {
  open: boolean;
  onGotIt: () => void;
}

export function InstallCoach({ open, onGotIt }: InstallCoachProps) {
  return (
    <Sheet open={open} title={text('install.title')} side="bottom" onClose={onGotIt}>
      <div className="sheet-body" data-testid="install-coach">
        <p className="sheet-note">{text('install.coach')}</p>
        <div className="sheet-actions">
          <Button label={text('action.gotIt')} variant="primary" onClick={onGotIt} data-autofocus="" />
        </div>
      </div>
    </Sheet>
  );
}
