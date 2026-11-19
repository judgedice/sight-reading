import { useEffect, useMemo, useRef, useState } from 'react';
import type { Clef, Configs, Instrument, PracticeSettings } from '../../../core/types.ts';
import { keyboardSpan, pictureNotes, rangeModel, staffPlan } from '../../../instruments/range.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { InstrumentPicker, instrumentIcon, voiceClef, type PickerResult } from '../../../ui/components/picker/index.ts';
import { RangePicture, type RangeData } from '../../../ui/components/range/index.ts';
import { Glyph } from '../../../ui/primitives/Glyph.tsx';
import { Sheet } from '../../../ui/primitives/Sheet.tsx';
import { SetupForm, type SetupRowId, type StampedNote } from './SetupForm.tsx';
import { applySetupChange, effectiveLevel, type FallbackNote, type FallbackRow, type SetupContext } from './model.ts';
import './setup.css';

/** The range picture's data for an instrument at a difficulty (05 section 7, decision 10). */
export function rangeDataFor(cfg: Configs, inst: Instrument, level: number): RangeData {
  const model = rangeModel(cfg, inst, level);
  return { model, staff: staffPlan(inst, pictureNotes(model)), keyboard: keyboardSpan(model, inst) };
}

/** Bravura clefs (SMuFL G, G 8vb, F and C clefs) for an instrument tile. */
const CLEF_GLYPH: Record<Clef, string> = {
  treble: '',
  'treble-8vb': '',
  bass: '',
  alto: '',
  tenor: '',
};

/** The instrument's tile: its clef for voices, its line icon otherwise (06 sections 6.11 and 8). */
export function InstrumentTile({ instrument, small = false }: { instrument: Instrument; small?: boolean }) {
  return (
    <span className={small ? 'setup-tile setup-tile-small' : 'setup-tile'} aria-hidden="true">
      {instrument.family === 'voice' ? (
        <span className="setup-tile-clef">{CLEF_GLYPH[voiceClef(instrument)]}</span>
      ) : (
        <Glyph id={instrumentIcon(instrument.family)} size={small ? 22 : 26} />
      )}
    </span>
  );
}

export interface SetupInstrumentPickerProps {
  open: boolean;
  value: PracticeSettings;
  ctx: SetupContext;
  /** Done: the chosen instrument and the "Show more instruments" switch. */
  onDone: (result: PickerResult) => void;
  onCancel: () => void;
  onHearNote?: ((midi: number) => void) | undefined;
}

/**
 * "Change instrument" (05 section 6.1): the instrument picker as a dialog on desktop and a full-height sheet on
 * phones, each card at the player's current difficulty for that instrument.
 */
export function SetupInstrumentPicker({ open, value, ctx, onDone, onCancel, onHearNote }: SetupInstrumentPickerProps) {
  const { cfg } = ctx;
  // One cache per config: a new config (a new build) draws every card afresh.
  const cache = useMemo(() => ({ cfg, data: new Map<string, RangeData>() }), [cfg]).data;
  const rangeFor = (id: string): RangeData => {
    const inst = cfg.instrumentById[id];
    if (!inst) throw new RangeError(`unknown instrument ${id}`);
    const level = id === value.instrumentId ? effectiveLevel(value, ctx) : Math.min(10, Math.max(1, Math.round(ctx.playerLevel(id))));
    const k = `${id}:${level}`;
    let d = cache.get(k);
    if (!d) {
      d = rangeDataFor(cfg, inst, level);
      cache.set(k, d);
    }
    return d;
  };
  return (
    <InstrumentPicker
      open={open}
      instruments={cfg.instruments.instruments}
      value={value.instrumentId}
      rangeFor={rangeFor}
      showLessTested={ctx.showBeta}
      onDone={onDone}
      onCancel={onCancel}
      onHearNote={onHearNote ? (midi) => onHearNote(midi) : undefined}
    />
  );
}

/** Focus target inside a row: the chosen radio, the stepper, the slider, else the first control. */
function rowFocusTarget(row: HTMLElement): HTMLElement | null {
  const selectors = [
    '[role="radio"][aria-checked="true"]',
    '[role="radio"][tabindex="0"]',
    '.ui-stepper-button:not([aria-disabled="true"])',
    'input[type="range"]',
    'button:not([aria-disabled="true"]), input, [role="switch"], [tabindex="0"]',
  ];
  for (const s of selectors) {
    const el = row.querySelector<HTMLElement>(s);
    if (el) return el;
  }
  return null;
}

/**
 * Scrolls the sheet so the row sits just under its pinned head. Only the sheet scrolls: `scrollIntoView` would also
 * move the page behind it and push the head out of view.
 */
function scrollRowToTop(row: HTMLElement): void {
  const sheet = row.closest<HTMLElement>('.ui-sheet');
  if (!sheet) return;
  const head = sheet.querySelector<HTMLElement>('.ui-sheet-head');
  const headBottom = head ? head.getBoundingClientRect().bottom : sheet.getBoundingClientRect().top;
  const style = getComputedStyle(row);
  // The row's own top padding (above its hairline-free label) is skipped; scroll-margin-top is the gap left under the head.
  const skip = (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.scrollMarginTop) || 0);
  sheet.scrollTop += row.getBoundingClientRect().top + skip - headBottom;
}

export interface SetupSheetProps {
  open: boolean;
  /** Normalized settings. */
  value: PracticeSettings;
  ctx: SetupContext;
  /** Changes apply as they are made (05 section 5.2): normalized next settings and the fallback notes they caused. */
  onChange: (next: PracticeSettings, notes: FallbackNote[]) => void;
  /** Done, Escape, a swipe down and a scrim tap all close the sheet; the changes are already applied. */
  onClose: () => void;
  /** The row the sheet opens at: scrolled to the top with focus on its control. */
  row?: SetupRowId | null | undefined;
  /** "Show more instruments (less tested)" changed in the picker. */
  onShowLessTested?: ((on: boolean) => void) | undefined;
  /** Range note buttons ("Hear C3"): the sounding MIDI note. */
  onHearNote?: ((midi: number) => void) | undefined;
  /** "Hear the tempo". */
  onHearTempo?: ((bpm: number, beatsPerBar: number) => void) | undefined;
  /** Fallback notes to show; the sheet keeps its own when absent. */
  notes?: readonly StampedNote[] | undefined;
  onNoteExpire?: ((row: FallbackRow, stamp: number) => void) | undefined;
  /** Focus goes here when the sheet closes (the chip that opened it). Default: the element focused at open. */
  returnFocus?: (() => HTMLElement | null) | undefined;
}

/**
 * The phone setup sheet (05 section 5.2, 06 section 10, `setup-sheet` mockups): instrument row with "Change
 * instrument", the large range picture, then the same rows as the desktop card in the same order. Opens at a row
 * with focus on its control; closing returns focus to the chip that opened it. Also used over results ("Change
 * setup").
 */
export function SetupSheet({
  open,
  value,
  ctx,
  onChange,
  onClose,
  row,
  onShowLessTested,
  onHearNote,
  onHearTempo,
  notes,
  onNoteExpire,
  returnFocus,
}: SetupSheetProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const inst = ctx.cfg.instrumentById[value.instrumentId];
  const level = effectiveLevel(value, ctx);
  const range = useMemo(() => (inst ? rangeDataFor(ctx.cfg, inst, level) : null), [ctx.cfg, inst, level]);
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    const target = row && body ? body.querySelector<HTMLElement>(`[data-setup-slot="${row}"]`) : null;
    if (!target) return;
    scrollRowToTop(target);
    rowFocusTarget(target)?.focus({ preventScroll: true });
  }, [open, row]);

  useEffect(() => {
    if (!open) return undefined;
    return () => {
      // After the sheet's own focus restore, so the chip wins even when the click did not focus it (Safari).
      const back = returnRef.current?.();
      if (back?.isConnected) setTimeout(() => back.focus(), 0);
    };
  }, [open]);

  if (!inst || !range) return null;
  const name = instrumentName(inst);

  const pick = (r: PickerResult): void => {
    setPicking(false);
    if (r.showLessTested !== ctx.showBeta) onShowLessTested?.(r.showLessTested);
    if (r.instrumentId !== value.instrumentId) {
      const { next, notes: caused } = applySetupChange(value, { instrumentId: r.instrumentId }, ctx);
      onChange(next, caused);
    }
  };

  return (
    <>
      <Sheet open={open} title={copy('action.changeSetup')} onCancel={onClose} onDone={onClose}>
        <div ref={bodyRef} className="setup-sheet" data-testid="setup-sheet">
          <button type="button" className="setup-sheet-inst" onClick={() => setPicking(true)}>
            <InstrumentTile instrument={inst} small />
            <span className="setup-sheet-inst-text">
              <span className="setup-sheet-inst-name">{name}</span>
              <span className="setup-sheet-inst-action">{copy('setup.changeInstrument')}</span>
            </span>
            <Glyph id="chevron-right" size={20} />
          </button>
          <RangePicture className="setup-sheet-range" data={range} instrumentName={name} compact onHearNote={onHearNote} />
          <SetupForm
            className="setup-in-sheet"
            value={value}
            ctx={ctx}
            onChange={onChange}
            notes={notes}
            onNoteExpire={onNoteExpire}
            onHearTempo={onHearTempo}
          />
        </div>
      </Sheet>
      <SetupInstrumentPicker
        open={open && picking}
        value={value}
        ctx={ctx}
        onDone={pick}
        onCancel={() => setPicking(false)}
        onHearNote={onHearNote}
      />
    </>
  );
}
