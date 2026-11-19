import type { ReactNode } from 'react';
import { Glyph } from '../../primitives/Glyph.tsx';
import type { GlyphId } from '../../glyph-ids.ts';
import './sounds.css';

export interface SoundButtonProps {
  icon: GlyphId;
  /** The full name. On the dock it is the accessible name while `shortLabel` is what shows. */
  label: string;
  /** Dock only: the short visible label. */
  shortLabel?: string;
  /** Always-visible caption (desktop), or the dock's second line ("Makes this practice"). */
  caption?: ReactNode;
  /** The brass playing state: a brass edge, a brass wash tile. */
  playing?: boolean;
  /** 40% and `aria-disabled`; the button stays focusable and ignores a press (06 section 6.1). */
  disabled?: boolean;
  /** `row` is the desktop card row; `dock` is the phone button with the icon over its label. */
  variant?: 'row' | 'dock';
  /** The info button for this sound (desktop row only). It sits beside the button, never inside it. */
  info?: ReactNode;
  onPress: () => void;
  /** Identifies the sound for tests and screens. */
  soundId?: string;
}

/**
 * One sound (06 section 6.8): a 44 px icon tile, the label and the caption, in a row or as a dock button.
 * Playing shows a 1 px plus 1 px inset brass edge and a brass-wash tile with a brass-ink icon.
 */
export function SoundButton({ icon, label, shortLabel, caption, playing = false, disabled = false, variant = 'row', info, onPress, soundId }: SoundButtonProps) {
  const press = (): void => {
    if (!disabled) onPress();
  };
  if (variant === 'dock') {
    return (
      <button
        type="button"
        className="sd-dock-button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-playing={playing ? 'true' : undefined}
        data-sound={soundId}
        onClick={press}
      >
        <span className="sd-dock-icon">
          <Glyph id={icon} size={22} />
        </span>
        <span className="sd-dock-label" aria-hidden="true">
          {shortLabel ?? label}
        </span>
        {caption ? (
          <small className="sd-dock-sub" aria-hidden="true">
            {caption}
          </small>
        ) : null}
      </button>
    );
  }
  return (
    <div className="sd-sound" data-playing={playing ? 'true' : undefined} data-has-info={info ? 'true' : undefined} data-sound={soundId}>
      <button type="button" className="sd-sound-main" aria-disabled={disabled || undefined} onClick={press}>
        <span className="sd-sound-tile">
          <Glyph id={icon} size={22} />
        </span>
        <span className="sd-sound-label">{label}</span>
        {caption ? <span className="sd-sound-caption">{caption}</span> : null}
      </button>
      {info ? <span className="sd-sound-info">{info}</span> : null}
    </div>
  );
}
