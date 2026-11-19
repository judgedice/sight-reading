import { Fragment, useId } from 'react';
import { cls } from './cls.ts';
import { radioGroupHomeEnd } from './radio-keys.ts';
import './form.css';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Second line under the label, for example "+8% XP" or "few pieces". Read as the description. */
  caption?: string;
  /** Shown on hover and read as the segment's description (for example why a meter is unavailable). */
  tooltip?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group (the setup row's label). */
  ariaLabel: string;
  /** Fill the row: segments share the width equally (Mode). */
  stretch?: boolean;
}

/**
 * A single-choice segmented control. Each segment is a native radio, so arrow keys move the
 * selection, Home and End jump to the first and last, and Tab enters the group on the selected segment (04 section 7.5, 8.3;
 * 05 section 14 item 3).
 */
export function SegmentedControl<T extends string = string>({ options, value, onChange, ariaLabel, stretch = false }: SegmentedControlProps<T>) {
  const groupName = useId();

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cls('ui-segmented', stretch && 'ui-segmented-stretch')} onKeyDown={radioGroupHomeEnd}>
      {options.map((option, index) => {
        const checked = option.value === value;
        const tipId = option.tooltip ? `${groupName}-tip-${index}` : undefined;
        const capId = option.caption ? `${groupName}-cap-${index}` : undefined;
        const describedBy = [capId, tipId].filter(Boolean).join(' ') || undefined;
        return (
          <Fragment key={option.value}>
            <label
              className={cls('ui-segment', checked && 'ui-segment-selected', option.disabled && 'ui-segment-disabled')}
              title={option.tooltip}
            >
              <input
                type="radio"
                className="ui-form-hidden"
                name={groupName}
                value={option.value}
                checked={checked}
                disabled={option.disabled ?? false}
                aria-disabled={option.disabled ? 'true' : undefined}
                aria-describedby={describedBy}
                onChange={() => onChange(option.value)}
              />
              <span className="ui-segment-label">{option.label}</span>
              {option.caption ? (
                <span id={capId} className="ui-segment-caption" aria-hidden="true">
                  {option.caption}
                </span>
              ) : null}
            </label>
            {tipId && option.tooltip ? (
              <span id={tipId} className="ui-form-hidden">
                {option.tooltip}
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
