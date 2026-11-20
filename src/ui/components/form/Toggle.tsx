import { Glyph } from '../../primitives/Glyph.tsx';
import './form.css';

export interface ToggleProps {
  checked: boolean;
  /** Visible label; also the switch's accessible name. */
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Id of the visible text that says why the switch is off or what it does. */
  describedBy?: string | undefined;
}

/** An on/off switch: a native checkbox with role="switch". Track 40 x 24, thumb 18, a check on the track when on, 44 px hit row (06 section 6.5). */
export function Toggle({ checked, label, onChange, disabled = false, describedBy }: ToggleProps) {
  return (
    <label className="ui-toggle">
      <input
        type="checkbox"
        role="switch"
        className="ui-form-hidden"
        checked={checked}
        disabled={disabled}
        aria-disabled={disabled ? 'true' : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-toggle-track" aria-hidden="true">
        <Glyph id="check-ui" size={14} className="ui-toggle-check" />
        <span className="ui-toggle-thumb" />
      </span>
      <span className="ui-toggle-label">{label}</span>
    </label>
  );
}
