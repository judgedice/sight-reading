import './form.css';

export interface ToggleProps {
  checked: boolean;
  /** Visible label; also the switch's accessible name. */
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** An on/off switch: a native checkbox with role="switch". Track 36 x 20, thumb 16, 44 px hit row (04 section 7.5). */
export function Toggle({ checked, label, onChange, disabled = false }: ToggleProps) {
  return (
    <label className="ui-toggle">
      <input
        type="checkbox"
        role="switch"
        className="ui-form-hidden"
        checked={checked}
        disabled={disabled}
        aria-disabled={disabled ? 'true' : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-toggle-track" aria-hidden="true">
        <span className="ui-toggle-thumb" />
      </span>
      <span className="ui-toggle-label">{label}</span>
    </label>
  );
}
