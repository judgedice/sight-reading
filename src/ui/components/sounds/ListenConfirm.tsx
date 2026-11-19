import { useEffect } from 'react';
import { copy } from '../../copy/copy.ts';
import { Button } from '../form/Button.tsx';
import { Modal } from '../../primitives/Modal.tsx';
import { Sheet } from '../../primitives/Sheet.tsx';
import { PHONE_QUERY, useMediaQuery } from './media.ts';
import './sounds.css';

export interface ListenConfirmProps {
  open: boolean;
  /** Whole seconds of reading time left. The confirm states it; the countdown never pauses. */
  secondsLeft: number;
  /** "Keep it ranked": the default. Escape, a scrim tap, a swipe down, the close and 0:00 all call this. */
  onKeepRanked: () => void;
  /** "Listen, make it practice". */
  onListen: () => void;
  /** Force the layout; by default a phone gets a sheet and anything wider a dialog. */
  presentation?: "dialog" | "sheet" | undefined;
  /** The whole time line, when the screen has its own wording. Default is the catalogue's "{time} left". */
  timeLine?: string | undefined;
}

/** m:ss from whole seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The ranked "Listen first?" confirm (05 sections 4.3 and 9.4). A dialog on desktop, a bottom sheet on phones.
 * "Keep it ranked" is primary and takes focus; Escape, a scrim tap and a swipe down all keep it ranked, with
 * nothing played. If the reading time reaches 0 while it is open it closes as "Keep it ranked".
 */
export function ListenConfirm({ open, secondsLeft, onKeepRanked, onListen, presentation, timeLine }: ListenConfirmProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const asSheet = (presentation ?? (phone ? 'sheet' : 'dialog')) === 'sheet';
  useEffect(() => {
    if (open && secondsLeft <= 0) onKeepRanked();
  }, [open, secondsLeft, onKeepRanked]);

  const time = timeLine ?? copy('scan.timeLeft', { time: formatClock(secondsLeft) });
  const keep = <Button variant="primary" label={copy('listen.confirm.no')} onClick={onKeepRanked} data-autofocus="" />;
  const listen = <Button variant="secondary" label={copy('listen.confirm.yes')} onClick={onListen} />;
  const body = (
    <div className="sd-confirm-body">
      <p className="sd-confirm-text">{copy('listen.confirm.body')}</p>
      <p className="sd-confirm-time" data-testid="confirm-time">
        {time}
      </p>
    </div>
  );

  if (asSheet) {
    return (
      <Sheet open={open} title={copy('listen.confirm.title')} onCancel={onKeepRanked}>
        <div className="sd-confirm-sheet" data-testid="listen-confirm">
          {body}
          <div className="sd-confirm-actions">
            {keep}
            {listen}
          </div>
        </div>
      </Sheet>
    );
  }
  return (
    <Modal
      open={open}
      title={copy('listen.confirm.title')}
      size="confirm"
      onClose={onKeepRanked}
      closeButton={false}
      className="sd-confirm-modal"
      footer={
        <>
          {listen}
          {keep}
        </>
      }
    >
      <div data-testid="listen-confirm">{body}</div>
    </Modal>
  );
}
