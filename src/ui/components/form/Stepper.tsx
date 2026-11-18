import './form.css';

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  /** Values that cannot be chosen. Stepping skips over them. */
  disabledValues?: readonly number[];
  onChange: (value: number) => void;
  /** Accessible name of the group (the setup row's label). */
  ariaLabel: string;
  /** Accessible names of the two buttons. Pass copy strings; the component carries none. */
  decrementLabel: string;
  incrementLabel: string;
  /** Text shown for the value. Defaults to the number itself. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

/** Stepper: minus, value, plus. Buttons are 36 / 44 px square; the value field is 56 px wide (04 section 7.5). */
export function Stepper({
  value,
  min,
  max,
  disabledValues = [],
  onChange,
  ariaLabel,
  decrementLabel,
  incrementLabel,
  formatValue = (n: number) => String(n),
  disabled = false,
}: StepperProps) {
  const blocked = new Set(disabledValues);

  const nextAllowed = (direction: 1 | -1): number | null => {
    for (let candidate = value + direction; candidate >= min && candidate <= max; candidate += direction) {
      if (!blocked.has(candidate)) return candidate;
    }
    return null;
  };

  const down = nextAllowed(-1);
  const up = nextAllowed(1);
  const decrementInert = disabled || down === null;
  const incrementInert = disabled || up === null;

  return (
    <div role="group" aria-label={ariaLabel} className="ui-stepper">
      <button
        type="button"
        className="ui-stepper-button"
        aria-label={decrementLabel}
        aria-disabled={decrementInert ? 'true' : undefined}
        onClick={() => {
          if (!decrementInert && down !== null) onChange(down);
        }}
      >
        <span className="ui-stepper-sign" aria-hidden="true" />
      </button>
      <span className="ui-stepper-value">{formatValue(value)}</span>
      <button
        type="button"
        className="ui-stepper-button"
        aria-label={incrementLabel}
        aria-disabled={incrementInert ? 'true' : undefined}
        onClick={() => {
          if (!incrementInert && up !== null) onChange(up);
        }}
      >
        <span className="ui-stepper-sign ui-stepper-sign-plus" aria-hidden="true" />
      </button>
    </div>
  );
}
