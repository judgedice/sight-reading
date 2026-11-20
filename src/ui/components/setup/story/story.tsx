/**
 * Dev-only story page for the setup controls: `/src/ui/components/setup/story/index.html` on the Vite dev server.
 * It lays the controls out as the `home`, `setup-sheet` and `setup-states` mockups do, so they can be compared and
 * driven by the package's browser test. Not a build input; not shipped.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../tokens.css';
import type { KeySig } from '../../../../core/types.ts';
import { GlyphSprite } from '../../../primitives/Glyph.tsx';
import { DifficultyControl } from '../DifficultyControl.tsx';
import { FallbackNote } from '../FallbackNote.tsx';
import { KeyGrid } from '../KeyGrid.tsx';
import { LengthRow } from '../LengthRow.tsx';
import { ModeControl } from '../ModeControl.tsx';
import { TempoRow } from '../TempoRow.tsx';
import { TimeSegments } from '../TimeSegments.tsx';
import type { PracticeMode } from '../types.ts';
import { XpLine } from '../XpLine.tsx';
import { difficultyRow, keyRow, lengthChoice, lengthOnly, tempoRow, timeRow } from './fixtures.ts';
import './story.css';

const keyValue = (k: KeySig | 'random'): string | null => (k === 'random' ? null : `${k.fifths}:${k.mode}`);

function Story() {
  const [key, setKey] = useState<string | null>('1:major');
  const [follow, setFollow] = useState(false);
  const [meter, setMeter] = useState<'random' | '4/4' | '3/4'>('4/4');
  const [bpm, setBpm] = useState<number | 'random'>(72);
  const [mode, setMode] = useState<PracticeMode>('ranked');
  const [heard, setHeard] = useState<number | null>(null);
  const anyCount = (key === null ? 1 : 0) + (meter === 'random' ? 1 : 0) + (bpm === 'random' ? 1 : 0);
  const xp = anyCount > 0 ? { key: 'setup.xp.line', vars: { percent: anyCount * 8 } } : null;

  return (
    <main className="story">
      <GlyphSprite />
      <section className="story-card story-home" data-story="home">
        <div className="story-scroll">
          <DifficultyControl row={difficultyRow(follow)} onChange={(l) => setFollow(l === 'random')} />
          <hr className="story-rule" />
          <KeyGrid row={keyRow(1, key, 3)} clef="bass" difficulty={2} onChange={(k) => setKey(keyValue(k))} />
        </div>
        <div className="story-foot">
          <ModeControl inlineLabel value={mode} onChange={setMode} />
          <div className="story-start-row">
            <XpLine line={xp} />
            <span className="story-start" data-heard={heard ?? ''} />
          </div>
        </div>
      </section>

      <section className="story-card story-sheet" data-story="sheet">
        <DifficultyControl row={difficultyRow(false)} onChange={() => undefined} />
        <KeyGrid expanded row={keyRow(1, key, 3)} clef="bass" difficulty={2} onChange={(k) => setKey(keyValue(k))} />
        <TimeSegments expanded row={timeRow(meter)} onChange={(m) => setMeter(m as typeof meter)} />
        <TempoRow row={tempoRow(bpm === 'random')} value={bpm} onChange={setBpm} onHearTempo={setHeard} />
        <LengthRow row={lengthOnly} onChange={() => undefined} />
      </section>

      <div className="story-states">
        <section className="story-card" data-story="time-few">
          <TimeSegments row={timeRow('3/4')} onChange={() => undefined} />
        </section>
        <section className="story-card" data-story="mode-blocked">
          <ModeControl value="practice" onChange={() => undefined} rankedBlock="calibration" onFix={() => undefined} />
        </section>
        <section className="story-card story-wide" data-story="key-fallback">
          <KeyGrid
            row={keyRow(1, null, 3)}
            clef="bass"
            difficulty={2}
            onChange={() => undefined}
            fallback={
              <FallbackNote
                durationMs={600_000}
                note={{ key: 'setup.fallback.key', vars: { key: 'D major', level: 2 } }}
              />
            }
          />
        </section>
        <section className="story-card story-wide" data-story="key-clarinet">
          <KeyGrid expanded row={keyRow(3, '3:major', 6, -2)} clef="treble" difficulty={5} onChange={() => undefined} />
        </section>
        <section className="story-card story-wide" data-story="key-many">
          <KeyGrid row={keyRow(3, '3:major', 6)} clef="treble" difficulty={5} onChange={() => undefined} />
        </section>
        <section className="story-card" data-story="extras">
          <DifficultyControl row={difficultyRow(true)} onChange={() => undefined} />
          <LengthRow row={lengthChoice} onChange={() => undefined} />
          <ModeControl value="practice" onChange={() => undefined} rankedBlock="mic" onFix={() => undefined} />
        </section>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <Story />
    </StrictMode>,
  );
