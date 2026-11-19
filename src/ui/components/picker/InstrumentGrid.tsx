import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { Instrument } from '../../../core/types.ts';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import type { RangeData } from '../range/types.ts';
import { InstrumentCard } from './InstrumentCard.tsx';
import { pickerGroups, readingOrder, type PickerGroup, type PickerGroupId } from './groups.ts';
import './picker.css';

const GROUP_TITLE: Record<PickerGroupId, () => string> = {
  voice: () => copy('onboarding.family.voice'),
  woodwinds: () => copy('onboarding.family.woodwinds'),
  brass: () => copy('onboarding.family.brass'),
  strings: () => copy('onboarding.family.strings'),
  keyboard: () => copy('onboarding.family.keyboard'),
};

export interface InstrumentGridProps {
  /** Every instrument in config order (`cfg.instruments.instruments`). */
  instruments: readonly Instrument[];
  /** The selected card, or null when nothing is picked yet (onboarding). */
  value: string | null;
  onChange: (id: string) => void;
  rangeFor: (id: string) => RangeData;
  showLessTested: boolean;
  /** Less-tested ids kept visible while the switch is off (the current choice). */
  keep?: readonly string[];
  /** Hide served shading while the eligible-count index loads (05 section 8.2). */
  showServed?: boolean;
  /** `phone` lays the non-voice groups out one card a row with the bar on the right (06 section 6.11). */
  layout: 'desktop' | 'phone';
  /** Marks the selected card (else the first) with `data-autofocus` for the dialog's initial focus. */
  autoFocus?: boolean;
}

/** Span of a group in the 4-column desktop flow: its card count, at most 4 (Woodwinds 3 plus Brass 1). */
const flowSpan = (g: PickerGroup): number => Math.min(4, g.instruments.length);

/**
 * The picker grid (05 section 6.2 to 6.3, 06 section 6.11): the axis line, then the groups, all cards forming one
 * radio group across groups. One Tab stop; arrow keys move and select in reading order across groups and wrap;
 * Home and End jump to the first and last card; Space and Enter select.
 */
export function InstrumentGrid({
  instruments,
  value,
  onChange,
  rangeFor,
  showLessTested,
  keep,
  showServed = true,
  layout,
  autoFocus = false,
}: InstrumentGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const groups = pickerGroups(instruments, { showLessTested, keep: [...(keep ?? []), ...(value ? [value] : [])] });
  const order = readingOrder(groups);
  const tabStop = value !== null && order.includes(value) ? value : order[0];

  const move = (from: string, to: string | undefined): void => {
    if (!to || to === from) return;
    onChange(to);
    rootRef.current?.querySelector<HTMLElement>(`[data-instrument="${to}"]`)?.focus();
  };

  const onKeyDown = (id: string) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    const i = order.indexOf(id);
    const n = order.length;
    let target: string | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = order[(i + 1) % n];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = order[(i - 1 + n) % n];
        break;
      case 'Home':
        target = order[0];
        break;
      case 'End':
        target = order[n - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    move(id, target);
  };

  const voiceGroup = groups.find((g) => g.id === 'voice');
  const others = groups.filter((g) => g.id !== 'voice');

  const renderGroup = (g: PickerGroup, gridClass: string) => {
    const headingId = `${uid}-${g.id}`;
    const spanStyle = { '--pk-span': flowSpan(g) } as CSSProperties;
    return (
      <section key={g.id} className="pk-group" role="group" aria-labelledby={headingId} style={spanStyle}>
        <h3 id={headingId} className="pk-group-title">
          {GROUP_TITLE[g.id]()}
        </h3>
        <div className={`pk-cards ${gridClass}`}>
          {g.instruments.map((inst) => (
            <InstrumentCard
              key={inst.id}
              instrument={inst}
              data={rangeFor(inst.id)}
              checked={inst.id === value}
              tabbable={inst.id === tabStop}
              showServed={showServed}
              onSelect={onChange}
              onKeyDown={onKeyDown(inst.id)}
              autoFocus={autoFocus && inst.id === tabStop}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div ref={rootRef} className={`pk-grid pk-grid-${layout}`}>
      <p className="pk-axis">
        <Glyph id="info" size={16} className="pk-axis-icon" />
        <span>{copy('picker.axis')}</span>
      </p>
      <div role="radiogroup" aria-label={copy('onboarding.instrument.title')} className="pk-radiogroup">
        {voiceGroup ? renderGroup(voiceGroup, 'pk-cards-voices') : null}
        <div className="pk-flow">{others.map((g) => renderGroup(g, layout === 'desktop' ? 'pk-cards-flow' : 'pk-cards-list'))}</div>
      </div>
    </div>
  );
}
