/**
 * "One thing to try" (05 section 8.11, 06 section 6.15, designer's notes 17): the primary tip with its evidence and
 * hear buttons; the other tips behind "Show n more tips" / "Hide tips" on a `bg` panel; when open (or with one tip),
 * the "Show a tip after each take" switch as the last row. Nothing at all when there are no tips.
 */
import { useId, useState } from 'react';
import type { Configs, Tip } from '../../../core/types.ts';
import { Button, Toggle } from '../../../ui/components/form/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { dimensionLabel, hearSpans, patternDef, type HearSpan } from './model.ts';
import { text } from './text.ts';

export interface TipsSectionProps {
  configs: Configs;
  tips: readonly Tip[];
  /** "Hear bar n" / "Hear bars n to m". Absent: no hear buttons. */
  onHear?: ((span: HearSpan) => void) | undefined;
  /** The "Show a tip after each take" switch; absent: no switch. */
  onShowTipsChange?: ((on: boolean) => void) | undefined;
}

function HearButtons({ tip, onHear }: { tip: Tip; onHear: ((span: HearSpan) => void) | undefined }) {
  if (!onHear) return null;
  const spans = hearSpans(tip.bars);
  if (spans.length === 0) return null;
  return (
    <div className="res-tip-hear">
      {spans.map((s) => (
        <Button key={`${s.from}-${s.to}`} label={s.label} icon="listen" variant="tonal" size="compact" onClick={() => onHear(s)} data-hear={`${s.from}-${s.to}`} />
      ))}
    </div>
  );
}

export function TipsSection({ configs, tips, onHear, onShowTipsChange }: TipsSectionProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const shown = tips.slice(0, Math.max(1, configs.tips.selection.maxTips));
  const primary = shown.find((t) => t.primary) ?? shown[0];
  if (!primary) return null;
  const rest = shown.filter((t) => t !== primary);
  const switchVisible = onShowTipsChange !== undefined && (open || rest.length === 0);
  return (
    <section className="res-card res-tips" data-testid="res-tips" aria-labelledby={`${panelId}-title`}>
      <header className="res-tips-head">
        <span className="res-tips-tile" aria-hidden="true">
          <Glyph id="lightbulb" size={20} />
        </span>
        <h2 className="res-tips-title" id={`${panelId}-title`}>
          {text('results.tip.title')}
        </h2>
      </header>
      <p className="res-tip-text" data-tip={primary.id}>
        {primary.text}
      </p>
      {primary.evidence ? <p className="res-tip-evidence">{primary.evidence}</p> : null}
      <HearButtons tip={primary} onHear={onHear} />
      {rest.length > 0 ? (
        <>
          <button type="button" className="res-tip-more" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
            <Glyph id="chevron-down" size={16} className={open ? 'res-tip-more-open' : undefined} />
            <span>{open ? text('results.tip.less', { n: rest.length }) : text('results.tip.more', { n: rest.length })}</span>
          </button>
          <div id={panelId} className="res-tip-rest" hidden={!open}>
            {rest.map((t) => (
              <div key={t.id} className="res-tip-other" data-tip={t.id}>
                <p className="res-tip-dim">{dimensionLabel(patternDef(configs, t.patternId)?.dimension ?? 'none')}</p>
                <p className="res-tip-body">{t.text}</p>
                {t.evidence ? <p className="res-tip-evidence">{t.evidence}</p> : null}
                <HearButtons tip={t} onHear={onHear} />
              </div>
            ))}
          </div>
        </>
      ) : null}
      {switchVisible ? (
        <div className="res-tip-setting">
          <Toggle checked label={text('tips.showBetween')} onChange={(v) => onShowTipsChange(v)} />
        </div>
      ) : null}
    </section>
  );
}
