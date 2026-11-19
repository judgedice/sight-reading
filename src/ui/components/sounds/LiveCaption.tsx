import type { ReactNode } from 'react';
import './sounds.css';

export interface LiveCaptionProps {
  /** What is sounding ("Key chord: G major"). Nothing renders but the reserved line when empty. */
  children?: ReactNode;
  /** Shown as a failure: no bars, no brass. */
  failed?: boolean | undefined;
}

/**
 * One line above the sounds group (desktop) or the dock (phone): three brass bars, then what is sounding
 * (06 section 6.8). The bars move at 0.9, 1.3 and 1.1 Hz and stand still under reduced motion. It is a visual
 * caption: the screen's one polite region makes the announcements (05 section 14 item 7).
 */
export function LiveCaption({ children, failed = false }: LiveCaptionProps) {
  const has = children !== undefined && children !== null && children !== false && children !== '';
  return (
    <p className="sd-live-cap" data-active={has && !failed ? 'true' : undefined} data-failed={has && failed ? 'true' : undefined} data-testid="live-caption">
      {has ? (
        <>
          {failed ? null : (
            <span className="sd-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          <span className="sd-live-text">{children}</span>
        </>
      ) : null}
    </p>
  );
}
