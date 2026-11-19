import './primitives.css';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { copy } from '../copy/copy.ts';
import { Glyph } from './Glyph.tsx';
import { Popover } from './Popover.tsx';

/** A hover opens the popover after this long, on fine pointers only (06 section 6.7). */
export const INFO_HOVER_DELAY_MS = 400;
/** Time allowed to move the pointer from the button onto the popover before it closes. */
const LEAVE_GRACE_MS = 120;

export interface InfoButtonProps {
  /** Name of the control this explains. The accessible name is "About {control}". */
  control: string;
  /** Bold first line of the popover, for example "What is the reference?". */
  title: string;
  /** Popover body. Pass the same string the phone sheet shows. */
  children: ReactNode;
}

function finePointer(event: Event): boolean {
  if ((event as PointerEvent).pointerType === 'touch') return false;
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * The (i) button next to a control (06 section 6.7). A press pins the popover open until Escape, a press
 * outside or a second press. On fine pointers a 400 ms hover also opens it, and leaving closes it unless
 * pinned. Touch is press only. Focus returns to the button when Escape closes the popover.
 */
export function InfoButton({ control, title, children }: InfoButtonProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const popoverId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(false);
  pinnedRef.current = pinned;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPinned(false);
  }, [clearTimer]);

  useEffect(() => {
    if (!anchor) return undefined;
    const enter = (event: Event): void => {
      if (!finePointer(event)) return;
      clearTimer();
      if (pinnedRef.current) return;
      timer.current = setTimeout(() => setOpen(true), INFO_HOVER_DELAY_MS);
    };
    const leave = (event: Event): void => {
      if (!finePointer(event)) return;
      clearTimer();
      if (pinnedRef.current) return;
      timer.current = setTimeout(() => setOpen(false), LEAVE_GRACE_MS);
    };
    anchor.addEventListener('pointerenter', enter);
    anchor.addEventListener('pointerleave', leave);
    return () => {
      anchor.removeEventListener('pointerenter', enter);
      anchor.removeEventListener('pointerleave', leave);
    };
  }, [anchor, clearTimer]);

  const name = copy('reference.info.button', { control });
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="ui-info-button"
        aria-label={name}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          clearTimer();
          if (open && pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        <span className="ui-info-button-disc">
          <Glyph id="info" size={16} />
        </span>
      </button>
      <Popover
        open={open}
        anchor={anchor}
        label={title}
        title={title}
        id={popoverId}
        onClose={close}
        onPointerEnter={clearTimer}
        onPointerLeave={(event) => {
          if (pinnedRef.current || event.pointerType === 'touch') return;
          clearTimer();
          timer.current = setTimeout(() => setOpen(false), LEAVE_GRACE_MS);
        }}
      >
        {children}
      </Popover>
    </>
  );
}
