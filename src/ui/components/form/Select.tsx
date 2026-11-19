import { Glyph } from '../../primitives/Glyph.tsx';
import { cls } from './cls.ts';
import './form.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name (the setup row's label). */
  ariaLabel: string;
  disabled?: boolean;
  /** Id of the visible text that says why the select is disabled (05 section 14: a disabled control names its reason). */
  describedBy?: string;
  className?: string;
}

/** A native select, 40 px fine / 44 px coarse, with a chevron (04 section 7.5). */
export function Select({ options, value, onChange, ariaLabel, disabled = false, describedBy, className }: SelectProps) {
  return (
    <span className="ui-select-wrap">
      <select
        className={cls('ui-select', className)}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        aria-disabled={disabled ? 'true' : undefined}
        aria-describedby={disabled ? describedBy : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled ?? false}>
            {option.label}
          </option>
        ))}
      </select>
      <Glyph id="chevron-down" className="ui-select-chevron" />
    </span>
  );
}
