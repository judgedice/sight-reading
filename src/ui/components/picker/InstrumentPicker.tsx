import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Instrument } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { instrumentName, instrumentShortName } from '../../copy/instrument-names.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
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

/**
 * "Play my range" as the picker sees it (round 2, 01-ux section 2). A snapshot plus three calls, so the app can hand
 * over its session and the component stays free of services.
 */
export interface PickerSoundView {
  /** Plays the concert MIDI notes in order, in the instrument's own sound. Rejects when the sound cannot start. */
  play(instrumentId: string, midis: readonly number[]): Promise<void>;
  /** Ends whatever sounds at once. */
  stop(): void;
  /** Hover or focus: start loading the instrument's samples. Never plays. */
  prepare(instrumentId: string): void;
  /** The instrument whose range sounds now, or null. */
  playing: string | null;
  /** Index in the played list of the note that sounds now. */
  index: number | null;
  /** The sound did not start. */
  failed: boolean;
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
  /** "Play my range" and the state it shows. Without it the picker has no Play button. */
  sound?: PickerSoundView | undefined;
  /** The instrument whose samples stand in for this one (euphonium: trombone), or null when it has its own. */
  standInFor?: ((instrumentId: string) => string | null) | undefined;
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
  /** "Play my range", the playing state and the sound lines. Absent: the picture alone. */
  sound?: PickerSoundView | undefined;
  /** The instrument whose samples stand in for this one, or null. */
  standIn?: Instrument | null | undefined;
  showServed?: boolean;
  /** `column`: the dialog's right column with the keyboard; `panel`: the phone's pinned panel without it. */
  variant: 'column' | 'panel';
  /**
   * The name and "Difficulty N" above the picture. Off where the screen already says both (the onboarding difficulty
   * step, whose stepper sits right above).
   */
  head?: boolean;
}

/** "Euphonium (bass clef)" and "Clarinet in B♭" read as "euphonium" and "clarinet" inside a sentence. */
function plainName(instrument: Instrument): string {
  const name = instrument.family === 'voice' ? instrumentShortName(instrument) : instrumentName(instrument);
  const base = name.replace(/\s*\(.*\)\s*$/, '').replace(/\s+in\s+.*$/i, '');
  return base.charAt(0).toLowerCase() + base.slice(1);
}

/** The first sentence of a line in bold ("This is how it will sound."), the rest plain. */
function LeadLine({ text }: { text: string }) {
  const m = /^(.+?[.:])(\s.*)$/.exec(text);
  return m ? (
    <>
      <b>{m[1]}</b>
      {m[2]}
    </>
  ) : (
    <>{text}</>
  );
}

/** The notes "Play my range" plays, low to high, as staff slots: the served pair drops out while it is unknown. */
function rangeSlots(data: RangeData, showServed: boolean): number[] {
  return data.staff.notes.map((_, slot) => slot).filter((slot) => showServed || (slot !== 1 && slot !== 2));
}

/** The selection's name, its difficulty, Play my range, and the large range picture (05 section 6.4, designer's note 6). */
export function PickedRange({ instrument, data, onHearNote, sound, standIn = null, showServed = true, variant, head = true }: PickedRangeProps) {
  const name = instrumentName(instrument);
  const slots = rangeSlots(data, showServed);
  const chromatic = data.model.written.full[0] - data.model.concert.full[0];
  const [failedHere, setFailedHere] = useState(false);
  // Something may sound that this component started; leaving the card or the picker must end it (stop is idempotent).
  const started = useRef(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    setFailedHere(false);
    soundRef.current?.prepare(instrument.id);
    return () => {
      if (started.current) soundRef.current?.stop();
      started.current = false;
    };
  }, [instrument.id]);

  const playing = sound?.playing === instrument.id;
  const slot = playing && sound?.index !== null && sound?.index !== undefined ? (slots[sound.index] ?? null) : null;
  const lit = slot !== null ? data.staff.notes[slot] : null;

  const hear = onHearNote
    ? (midi: number) => {
        started.current = true;
        setFailedHere(false);
        onHearNote(midi, instrument.id);
      }
    : undefined;

  const press = (): void => {
    if (!sound) return;
    if (playing) {
      started.current = false;
      sound.stop();
      return;
    }
    started.current = true;
    setFailedHere(false);
    const midis = slots.map((i) => (data.staff.notes[i]?.midi ?? 0) - chromatic);
    sound.play(instrument.id, midis).catch(() => setFailedHere(true));
  };

  const voice = instrument.family === 'voice';
  const failed = failedHere || (sound?.failed === true && !playing);
  const column = variant === 'column';
  const stepDots = playing && sound?.index !== null && sound?.index !== undefined ? (
    <span className="pk-steps" aria-hidden="true" data-testid="play-steps">
      {slots.map((_, i) => (
        <i key={i} className={i === sound.index ? 'is-now' : i < (sound.index ?? 0) ? 'is-done' : undefined} />
      ))}
    </span>
  ) : null;
  const now = (
    <span className="pk-now" role="status" data-testid="play-now">
      {lit ? (
        <>
          <Glyph id="listen" size={16} className="pk-now-icon" />
          <span>{copy('picker.play.now', { note: lit.label })}</span>
          {stepDots}
        </>
      ) : null}
    </span>
  );
  const playButton = sound ? (
    <button
      type="button"
      className={playing ? 'pk-play pk-play-stop' : 'pk-play'}
      onClick={press}
      onPointerEnter={() => sound.prepare(instrument.id)}
      onFocus={() => sound.prepare(instrument.id)}
      data-testid="play-range"
    >
      <Glyph id={playing ? 'stop' : 'play'} size={16} className="pk-play-icon" />
      <span>{playing ? copy('picker.play.stop') : copy('picker.play.range')}</span>
    </button>
  ) : null;

  return (
    <div className={`pk-picked pk-picked-${variant}`} data-testid="picked-range">
      {head ? (
        <div className="pk-picked-head">
          {column ? <p className="pk-picked-eyebrow">{copy('picker.selected')}</p> : null}
          <h3 className="pk-picked-name">{name}</h3>
          <span className="pk-picked-level">{copy('setup.difficulty.chip', { level: data.model.level })}</span>
          {!column ? playButton : null}
        </div>
      ) : !column ? (
        playButton
      ) : null}
      {sound ? (
        <div className="pk-play-row">
          {column ? playButton : null}
          {now}
          {column && !playing ? <span className="pk-play-or">{copy('picker.play.or')}</span> : null}
        </div>
      ) : null}
      {sound && column ? <p className="pk-play-caption">{copy('picker.play.caption', { level: data.model.level })}</p> : null}
      {sound && standIn ? (
        <p className="pk-line pk-line-info" data-testid="stand-in-line">
          <Glyph id="info" size={16} className="pk-line-icon" />
          <span>{copy('picker.play.fallback', { instrument: plainName(instrument), standIn: plainName(standIn) })}</span>
        </p>
      ) : null}
      {sound && failed ? (
        <p className="pk-line pk-line-caution" role="alert" data-testid="play-failed">
          <Glyph id="caution" size={16} className="pk-line-icon" />
          <span>{copy('picker.play.failed')}</span>
        </p>
      ) : null}
      <RangePicture
        data={data}
        instrumentName={name}
        onHearNote={hear}
        keyboard={column}
        compact={!column}
        notes={column}
        showServed={showServed}
        soundingSlot={slot}
      />
      {sound && !standIn ? (
        <p className="pk-line pk-line-sound" data-testid="sound-line">
          <Glyph id="speaker" size={16} className="pk-line-icon" />
          <span>
            <LeadLine
              text={
                voice
                  ? copy(column ? 'picker.sound.line' : 'picker.sound.line.short', { voice: plainName(instrument) })
                  : copy('picker.sound.instrument', { instrument: plainName(instrument) })
              }
            />
          </span>
        </p>
      ) : null}
    </div>
  );
}

interface BodyProps extends Omit<InstrumentPickerProps, 'open' | 'layout'> {
  sheet: boolean;
}

/** Holds the pending pick and the pending switch; mounted only while open, so each opening starts fresh. */
function PickerBody({ instruments, value, rangeFor, showLessTested, onDone, onCancel, onHearNote, sound, standInFor, showServed = true, sheet }: BodyProps) {
  const [pending, setPending] = useState(value);
  const [more, setMore] = useState(showLessTested);
  const selected = instruments.find((i) => i.id === pending) ?? instruments.find((i) => i.id === value) ?? instruments[0];
  const standInOf = (id: string): Instrument | null => {
    const other = standInFor?.(id);
    return other ? (instruments.find((i) => i.id === other) ?? null) : null;
  };
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
      onPrepare={sound?.prepare}
    />
  );
  const toggle = <Toggle checked={more} label={copy('settings.practice.beta')} onChange={setMore} />;
  const picked = selected ? (
    <PickedRange
      instrument={selected}
      data={rangeFor(selected.id)}
      onHearNote={onHearNote}
      sound={sound}
      standIn={standInOf(selected.id)}
      showServed={showServed}
      variant={sheet ? 'panel' : 'column'}
    />
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
      <p className="pk-sub">{copy('picker.lead')}</p>
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
