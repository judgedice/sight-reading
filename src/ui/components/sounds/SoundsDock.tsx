import { useState, type ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { Glyph } from '../../primitives/Glyph.tsx';
import { LiveCaption } from './LiveCaption.tsx';
import { SoundButton } from './SoundButton.tsx';
import { SoundsExplainSheet } from './SoundsExplainSheet.tsx';
import { soundRows } from './rows.tsx';
import type { SoundId, SoundsModel } from './types.ts';
import './sounds.css';

export interface SoundsDockProps {
  model: SoundsModel;
  onPress: (id: SoundId) => void;
  caption?: ReactNode;
  captionFailed?: boolean | undefined;
}

/**
 * Phone: the live caption and a row of three dock buttons with short labels and the full name as accessible name
 * ("Tempo" is "Hear the tempo"), then the 44 px "What do these do?" button that opens the explain sheet
 * (06 section 6.8). "Listen first" in ranked adds "Makes this practice" inside the button. Check my tuning is not
 * here: it sits at the top of the "Before you play" sheet. The screen fixes the dock to the window bottom.
 */
export function SoundsDock({ model, onPress, caption, captionFailed }: SoundsDockProps) {
  const [explain, setExplain] = useState(false);
  const rows = soundRows(model).filter((row) => row.id !== 'tuning');
  return (
    <div className="sd-dock" data-testid="sounds-dock">
      <LiveCaption failed={captionFailed}>{caption}</LiveCaption>
      <div className="sd-dock-row">
        {rows.map((row) => (
          <SoundButton
            key={row.id}
            variant="dock"
            soundId={row.id}
            icon={row.icon}
            label={row.label}
            shortLabel={row.shortLabel}
            caption={row.id === 'listen' && model.ranked && !row.playing ? copy('listen.rankedLine') : undefined}
            playing={row.playing}
            disabled={row.disabled}
            onPress={() => onPress(row.id)}
          />
        ))}
        <button
          type="button"
          className="ui-info-button sd-dock-info"
          aria-label={copy('scan.sounds.whatAreThese')}
          aria-haspopup="dialog"
          onClick={() => setExplain(true)}
        >
          <span className="ui-info-button-disc">
            <Glyph id="info" size={16} />
          </span>
        </button>
      </div>
      <SoundsExplainSheet open={explain} model={model} onClose={() => setExplain(false)} />
    </div>
  );
}
