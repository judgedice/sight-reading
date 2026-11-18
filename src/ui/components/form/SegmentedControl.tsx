import { Fragment, useId } from 'react';
import { cls } from './cls.ts';
import './form.css';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shown on hover and read as the segment's description (for example why a meter is unavailable). */
  tooltip?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group (the setup row's label). */
  ariaLabel: string;
}

/**
 * A single-choice segmented control. Each segment is a native radio, so arrow keys move the
 * selection and Tab enters the group on the selected segment (04 section 7.5, 8.3).
 */
export function SegmentedControl<T extends string = string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  const groupName = useId();

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="ui-segmented">
      {options.map((option, index) => {
        const checked = option.value === value;
        const tipId = option.tooltip ? `${groupName}-tip-${index}` : undefined;
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
                aria-describedby={tipId}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
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
