import type { ReactNode } from 'react';
import { copy } from '../../copy/copy.ts';
import { LiveCaption } from './LiveCaption.tsx';
import { ReferenceInfo } from './ReferenceInfo.tsx';
import { SoundButton } from './SoundButton.tsx';
import { soundRows } from './rows.tsx';
import type { SoundId, SoundsModel } from './types.ts';
import './sounds.css';

export interface SoundsGroupProps {
  model: SoundsModel;
  /** A press on a sound. The screen plays or stops it; pressing the playing one is its stop. */
  onPress: (id: SoundId) => void;
  /** What is sounding, for the line above the card. Omit when nothing plays. */
  caption?: ReactNode;
  /** The caption is a failure ("That sound didn't play…"): plain text, no bars. */
  captionFailed?: boolean | undefined;
  /** The line under the title that says what plays on Start ("When you start: ..."). Supplied by the screen's copy. */
  lead?: string | undefined;
}

/**
 * Desktop: the Sounds card under "Start playing" (06 section 6.8). The live caption sits above it. Order: Listen
 * first, Hear the tempo, Hear starting pitch or Hear the key (with its info button), then Check my tuning.
 */
export function SoundsGroup({ model, onPress, caption, captionFailed, lead }: SoundsGroupProps) {
  const rows = soundRows(model);
  return (
    <div className="sd-group-wrap">
      <LiveCaption failed={captionFailed}>{caption}</LiveCaption>
      <section className="sd-group" aria-labelledby="sd-group-title" data-testid="sounds-group">
        <div className="sd-group-head">
          <h3 id="sd-group-title" className="sd-group-title">
            {copy('scan.sounds.title')}
          </h3>
        </div>
        {lead ? <p className="sd-group-lead">{lead}</p> : null}
        <div className="sd-group-rows">
          {rows.map((row) => (
            <SoundButton
              key={row.id}
              soundId={row.id}
              icon={row.icon}
              label={row.label}
              caption={row.caption}
              playing={row.playing}
              disabled={row.disabled}
              info={row.id === 'reference' ? <ReferenceInfo kind={model.reference} /> : undefined}
              onPress={() => onPress(row.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
