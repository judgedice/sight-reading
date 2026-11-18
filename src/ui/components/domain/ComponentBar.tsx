import './domain.css';
import { useId, useState, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';

export interface ComponentBarProps {
  label: string;
  /** 0..100, or null when there is nothing to judge (no bar, no number). */
  value: number | null;
  explainer: ReactNode;
  /** The counts behind the value ("6 late, 2 early, typically 40 ms behind"). */
  detail?: ReactNode;
  /** The component that lost the most points (04 5.5.3). */
  focus?: boolean;
  /** Text shown when value is null. Defaults to the "not enough notes" copy. */
  unavailableText?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export const COMPONENT_BAR_SEGMENTS = 10;

/** Filled segments for a value: 86 shows 8, 91 shows 9 (the wireframe in 04 5.5.1). */
export function filledSegments(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(COMPONENT_BAR_SEGMENTS, Math.max(0, Math.floor(value / 10)));
}

/** Label, 10 segments, tabular value and a chevron revealing the explainer (04 5.5.3). */
export function ComponentBar({ label, value, explainer, detail, focus = false, unavailableText, expanded, onExpandedChange }: ComponentBarProps) {
  const [inner, setInner] = useState(false);
  const open = expanded ?? inner;
  const panelId = useId();
  const labelId = useId();
  const toggle = (): void => {
    onExpandedChange?.(!open);
    if (expanded === undefined) setInner(!open);
  };
  const filled = value === null ? 0 : filledSegments(value);
  return (
    <div className="dom-cbar" data-focus={focus ? 'true' : undefined} data-null={value === null ? 'true' : undefined}>
      <button type="button" className="dom-cbar-row" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        <span className="dom-cbar-label" id={labelId}>
          {label}
          {focus ? <span className="dom-cbar-focus">{copy('component.focus')}</span> : null}
        </span>
        {value === null ? (
          <span className="dom-cbar-unavailable">{unavailableText ?? copy('component.inTune.notEnough')}</span>
        ) : (
          <>
            <span
              className="dom-cbar-segments"
              role="meter"
              aria-labelledby={labelId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(value)}
            >
              {Array.from({ length: COMPONENT_BAR_SEGMENTS }, (_, i) => (
                <span key={i} className="dom-cbar-seg" data-filled={i < filled ? 'true' : 'false'} />
              ))}
            </span>
            <span className="dom-cbar-value">{Math.round(value)}</span>
          </>
        )}
        <Glyph id={open ? 'chevron-down' : 'chevron-right'} size={16} className="dom-cbar-chevron" />
      </button>
      <div className="dom-cbar-panel" id={panelId} hidden={!open}>
        <p className="dom-cbar-explainer">{explainer}</p>
        {detail ? <p className="dom-cbar-detail">{detail}</p> : null}
      </div>
    </div>
  );
}
