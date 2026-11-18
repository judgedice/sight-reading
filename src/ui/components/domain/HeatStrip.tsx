import './domain.css';

export interface HeatBar {
  /** Share of the bar's notes that are off, 0..1. */
  share: number;
  /** Relative width (for example the bar's beat count). Defaults to 1. */
  weight?: number;
  /** Tooltip and accessible name, for example copy('results.heat', ...). */
  label?: string;
}

export interface HeatStripProps {
  bars: readonly HeatBar[];
}

export type HeatLevel = 0 | 1 | 2 | 3;

/** 0: track only; up to 25%: wide hatch; up to 50%: tight hatch; above: solid (04 6.5). */
export function heatLevel(share: number): HeatLevel {
  if (!(share > 0)) return 0;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  return 3;
}

/** A 6 px strip above the score, one cell per bar. Cells with a label are focusable (hover or focus shows it). */
export function HeatStrip({ bars }: HeatStripProps) {
  return (
    <div className="dom-heat" role="list">
      {bars.map((bar, i) => (
        <span
          key={i}
          role="listitem"
          className="dom-heat-cell"
          data-level={heatLevel(bar.share)}
          style={{ flexGrow: bar.weight ?? 1 }}
          title={bar.label}
          aria-label={bar.label}
          tabIndex={bar.label && heatLevel(bar.share) > 0 ? 0 : undefined}
        />
      ))}
    </div>
  );
}
