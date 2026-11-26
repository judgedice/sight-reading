import type { GlyphId } from '../../../ui/glyph-ids.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { copy } from '../../../ui/copy/copy.ts';

export interface FooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: GlyphId;
  testId?: string;
  /** The id of the visible line that says why the action waits (disabled). */
  describedBy?: string;
}

export interface WizardFooterProps {
  onBack?: (() => void) | undefined;
  /** The tertiary skip ("Not now", "Skip this check", "Skip for now", "Go to Home"), left of the primary. */
  skip?: FooterAction | null | undefined;
  /** The main action: always the rightmost button. */
  primary?: FooterAction | null | undefined;
  /** What skipping costs, beside Skip ("Skipped, your tries are practice until you run it."). */
  note?: string | null | undefined;
}

/**
 * The setup footer (round 3, 01-ux-review §3.1): fixed to the bottom of the viewport on every step, in the same
 * layout. Back at the left; Skip and the primary at the right, the primary always rightmost. On the phone the primary
 * takes the full width on its own row below Back and Skip.
 */
export function WizardFooter({ onBack, skip, primary, note }: WizardFooterProps) {
  return (
    <div className="ob-footer" data-testid="wizard-footer">
      <div className="ob-footer-inner">
        <div className="ob-footer-back">{onBack ? <Button label={copy('common.back')} variant="quiet" icon="chevron-left" onClick={onBack} data-testid="wizard-back" /> : null}</div>
        {note ? <p className="ob-footer-note">{note}</p> : null}
        <div className="ob-footer-actions">
          {skip ? (
            <Button
              label={skip.label}
              variant="quiet"
              onClick={skip.onClick}
              disabled={skip.disabled ?? false}
              className="ob-footer-skip"
              data-testid={skip.testId ?? 'wizard-skip'}
            />
          ) : null}
          {primary ? (
            <Button
              label={primary.label}
              variant="primary"
              {...(primary.icon ? { icon: primary.icon } : {})}
              onClick={primary.onClick}
              disabled={primary.disabled ?? false}
              loading={primary.loading ?? false}
              {...(primary.describedBy ? { 'aria-describedby': primary.describedBy } : {})}
              className="ob-footer-primary"
              data-testid={primary.testId ?? 'wizard-primary'}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
