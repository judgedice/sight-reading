import { useState } from 'react';
import { copy } from '../../copy/copy.ts';
import type { GlyphId } from '../../glyph-ids.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { Button } from '../form/Button.tsx';
import { cls } from '../form/cls.ts';
import './containers.css';

export type BannerTone = 'info' | 'caution' | 'danger';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface BannerProps {
  tone?: BannerTone;
  /** The message. Plain text; say what went wrong and what to do (04 section 8.1, 3.3.3). */
  text: string;
  action?: BannerAction;
  /** Shows a close control. Dismissing hides the banner and calls `onDismiss`. */
  dismissible?: boolean;
  onDismiss?: () => void;
}

const TONE_ICON: Record<BannerTone, GlyphId> = {
  info: 'info',
  caution: 'alert-triangle',
  danger: 'alert-octagon',
};

/**
 * A status banner: a 4 px left bar in the tone colour, a 20 px icon (so caution never relies on
 * colour alone), an optional action and an optional close control (04 section 7.5). Danger announces
 * as an alert; info and caution are polite status.
 */
export function Banner({ tone = 'info', text, action, dismissible = false, onDismiss }: BannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className={cls('ui-banner', `ui-banner-${tone}`)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Glyph id={TONE_ICON[tone]} className="ui-banner-icon" />
      <p className="ui-banner-text">{text}</p>
      {action ? <Button variant="tertiary" size="compact" label={action.label} onClick={action.onClick} /> : null}
      {dismissible ? (
        <button
          type="button"
          className="ui-banner-dismiss"
          aria-label={copy('shortcuts.escSheet')}
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          <Glyph id="x" />
        </button>
      ) : null}
    </div>
  );
}
