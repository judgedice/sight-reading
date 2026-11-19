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
  /** The weakest component (04 5.5.3): its bar carries a diagonal hatch, so it is marked by shape and not colour alone. */
  focus?: boolean;
  /** Text shown when value is null. Defaults to the "not enough notes" copy. */
  unavailableText?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

/** Label, 8 px bar, tabular value and a chevron revealing the explainer (04 5.5.3). */
export function ComponentBar({ label, value, explainer, detail, focus = false, unavailableText, expanded, onExpandedChange }: ComponentBarProps) {
  const [inner, setInner] = useState(false);
  const open = expanded ?? inner;
  const panelId = useId();
  const labelId = useId();
  const toggle = (): void => {
    onExpandedChange?.(!open);
    if (expanded === undefined) setInner(!open);
  };
  return (
    <div className="dom-cbar" data-focus={focus ? 'true' : undefined} data-null={value === null ? 'true' : undefined}>
      <button type="button" className="dom-cbar-row" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        <span className="dom-cbar-label" id={labelId}>
          {label}
        </span>
        {value === null ? (
          <span className="dom-cbar-unavailable">{unavailableText ?? copy('component.inTune.notEnough')}</span>
        ) : (
          <>
            <span
              className="dom-cbar-bar"
              role="meter"
              aria-labelledby={labelId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(value)}
            >
              <span className="dom-cbar-fill" data-weakest={focus ? 'true' : undefined} style={{ inlineSize: `${Math.min(100, Math.max(0, value))}%` }} />
            </span>
            <span className="dom-cbar-value">{Math.round(value)}</span>
          </>
        )}
        <Glyph id={open ? 'chevron-down' : 'chevron-right'} size={16} className="dom-cbar-chevron" />
      </button>
      {focus ? <p className="dom-cbar-focus">{copy('component.focus', { component: label })}</p> : null}
      <div className="dom-cbar-panel" id={panelId} hidden={!open}>
        <p className="dom-cbar-explainer">{explainer}</p>
        {detail ? <p className="dom-cbar-detail">{detail}</p> : null}
      </div>
    </div>
  );
}
