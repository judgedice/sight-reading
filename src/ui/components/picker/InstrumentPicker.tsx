import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Instrument } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { instrumentName } from '../../copy/instrument-names.ts';
import { Button } from '../form/Button.tsx';
import { Toggle } from '../form/Toggle.tsx';
import { Modal } from '../../primitives/Modal.tsx';
import { SHEET_SWIPE_DISTANCE } from '../../primitives/Sheet.tsx';
import { useOverlay } from '../../primitives/use-overlay.ts';
import { RangePicture } from '../range/RangePicture.tsx';
import type { RangeData } from '../range/types.ts';
import { InstrumentGrid } from './InstrumentGrid.tsx';
import './picker.css';

/** Below this width the picker is a full-height sheet (06 section 10; the mockup switches at 700 px). */
export const PICKER_SHEET_QUERY = '(max-width: 43.6875rem)';

export interface PickerResult {
  instrumentId: string;
  /** The "Show more instruments (less tested)" switch as it was at Done. */
  showLessTested: boolean;
}

export interface InstrumentPickerProps {
  open: boolean;
  /** Every instrument in config order. */
  instruments: readonly Instrument[];
  /** The player's instrument; the picker starts on it and Cancel keeps it. */
  value: string;
  /** Range data at the player's current difficulty for each instrument (05 section 6.4). */
  rangeFor: (id: string) => RangeData;
  showLessTested: boolean;
  /** Applies the pick. */
  onDone: (result: PickerResult) => void;
  /** Cancel, Escape, the close button, a scrim tap and a swipe down: discards the pick. */
  onCancel: () => void;
  /** Plays a range note at its sounding MIDI pitch. */
  onHearNote?: ((midi: number, instrumentId: string) => void) | undefined;
  showServed?: boolean;
  /** `auto` follows the window width. */
  layout?: 'auto' | 'dialog' | 'sheet';
}

function useSheetLayout(layout: 'auto' | 'dialog' | 'sheet'): boolean {
  const query = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PICKER_SHEET_QUERY).matches;
  const [narrow, setNarrow] = useState(query);
  useEffect(() => {
    if (layout !== 'auto' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PICKER_SHEET_QUERY);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [layout]);
  return layout === 'sheet' || (layout === 'auto' && narrow);
}

export interface PickedRangeProps {
  instrument: Instrument;
  data: RangeData;
  onHearNote?: ((midi: number, instrumentId: string) => void) | undefined;
  showServed?: boolean;
  /** `column`: the dialog's right column with the keyboard; `panel`: the phone's pinned panel without it. */
  variant: 'column' | 'panel';
  /**
   * The name and "Difficulty N" above the picture. Off where the screen already says both (the onboarding difficulty
   * step, whose stepper sits right above).
   */
  head?: boolean;
}

/** The selection's name, its difficulty, and the large range picture (05 section 6.4, designer's note 6). */
export function PickedRange({ instrument, data, onHearNote, showServed = true, variant, head = true }: PickedRangeProps) {
  const name = instrumentName(instrument);
  const hear = onHearNote ? (midi: number) => onHearNote(midi, instrument.id) : undefined;
  return (
    <div className={`pk-picked pk-picked-${variant}`} data-testid="picked-range">
      {head ? (
        <div className="pk-picked-head">
          <h3 className="pk-picked-name">{name}</h3>
          <span className="pk-picked-level">{copy('setup.difficulty.chip', { level: data.model.level })}</span>
        </div>
      ) : null}
      <RangePicture
        data={data}
        instrumentName={name}
        onHearNote={hear}
        keyboard={variant === 'column'}
        compact={variant === 'panel'}
        notes={variant === 'column'}
        showServed={showServed}
      />
    </div>
  );
}

interface BodyProps extends Omit<InstrumentPickerProps, 'open' | 'layout'> {
  sheet: boolean;
}

/** Holds the pending pick and the pending switch; mounted only while open, so each opening starts fresh. */
function PickerBody({ instruments, value, rangeFor, showLessTested, onDone, onCancel, onHearNote, showServed = true, sheet }: BodyProps) {
  const [pending, setPending] = useState(value);
  const [more, setMore] = useState(showLessTested);
  const selected = instruments.find((i) => i.id === pending) ?? instruments.find((i) => i.id === value) ?? instruments[0];
  const done = (): void => onDone({ instrumentId: selected?.id ?? value, showLessTested: more });
  const grid = (
    <InstrumentGrid
      instruments={instruments}
      value={pending}
      onChange={setPending}
      rangeFor={rangeFor}
      showLessTested={more}
      keep={[value]}
      showServed={showServed}
      layout={sheet ? 'phone' : 'desktop'}
      autoFocus
    />
  );
  const toggle = <Toggle checked={more} label={copy('settings.practice.beta')} onChange={setMore} />;
  const picked = selected ? (
    <PickedRange instrument={selected} data={rangeFor(selected.id)} onHearNote={onHearNote} showServed={showServed} variant={sheet ? 'panel' : 'column'} />
  ) : null;

  if (sheet) return <PickerSheet onCancel={onCancel} onDone={done} grid={grid} toggle={toggle} picked={picked} />;
  return (
    <Modal
      open
      size="picker"
      className="pk-modal"
      title={copy('onboarding.instrument.title')}
      onClose={onCancel}
      footer={
        <>
          <span className="pk-foot-switch">{toggle}</span>
          <Button variant="quiet" label={copy('action.cancel')} onClick={onCancel} />
          <Button variant="primary" label={copy('setup.done')} onClick={done} />
        </>
      }
    >
      <p className="pk-sub">{copy('onboarding.instrument.body')}</p>
      <div className="pk-body">
        <div className="pk-pane">{grid}</div>
        <aside className="pk-column">{picked}</aside>
      </div>
    </Modal>
  );
}

interface SheetProps {
  onCancel: () => void;
  onDone: () => void;
  grid: ReactNode;
  toggle: ReactNode;
  picked: ReactNode;
}

/**
 * Phone layout: a full-height sheet (designer's note 6). Cancel, title and Done in the head; the grid scrolls; the
 * selection's staff, note buttons and legend sit in a panel pinned to the bottom. A swipe down on the grabber or the
 * head, a scrim tap and Escape cancel.
 */
function PickerSheet({ onCancel, onDone, grid, toggle, picked }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const drag = useRef<{ startY: number } | null>(null);
  const [offset, setOffset] = useState(0);
  useOverlay(ref, { open: true, onClose: onCancel, modal: true });

  const onDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = { startY: event.clientY };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers have no capture.
    }
  };
  const onMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (drag.current) setOffset(Math.max(0, event.clientY - drag.current.startY));
  };
  const onUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    drag.current = null;
    setOffset(0);
    if (d && event.clientY - d.startY >= SHEET_SWIPE_DISTANCE) onCancel();
  };
  const handlers = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: () => {
      drag.current = null;
      setOffset(0);
    },
  };
  const style: CSSProperties | undefined = offset > 0 ? { transform: `translateY(${offset}px)`, animation: 'none' } : undefined;

  return createPortal(
    <div className="ui-sheet-layer">
      <div className="ui-scrim" data-testid="sheet-scrim" onClick={onCancel} />
      <div ref={ref} className="ui-sheet ui-sheet-bottom pk-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={style}>
        <div className="ui-sheet-grabber" data-testid="sheet-grabber" aria-hidden="true" {...handlers} />
        <div className="pk-sheet-head" {...handlers}>
          <Button variant="quiet" size="compact" label={copy('action.cancel')} onClick={onCancel} />
          <h2 id={titleId} className="pk-sheet-title">
            {copy('onboarding.instrument.title')}
          </h2>
          <Button variant="primary" size="compact" label={copy('setup.done')} onClick={onDone} />
        </div>
        <div className="pk-sheet-scroll" data-testid="picker-scroll">
          {grid}
          <div className="pk-sheet-switch">{toggle}</div>
        </div>
        <section className="pk-panel" data-testid="picker-panel">
          {picked}
        </section>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The instrument picker as an overlay (05 section 6, 06 sections 6.11 and 10): a 1280 px dialog with the grid on the
 * left and the selection's large range picture in a fixed 440 px right column on desktop; a full-height sheet with a
 * pinned bottom panel on phones. Done applies the pick; Cancel and Escape discard it.
 */
export function InstrumentPicker({ open, layout = 'auto', ...rest }: InstrumentPickerProps) {
  const sheet = useSheetLayout(layout);
  if (!open) return null;
  return <PickerBody {...rest} sheet={sheet} />;
}
