import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import type { GlyphId } from '../../glyph-ids.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { cls } from './cls.ts';
import './form.css';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'compact' | 'default' | 'hero';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  /** Visible text and accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: GlyphId;
  /** Shows a spinner in place of the icon and ignores activation. The label stays visible. */
  loading?: boolean;
  /**
   * Visually 40% opacity with `aria-disabled`. The button stays focusable so keyboard focus is not
   * lost; activation is ignored.
   */
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

/** Button primary, secondary, tertiary and danger in compact, default and hero sizes (04 section 7.5). */
export function Button({
  label,
  variant = 'secondary',
  size = 'default',
  icon,
  loading = false,
  disabled = false,
  type = 'button',
  className,
  onClick,
  ...rest
}: ButtonProps) {
  const inert = disabled || loading;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={cls('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}
      aria-disabled={disabled ? 'true' : undefined}
      aria-busy={loading ? 'true' : undefined}
      onClick={handleClick}
    >
      {loading ? <span className="ui-form-spinner" aria-hidden="true" /> : icon ? <Glyph id={icon} /> : null}
      <span>{label}</span>
    </button>
  );
}
