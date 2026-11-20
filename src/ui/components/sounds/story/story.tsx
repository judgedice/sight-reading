/**
 * Dev-only story page for the sounds components: `/src/ui/components/sounds/story/index.html` on the Vite dev server.
 * It lays them out as the `scan-*` mockups do. Query: kind=voice|instrument, ranked=0|1, playing=listen|tempo|
 * reference|tuning, caption=chord|first|tempo|bar|failed, popover=1, confirm=1, explain=1, theme=dark.
 * Its literals are dev labels, not product copy.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../tokens.css';
import { GlyphSprite } from '../../../primitives/Glyph.tsx';
import { copy } from '../../../copy/copy.ts';
import { Button } from '../../form/Button.tsx';
import { ListenConfirm } from '../ListenConfirm.tsx';
import { PlayingTempo } from '../rows.tsx';
import { SoundsDock } from '../SoundsDock.tsx';
import { SoundsExplainSheet } from '../SoundsExplainSheet.tsx';
import { SoundsGroup } from '../SoundsGroup.tsx';
import type { ReferenceKind, SoundId, SoundsModel } from '../types.ts';
import './story.css';

const DEV = { paper: 'Score area', time: 'Your reading time keeps running: 0:18 left.' };

const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme') ?? 'light';
const kind: ReferenceKind = params.get('kind') === 'instrument' ? 'instrument' : 'voice';
const initialPlaying = (params.get('playing') as SoundId | null) ?? null;

function captionFor(playing: SoundId | null, which: string | null, tempo: SoundsModel['tempo']) {
  if (which === 'failed') return copy('sound.failed');
  if (which === 'tempo' || (!which && playing === 'tempo')) return <PlayingTempo tempo={tempo} />;
  if (which === 'bar' || (!which && playing === 'listen')) return copy('listen.playing', { n: 3, total: 8 });
  if (which === 'first') return copy('reference.playing.first', { note: 'G3' });
  if (which === 'chord' || (!which && playing === 'reference')) return copy('reference.playing.chord', { key: 'G major' });
  return undefined;
}

function Story() {
  const [playing, setPlaying] = useState<SoundId | null>(initialPlaying);
  const [ranked, setRanked] = useState(params.get('ranked') !== '0');
  const [confirm, setConfirm] = useState(params.get('confirm') === '1');
  const [explain, setExplain] = useState(params.get('explain') === '1');
  const tempo = { unit: '♩', bpm: 72 };
  const model: SoundsModel = { reference: kind, ranked, tempo, tuning: kind === 'instrument', tuningSeconds: 3, playing };
  const caption = captionFor(playing, params.get('caption'), tempo);
  const press = (id: SoundId): void => {
    if (id === 'listen' && ranked && playing !== 'listen') {
      setConfirm(true);
      return;
    }
    setPlaying(playing === id ? null : id);
  };
  return (
    <>
      <GlyphSprite />
      <main className="story-grid" data-story="desktop">
        <section className="story-paper">
          <p className="story-note">{DEV.paper}</p>
        </section>
        <aside className="story-aside">
          <Button className="story-start" variant="primary" size="hero" label={copy('action.startPlaying')} kbd={copy('shortcuts.spaceKey')} />
          <SoundsGroup model={model} onPress={press} caption={caption} captionFailed={params.get('caption') === 'failed'} lead={copy(kind === 'voice' ? 'scan.sounds.whenStart.voice' : 'scan.sounds.whenStart.instrument')} />
        </aside>
      </main>
      <main className="story-phone" data-story="phone">
        <p className="story-note">{DEV.paper}</p>
        <div className="story-dock">
          <SoundsDock model={model} onPress={press} caption={caption} captionFailed={params.get('caption') === 'failed'} />
          <Button className="story-start story-dock-start" variant="primary" size="hero" label={copy('action.startPlaying')} />
        </div>
      </main>
      <ListenConfirm
        open={confirm}
        secondsLeft={18}
        timeLine={DEV.time}
        onKeepRanked={() => setConfirm(false)}
        onListen={() => {
          setConfirm(false);
          setRanked(false);
          setPlaying('listen');
        }}
      />
      <SoundsExplainSheet open={explain} model={model} onClose={() => setExplain(false)} />
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Story />
    </StrictMode>,
  );
}
