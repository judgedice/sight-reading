import { copy } from '../../copy/copy.ts';
import './form.css';

export interface RandomChipProps {
  /** Whether Random is on for this row. Exposed as aria-pressed. */
  pressed: boolean;
  onToggle: (pressed: boolean) => void;
  /** Defaults to the "Random" chip copy. Describe the chip by its row (fieldset legend). */
  label?: string;
}

/** A toggle chip for "Random" (04 section 7.5). 32 px visual on fine pointers, 44 px hit on coarse. */
export function RandomChip({ pressed, onToggle, label = copy('chip.random') }: RandomChipProps) {
  return (
    <button
      type="button"
      className="ui-random-chip"
      aria-pressed={pressed ? 'true' : 'false'}
      onClick={() => onToggle(!pressed)}
    >
      {label}
    </button>
  );
}
