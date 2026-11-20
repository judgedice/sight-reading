import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { KeyboardStrip } from './KeyboardStrip.tsx';
import { formatRangeText, splitRangeText } from './range-text.ts';
import { RangeStaff, S, slotCentre, WIDTH_SPACES } from './RangeStaff.tsx';
import { RulerBar } from './RulerBar.tsx';
import type { RangeData, RangeTextView } from './types.ts';
import './range.css';

export type RangePictureSize = 'bar' | 'picture' | 'line';

export interface RangePictureProps {
  data: RangeData;
  /** Full player-facing name ("Baritone voice"), for the accessible description. */
  instrumentName: string;
  /** `bar`: the ruler; `picture`: staff, note buttons, keyboard and legend; `line`: "At difficulty 2: C3 to C4". */
  size?: RangePictureSize;
  /** Plays a note at its sounding MIDI pitch (the Listen tone, 1 s). Without it the note names are plain text. */
  onHearNote?: ((midi: number) => void) | undefined;
  /** Picture only: draw the keyboard strip (the phone picker panel leaves it out, designer's note 6). */
  keyboard?: boolean;
  /** Picture only: phone sizes (34 px keys, 13 px legend). */
  compact?: boolean;
  /** Picture only: the transposition or voice line under the legend (the phone picker panel leaves it out). */
  notes?: boolean;
  /** Hide the served range while it is not known yet (05 section 8.2). */
  showServed?: boolean;
  /** Bar only: fixed width in px. */
  barWidth?: number | undefined;
  /** Picture only: the note slot (0 to 3, low to high) that sounds now. Its chip, notehead and key are brass. */
  soundingSlot?: number | null;
  className?: string | undefined;
}

/** Semitones the written part sits above the sound (0 for concert-pitch instruments). */
function chromaticOf(data: RangeData): number {
  return data.model.written.full[0] - data.model.concert.full[0];
}

function LegendLine({ line, swatch }: { line: RangeTextView; swatch: 'full' | 'served' }) {
  const { lead, value } = splitRangeText(line);
  return (
    <div className="rp-legend-line">
      <span className={`rp-swatch rp-swatch-${swatch}`} />
      <span>
        {lead}
        <b>{value}</b>
      </span>
    </div>
  );
}

/**
 * One range picture in three sizes (05 section 7, 06 section 6.10). The picture is a `figure` whose `figcaption`
 * holds `range.a11y` for screen readers and the visible legend; the staff and keyboard are `aria-hidden` and each
 * whole note has a real "Hear C3" button that plays its sounding pitch.
 */
export function RangePicture({
  data,
  instrumentName,
  size = 'picture',
  onHearNote,
  keyboard = true,
  compact = false,
  notes = true,
  showServed = true,
  barWidth,
  soundingSlot = null,
  className,
}: RangePictureProps) {
  const { model, staff } = data;
  if (size === 'bar') {
    return <RulerBar full={model.concert.full} served={showServed ? model.concert.served : undefined} width={barWidth} className={className} />;
  }
  if (size === 'line') {
    return (
      <span className={['rp-line', className].filter(Boolean).join(' ')} data-testid="range-line">
        {formatRangeText(model.servedLine)}
      </span>
    );
  }

  const chromatic = chromaticOf(data);
  const [fullLine, servedLine, ...more] = model.lines;
  // While the served range is unknown only the full range is stated (05 section 8.2).
  const a11y = showServed || !fullLine ? formatRangeText(model.a11y, { instrument: instrumentName }) : formatRangeText(fullLine);
  const classes = ['rp-figure', compact ? 'rp-compact' : null, className].filter(Boolean).join(' ');
  return (
    <figure className={classes} data-testid="range-picture">
      <div className="rp-stage">
        <RangeStaff staff={staff} showServed={showServed} lit={soundingSlot} />
        <div className="rp-notes">
          {staff.notes.map((n, slot) => {
            const served = slot === 1 || slot === 2;
            if (served && !showServed) return null;
            const left = `${Math.round((slotCentre(slot) / (WIDTH_SPACES * S)) * 10000) / 100}%`;
            const lit = soundingSlot === slot;
            const cls = [served ? 'rp-note-pill rp-note-pill-served' : 'rp-note-pill rp-note-pill-full', lit ? 'rp-note-pill-lit' : null].filter(Boolean).join(' ');
            const content = (
              <>
                <Glyph id={lit ? 'speaker' : 'play'} size={12} className="rp-note-pill-icon" />
                {n.label}
              </>
            );
            return onHearNote ? (
              <button
                key={slot}
                type="button"
                className={cls}
                style={{ left }}
                aria-label={copy('range.hearNote', { note: n.label })}
                onClick={() => onHearNote(n.midi - chromatic)}
                data-testid={`hear-note-${slot}`}
                data-sounding={lit ? 'true' : undefined}
              >
                {content}
              </button>
            ) : (
              <span key={slot} className={`${cls} rp-note-pill-static`} style={{ left }} aria-hidden="true" data-sounding={lit ? 'true' : undefined}>
                {n.label}
              </span>
            );
          })}
        </div>
      </div>
      {keyboard ? <KeyboardStrip
          keyboard={data.keyboard}
          showServed={showServed}
          compact={compact}
          litMidi={soundingSlot !== null && staff.notes[soundingSlot] ? staff.notes[soundingSlot].midi - chromatic : null}
        /> : null}
      <figcaption className="rp-legend">
        <span className="rp-visually-hidden" data-testid="range-a11y">
          {a11y}
        </span>
        <div aria-hidden="true" className="rp-legend-swatches">
          {fullLine ? <LegendLine line={fullLine} swatch="full" /> : null}
          {servedLine && showServed ? <LegendLine line={servedLine} swatch="served" /> : null}
        </div>
        {(notes ? more : []).map((line) => (
          <p key={line.key} className="rp-legend-note">
            {formatRangeText(line)}
          </p>
        ))}
      </figcaption>
    </figure>
  );
}
