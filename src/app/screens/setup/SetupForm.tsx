import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PracticeSettings } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import {
  DifficultyControl,
  FallbackNote,
  KeyGrid,
  LengthInline,
  LengthRow,
  TempoRow,
  TimeSegments,
} from '../../../ui/components/setup/index.ts';
import { firstClef } from '../../../instruments/range.ts';
import {
  applySetupChange,
  isCompoundMeter,
  setupModel,
  type FallbackNote as FallbackNoteModel,
  type FallbackRow,
  type SetupContext,
} from './model.ts';
import './setup.css';

/** The rows of the setup, in order (05 section 5.2). Mode is not one of them: it sits in the foot or under the summary. */
export type SetupRowId = 'difficulty' | 'key' | 'time' | 'tempo' | 'length';
export const SETUP_ROWS: readonly SetupRowId[] = ['difficulty', 'key', 'time', 'tempo', 'length'];

/** A fallback note with the change that caused it, so the same note caused twice shows (and is announced) afresh. */
export interface StampedNote extends FallbackNoteModel {
  stamp: number;
}

let stampCounter = 0;
/** Stamps fallback notes from `applySetupChange`. */
export const stampNotes = (notes: readonly FallbackNoteModel[]): StampedNote[] => notes.map((n) => ({ ...n, stamp: ++stampCounter }));

/** Holds the fallback notes of one screen: each row keeps its latest note until it expires (05 section 5.9). */
export function useFallbackNotes(): {
  notes: readonly StampedNote[];
  push: (notes: readonly FallbackNoteModel[]) => void;
  expire: (row: FallbackRow, stamp: number) => void;
} {
  const [notes, setNotes] = useState<readonly StampedNote[]>([]);
  const push = useCallback((next: readonly FallbackNoteModel[]) => {
    if (next.length === 0) return;
    const stamped = stampNotes(next);
    setNotes((cur) => [...cur.filter((n) => !stamped.some((s) => s.row === n.row)), ...stamped]);
  }, []);
  const expire = useCallback((row: FallbackRow, stamp: number) => {
    setNotes((cur) => cur.filter((n) => !(n.row === row && n.stamp === stamp)));
  }, []);
  return { notes, push, expire };
}

export interface SetupFormProps {
  /** Normalized settings. */
  value: PracticeSettings;
  /** Called with the normalized next settings and the fallback notes the change caused. */
  onChange: (next: PracticeSettings, notes: FallbackNoteModel[]) => void;
  ctx: SetupContext;
  /** Fallback notes to show. When absent the form keeps its own. */
  notes?: readonly StampedNote[] | undefined;
  /** Called when a shown note's six seconds are over (only with `notes`). */
  onNoteExpire?: ((row: FallbackRow, stamp: number) => void) | undefined;
  /** "Hear the tempo": one bar at `bpm` with `beatsPerBar` beats (05 section 9.5). Hidden when absent. */
  onHearTempo?: ((bpm: number, beatsPerBar: number) => void) | undefined;
  /**
   * `form` (Practice, desktop): a label column, keys and meters folded behind a button above eight and seven, Length
   * beside Tempo when only one length exists. `sheet` (the phone sheet): every option in place, each row its own.
   */
  layout?: 'form' | 'sheet';
  /** Opens "Match a note": difficulty 1 shows "Simpler? Match a note first." (round 2, 01-ux section 3.3). */
  onMatch?: (() => void) | undefined;
  className?: string | undefined;
}

/** Beats in a bar at the tempo's beat unit: compound meters count dotted beats (6/8 is 2). */
export function beatsPerBar(meter: string | 'random'): number {
  if (meter === 'random') return 4;
  const beats = Number(meter.split('/')[0]);
  if (!Number.isFinite(beats) || beats <= 0) return 4;
  return isCompoundMeter(meter) ? Math.max(1, Math.round(beats / 3)) : beats;
}

function RowSlot({ id, children }: { id: SetupRowId; children: ReactNode }) {
  return (
    <div className="setup-slot" data-setup-slot={id}>
      {children}
    </div>
  );
}

/**
 * The setup rows (05 sections 5.3 to 5.7): Difficulty, Key, Time, Tempo and Length, built from the shared setup
 * controls and the setup model. Every change goes through `applySetupChange`, so a new difficulty or instrument
 * re-filters the other rows and the rows that fell back to Any say so for six seconds, announced politely once.
 * Used by the Practice screen's setup card and by `SetupSheet`.
 */
export function SetupForm({ value, onChange, ctx, notes, onNoteExpire, onHearTempo, layout = 'sheet', onMatch, className }: SetupFormProps) {
  const own = useFallbackNotes();
  const shown = notes ?? own.notes;
  const expire = notes ? onNoteExpire : own.expire;
  const model = useMemo(() => setupModel(value, ctx), [value, ctx]);
  const clef = firstClef(model.instrument);
  const liveId = useId();
  const [announced, setAnnounced] = useState('');
  const lastAnnounced = useRef('');

  const apply = (patch: Partial<PracticeSettings>): void => {
    const { next, notes: caused } = applySetupChange(value, patch, ctx);
    if (!notes) own.push(caused);
    onChange(next, caused);
  };

  const batch = useRef<string[] | null>(null);
  const announce = useCallback((text: string) => {
    // Notes caused by one change are announced together, in row order.
    if (batch.current) {
      batch.current.push(text);
      return;
    }
    batch.current = [text];
    queueMicrotask(() => {
      const joined = (batch.current ?? []).join(' ');
      batch.current = null;
      // Re-announce the same text by toggling a trailing space (live regions ignore unchanged text).
      const next = lastAnnounced.current === joined ? `${joined} ` : joined;
      lastAnnounced.current = next;
      setAnnounced(next);
    });
  }, []);

  const fallback = (row: FallbackRow): ReactNode => {
    const n = shown.find((x) => x.row === row);
    return (
      <FallbackNote
        note={n ? n.note : null}
        announce={announce}
        {...(n ? { stamp: n.stamp } : {})}
        {...(n && expire ? { onExpire: () => expire(row, n.stamp) } : {})}
      />
    );
  };

  const expanded = layout === 'sheet';
  // On the form, a single length is plain text at the right of the Tempo row (04-design section 1).
  const lengthInline = !expanded && model.length.kind === 'only' ? model.length.bars : null;

  return (
    <div className={['setup', `setup-${layout}`, className].filter(Boolean).join(' ')} data-testid="setup-form">
      <RowSlot id="difficulty">
        <DifficultyControl row={model.difficulty} fallback={fallback('difficulty')} onChange={(level) => apply({ level })} onMatch={onMatch} />
      </RowSlot>
      <RowSlot id="key">
        <KeyGrid
          row={model.key}
          clef={clef}
          difficulty={model.level}
          expanded={expanded}
          fallback={fallback('key')}
          onChange={(writtenKey) => apply({ writtenKey })}
        />
      </RowSlot>
      <RowSlot id="time">
        <TimeSegments row={model.time} expanded={expanded} fallback={fallback('time')} onChange={(meter) => apply({ meter })} />
      </RowSlot>
      <RowSlot id="tempo">
        <TempoRow
          row={model.tempo}
          value={value.bpm}
          onChange={(bpm) => apply({ bpm })}
          end={lengthInline === null ? undefined : <LengthInline bars={lengthInline} />}
          {...(onHearTempo ? { onHearTempo: (bpm: number) => onHearTempo(bpm, beatsPerBar(value.meter)) } : {})}
        />
      </RowSlot>
      {lengthInline === null ? (
        <RowSlot id="length">
          <LengthRow row={model.length} fallback={fallback('length')} onChange={(bars) => apply({ bars })} />
        </RowSlot>
      ) : (
        fallback('length')
      )}
      <p id={liveId} className="setup-live" role="status" aria-live="polite">
        {announced}
      </p>
    </div>
  );
}

/** The text a row's summary chip shows ("G major", "Any key", "♩ = 72"), from the same model the rows use. */
export function rowValueText(row: SetupRowId, value: PracticeSettings, ctx: SetupContext): string {
  const model = setupModel(value, ctx);
  switch (row) {
    case 'difficulty':
      return String(model.level);
    case 'key': {
      if (value.writtenKey === 'random') return copy('setup.time.any');
      const k = value.writtenKey;
      const opt = model.key.groups.flatMap((g) => g.keys).find((o) => o.key.fifths === k.fifths && o.key.mode === k.mode);
      return opt?.name ?? copy('setup.time.any');
    }
    case 'time':
      return value.meter === 'random' ? copy('setup.time.any') : value.meter;
    case 'tempo':
      return value.bpm === 'random' ? copy('setup.time.any') : copy('tempo.marking', { unit: model.tempo.beatUnit, bpm: value.bpm });
    case 'length':
      return model.length.kind === 'only'
        ? copy('setup.length.chip', { bars: model.length.bars })
        : value.bars === 'random'
          ? copy('setup.length.any')
          : copy('setup.length.chip', { bars: value.bars });
  }
}
