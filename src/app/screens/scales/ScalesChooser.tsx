/**
 * The scale chooser (PLAN ruling 68): a small dialog on desktop and a sheet on phones, listing the instrument's scales
 * easy to harder with their range, length and tempo. Choosing one starts it at once: straight to the read-through.
 * The tempo can be set for every scale; until it is, each scale keeps its usual tempo.
 */
import { useMemo, useState } from 'react';
import type { ScaleSet, ScalesConfig } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Stepper } from '../../../ui/components/form/index.ts';
import { Glyph, Modal, Sheet } from '../../../ui/primitives/index.ts';
import { scaleRows } from './text.ts';
import './scales.css';

export interface ScalesChooserProps {
  open: boolean;
  config: ScalesConfig;
  set: ScaleSet;
  /** Desktop: a dialog. Phones: a bottom sheet. */
  wide: boolean;
  /** The tempo set for every scale, or null for each scale's usual tempo. */
  bpm: number | null;
  onBpmChange: (bpm: number | null) => void;
  /** A scale was chosen: start it at `bpm` (null: its usual tempo). */
  onChoose: (scaleId: string, bpm: number | null) => void;
  onClose: () => void;
}

const tempoText = (bpm: number): string => copy('tempo.marking', { unit: '♩', bpm });

export function ScalesChooser({ open, config, set, wide, bpm, onBpmChange, onChoose, onClose }: ScalesChooserProps) {
  const rows = useMemo(() => scaleRows(config, set), [config, set]);
  const usual = rows[0]?.bpm ?? config.tempo.minBpm;
  const [shown, setShown] = useState<number>(bpm ?? usual);
  const value = bpm ?? shown;

  const body = (
    <div className="scl" data-testid="scales-chooser">
      <p className="scl-lead">{copy('scales.chooser.lead')}</p>
      <div className="scl-tempo" data-testid="scales-tempo">
        <span className="scl-tempo-label">
          {copy('scales.chooser.tempo')}
        </span>
        <Stepper
          value={value}
          min={config.tempo.minBpm}
          max={config.tempo.maxBpm}
          ariaLabel={copy('scales.chooser.tempo')}
          formatValue={tempoText}
          onChange={(n) => {
            setShown(n);
            onBpmChange(n);
          }}
        />
        <span className="scl-tempo-note">
          {bpm === null ? copy('scales.chooser.tempo.own') : copy('scales.chooser.tempo.set', { tempo: tempoText(bpm) })}
          {bpm !== null ? (
            <>
              {' '}
              <button
                type="button"
                className="scl-link"
                onClick={() => {
                  setShown(usual);
                  onBpmChange(null);
                }}
              >
                {copy('scales.chooser.tempo.reset')}
              </button>
            </>
          ) : null}
        </span>
      </div>
      <ul className="scl-list">
        {rows.map((r) => {
          // "♩ = 66" never breaks across lines.
          const tempo = tempoText(bpm ?? r.bpm).replace(/ /g, ' ');
          return (
            <li key={r.id} className="scl-item">
              <button
                type="button"
                className="scl-row"
                data-testid="scale-row"
                data-scale-id={r.id}
                aria-label={copy('scales.row.a11y', { title: r.title, low: r.low, high: r.high, tempo })}
                onClick={() => onChoose(r.id, bpm)}
              >
                <span className="scl-row-text">
                  <span className="scl-row-title">{r.title}</span>
                  <span className="scl-row-detail">
                    {r.pattern ? copy('scales.row.detail', { pattern: r.pattern, low: r.low, high: r.high, tempo }) : copy('scales.row.range', { low: r.low, high: r.high, tempo })}
                  </span>
                </span>
                <Glyph id="chevron-right" size={20} className="scl-row-chevron" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="scl-practice">
        <Glyph id="info" size={16} className="scl-practice-icon" />
        <span>{copy('scales.chooser.practice')}</span>
      </p>
    </div>
  );

  if (wide) {
    return (
      <Modal open={open} title={copy('scales.chooser.title')} onClose={onClose} className="scl-modal">
        {body}
      </Modal>
    );
  }
  return (
    <Sheet open={open} title={copy('scales.chooser.title')} onClose={onClose}>
      {body}
    </Sheet>
  );
}
