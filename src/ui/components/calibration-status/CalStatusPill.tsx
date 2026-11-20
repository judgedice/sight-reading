import { useId, useState } from 'react';
import { copy } from '../../copy/copy.ts';
import type { GlyphId } from '../../glyph-ids.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { Popover } from '../../primitives/Popover.tsx';
import { Button } from '../form/Button.tsx';
import { cls } from '../form/cls.ts';
import { calTexts } from './text.ts';
import type { CalStatusVariant, CalStatusView } from './types.ts';
import './cal-status.css';

export interface CalStatusPillProps {
  status: CalStatusView;
  variant: CalStatusVariant;
  /** Starts a calibration (the popover action and the line's link). */
  onCalibrate: () => void;
  /** Opens Settings (the popover's second action). Omitted: no Settings button. */
  onSettings?: (() => void) | undefined;
  /** On the read-through the popover adds "We'll bring you back to this music after." */
  readThrough?: boolean;
  /** The header is narrow: the calibrated text shortens to "Calibrated · today". */
  short?: boolean;
  /** About how long a calibration takes, for the popover of the not-calibrated state. */
  seconds?: number;
  className?: string;
}

const GLYPH: Record<CalStatusView['state'], GlyphId | null> = { ok: 'check', none: 'speaker', changed: 'caution', failed: 'speaker' };

function StateGlyph({ state }: { state: CalStatusView['state'] }) {
  const id = GLYPH[state];
  return id === null ? null : <Glyph id={id} size={16} className="cs-glyph" />;
}

/**
 * The one answer to "is this setup calibrated?" (04-design section 2). Only `changed` takes the caution tone.
 * `header` and `card-row` are buttons that open a popover with the detail and the action; `line` shows the text and a
 * link beside it. It never opens by itself.
 */
export function CalStatusPill({ status, variant, onCalibrate, onSettings, readThrough = false, short = false, seconds, className }: CalStatusPillProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const popId = useId();
  const t = calTexts(status, seconds);
  const state = status.state;

  const act = (): void => {
    setOpen(false);
    onCalibrate();
  };

  if (variant === 'line') {
    const linked = state !== 'ok';
    return (
      <p className={cls('cs-line', className)} data-state={state} data-variant="line" data-testid="cal-status">
        <StateGlyph state={state} />
        <span className="cs-line-text">{t.lead}</span>
        {linked ? (
          <>
            {state === 'changed' ? <span aria-hidden="true">{'·'}</span> : null}
            <button type="button" className="cs-link" onClick={act}>
              {t.action}
            </button>
          </>
        ) : null}
      </p>
    );
  }

  const text = variant === 'header' && short ? t.short : t.full;
  const row = variant === 'card-row';
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={cls(row ? 'cs-row' : 'cs-pill', className)}
        data-state={state}
        data-variant={variant}
        data-testid="cal-status"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <StateGlyph state={state} />
        <span className="cs-text">{row && state === 'changed' ? t.lead : text}</span>
        {row && state !== 'ok' ? <span className="cs-row-action">{t.action}</span> : null}
        <Glyph id={row ? 'chevron-right' : 'chevron-down'} size={16} className="cs-chevron" />
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={t.title} title={t.title} id={popId}>
        <div className="cs-pop" data-state={state}>
          <p className="cs-pop-detail">{t.detail}</p>
          {readThrough ? <p className="cs-pop-note">{copy('calStatus.readthrough.note')}</p> : null}
          <div className="cs-pop-actions">
            <Button variant="primary" size="compact" label={t.action} onClick={act} />
            {onSettings ? (
              <Button
                variant="quiet"
                size="compact"
                label={copy('nav.settings')}
                onClick={() => {
                  setOpen(false);
                  onSettings();
                }}
              />
            ) : null}
          </div>
        </div>
      </Popover>
    </>
  );
}
