/** Stop confirm (04 section 5.10). Esc during a take stops at once and never reaches this sheet. */
import { Button } from '../../../ui/components/form/index.ts';
import { Modal } from '../../../ui/primitives/index.ts';
import { text } from '../results/text.ts';
import './sheets.css';

export type StopVariant = 'ranked-before-note' | 'ranked-after-note' | 'practice';

/** Which confirm applies: ranked or practice, and whether a note was heard yet. */
export function stopVariant(s: { ranked: boolean; firstNoteHeard: boolean }): StopVariant {
  if (!s.ranked) return 'practice';
  return s.firstNoteHeard ? 'ranked-after-note' : 'ranked-before-note';
}

export interface StopSheetProps {
  open: boolean;
  variant: StopVariant;
  /** The credit line, once the excerpt has been shown: every variant ends "That was: {credit}". */
  credit?: string | undefined;
  /** "Keep playing", Esc and the scrim. */
  onKeep: () => void;
  onStop: () => void;
  /** Ranked before the first note: restarts the count-in. */
  onRestart?: () => void;
}

const TITLE = {
  'ranked-before-note': 'play.stopConfirm.ranked.beforeNote',
  'ranked-after-note': 'play.stopConfirm.ranked.afterNote',
  practice: 'play.stopConfirm.practice',
} as const;

export function StopSheet({ open, variant, credit, onKeep, onStop, onRestart }: StopSheetProps) {
  const before = variant === 'ranked-before-note';
  return (
    <Modal
      open={open}
      title={text(TITLE[variant])}
      onClose={onKeep}
      closeButton={false}
      size="confirm"
      className="sheet-card"
      footer={
        <div className="sheet-actions">
          <Button label={text('action.stop')} icon="stop" onClick={onStop} />
          {before ? (
            <Button label={text('action.restart')} variant="primary" onClick={onRestart ?? onKeep} data-autofocus="" />
          ) : (
            <Button label={text('action.keepPlaying')} variant="primary" onClick={onKeep} data-autofocus="" />
          )}
        </div>
      }
    >
      <div className="sheet-body" data-testid={`stop-${variant}`}>
        {credit ? <p className="sheet-credit">{text('credit.that-was', { credit })}</p> : null}
      </div>
    </Modal>
  );
}
