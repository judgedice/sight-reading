/** Skip after reveal (04 section 5.10): from scan overflow or Back. */
import { Button } from '../../../ui/components/form/index.ts';
import { Modal } from '../../../ui/primitives/index.ts';
import { text } from '../results/text.ts';
import './sheets.css';

export interface SkipSheetProps {
  open: boolean;
  /** Skipping now would exceed the limit: the next excerpt will be practice. */
  limitExceeded: boolean;
  /** One skip per this many ranked takes (progression.skip.postRevealPerRanked). */
  perRanked: number;
  onSkip: () => void;
  onKeepReading: () => void;
}

export function SkipSheet({ open, limitExceeded, perRanked, onSkip, onKeepReading }: SkipSheetProps) {
  return (
    <Modal
      open={open}
      title={text('dialog.skip.title')}
      onClose={onKeepReading}
      closeButton={false}
      size="confirm"
      className="sheet-card"
      footer={
        <div className="sheet-actions">
          <Button label={text('action.skip')} icon="skip" onClick={onSkip} />
          <Button label={text('action.keepReading')} variant="primary" onClick={onKeepReading} data-autofocus="" />
        </div>
      }
    >
      <div className="sheet-body" data-testid="skip-sheet">
        {limitExceeded ? <p className="sheet-note">{text('dialog.skip.practiceNotice', { n: perRanked })}</p> : null}
      </div>
    </Modal>
  );
}
