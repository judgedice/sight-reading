import './dev-components.css';
import { useState } from 'react';
import { copy } from '../../ui/copy/copy.ts';
import { noteVisual } from '../../notation/visual-states.ts';
import type { NoteVisualState } from '../../core/types.ts';
import { VerdictGlyph } from '../../ui/components/domain/index.ts';
import { Banner, Card } from '../../ui/components/containers/index.ts';
import { Button, SegmentedControl, Stepper, TempoSlider, Toggle } from '../../ui/components/form/index.ts';
import { InfoButton, Modal, Popover, Sheet, useToast } from '../../ui/primitives/index.ts';

/** One note state per verdict look, in review mode (the mode that shows every glyph). */
export const VERDICT_STATES: readonly { id: string; state: NoteVisualState }[] = [
  { id: 'pending', state: { phase: 'pending' } },
  { id: 'correct', state: { phase: 'judged' } },
  { id: 'marginal', state: { phase: 'judged', marginal: true } },
  { id: 'early', state: { phase: 'judged', timing: 'early' } },
  { id: 'late', state: { phase: 'judged', timing: 'late' } },
  { id: 'sharp', state: { phase: 'judged', pitch: 'sharp' } },
  { id: 'flat', state: { phase: 'judged', pitch: 'flat' } },
  { id: 'wrong-pitch', state: { phase: 'judged', pitch: 'wrong-pitch' } },
  { id: 'octave', state: { phase: 'judged', pitch: 'octave' } },
  { id: 'missed', state: { phase: 'missed' } },
];

/** Dev-only page: not product copy, so not in the catalogue. */
const GALLERY_TITLE = 'Verdict states';

const NOTE_COLOUR: Record<string, string> = { 'n-ink': 'var(--text)', 'n-correct': 'var(--correct)', 'n-error': 'var(--error)', 'n-error-hollow': 'var(--error)' };

/** The notehead plus verdict lane of each state, side by side, for the grayscale distinctness check (04 13.1 item 4). */
function VerdictGallery() {
  return (
    <section aria-labelledby="dev-verdicts" className="app-dev-verdicts">
      <h2 id="dev-verdicts">{GALLERY_TITLE}</h2>
      <div className="app-dev-row">
        {VERDICT_STATES.map(({ id, state }) => {
          const v = noteVisual(state, 'review', false);
          const hollow = v.noteClass === 'n-error-hollow';
          return (
            <div key={id} className="app-dev-verdict" data-testid={`verdict-${id}`} data-note-class={v.noteClass} style={{ color: NOTE_COLOUR[v.noteClass] ?? 'inherit' }}>
              <svg width="16" height="10" viewBox="0 3 28 14" aria-hidden="true" focusable="false">
                <ellipse cx="14" cy="10" rx="9" ry="6.5" transform="rotate(-20 14 10)" fill={hollow ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth={hollow ? 1.8 : 0} />
              </svg>
              <span className="app-dev-lane">
                {v.laneGlyphs.map((g) => (
                  <VerdictGlyph key={g} id={g} size={14} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}


/** Dev-only labels for the component gallery: not product copy, so not in the catalogue. */
const DEV = {
  buttons: 'Buttons',
  primary: 'Primary',
  hero: 'Start playing',
  secondary: 'Secondary',
  tonal: 'Tonal',
  quiet: 'Quiet',
  compact: 'Compact',
  loading: 'Loading',
  disabled: 'Disabled',
  controls: 'Controls',
  segmented: 'Segmented control',
  time: 'Time',
  any: 'Any',
  xp: '+8% XP',
  few: 'few pieces',
  ranked: 'Ranked',
  practice: 'Practice',
  mode: 'Mode',
  switch: 'Switch',
  follow: 'Follow my progress',
  stepper: 'Stepper',
  difficulty: 'Difficulty',
  of10: 'of 10',
  slider: 'Slider with number field',
  tempo: 'Tempo',
  containers: 'Cards and banners',
  card: 'A card: surface, hairline, radius 20, e1.',
  info: 'Information',
  caution: 'Caution',
  danger: 'Danger',
  popover: 'Info popover',
  infoControl: 'Hear starting pitch',
  infoTitle: 'What is the reference?',
  overlays: 'Overlays',
  toast: 'Toast with Undo',
  sheetDone: 'Sheet with Done',
  confirm: 'Confirm dialog',
  picker: 'Picker dialog',
  keepRanked: 'Keep it ranked',
  listenPractice: 'Listen, make it practice',
  filler: 'Long content so the body scrolls while the head and foot stay put.',
  beatUnit: '♩',
} as const;

function ButtonsGallery() {
  return (
    <section aria-labelledby="dev-buttons" className="app-dev-section">
      <h2 id="dev-buttons">{DEV.buttons}</h2>
      <div className="app-dev-cluster">
        <Button variant="primary" label={DEV.primary} />
        <Button variant="secondary" label={DEV.secondary} />
        <Button variant="tonal" label={DEV.tonal} icon="metronome" />
        <Button variant="quiet" label={DEV.quiet} />
        <Button variant="secondary" size="compact" label={DEV.compact} />
        <Button variant="primary" label={DEV.loading} loading />
        <Button variant="secondary" label={DEV.disabled} disabled />
        <Button variant="danger" label={DEV.danger} />
      </div>
      <div className="app-dev-cluster">
        <Button variant="primary" size="hero" label={DEV.hero} icon="play" kbd={copy('shortcuts.spaceKey')} />
      </div>
    </section>
  );
}

function ControlsGallery() {
  const [time, setTime] = useState('any');
  const [mode, setMode] = useState('ranked');
  const [follow, setFollow] = useState(true);
  const [off, setOff] = useState(false);
  const [level, setLevel] = useState(2);
  const [bpm, setBpm] = useState(72);
  return (
    <section aria-labelledby="dev-controls" className="app-dev-section">
      <h2 id="dev-controls">{DEV.controls}</h2>
      <div className="app-dev-stack">
        <h3>{DEV.segmented}</h3>
        <SegmentedControl
          ariaLabel={DEV.time}
          value={time}
          onChange={setTime}
          options={[
            { value: 'any', label: DEV.any, caption: DEV.xp },
            { value: '34', label: '3/4' },
            { value: '44', label: '4/4', caption: DEV.few },
          ]}
        />
        <SegmentedControl
          stretch
          ariaLabel={DEV.mode}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ranked', label: DEV.ranked },
            { value: 'practice', label: DEV.practice },
          ]}
        />
        <h3>{DEV.switch}</h3>
        <Toggle checked={follow} label={DEV.follow} onChange={setFollow} />
        <Toggle checked={off} label={DEV.follow} onChange={setOff} />
        <h3>{DEV.stepper}</h3>
        <Stepper ariaLabel={DEV.difficulty} value={level} min={1} max={10} valueSuffix={DEV.of10} onChange={setLevel} />
        <h3>{DEV.slider}</h3>
        <div className="app-dev-wide"><TempoSlider ariaLabel={DEV.tempo} value={bpm} min={40} max={160} beatUnit={DEV.beatUnit} onChange={setBpm} /></div>
      </div>
    </section>
  );
}

function ContainersGallery() {
  return (
    <section aria-labelledby="dev-containers" className="app-dev-section">
      <h2 id="dev-containers">{DEV.containers}</h2>
      <div className="app-dev-stack">
        <Card>{DEV.card}</Card>
        <Banner tone="info" text={DEV.info} />
        <Banner tone="caution" text={DEV.caution} dismissible />
        <Banner tone="danger" text={DEV.danger} action={{ label: copy('action.retry'), onClick: () => undefined }} />
        <div className="app-dev-cluster">
          <InfoButton control={DEV.infoControl} title={DEV.infoTitle}>
            {copy('stars.tempo.prompt')}
          </InfoButton>
          <span>{DEV.popover}</span>
        </div>
      </div>
    </section>
  );
}

function OverlaysGallery() {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [picker, setPicker] = useState(false);
  const toast = useToast();
  return (
    <section aria-labelledby="dev-overlays" className="app-dev-section">
      <h2 id="dev-overlays">{DEV.overlays}</h2>
      <div className="app-dev-cluster">
        <Button label={DEV.toast} onClick={() => toast.show({ text: copy('toast.saved'), action: { label: copy('action.undo'), onAction: () => undefined } })} />
        <Button label={DEV.sheetDone} onClick={() => setSheet(true)} />
        <Button label={DEV.confirm} onClick={() => setConfirm(true)} />
        <Button label={DEV.picker} onClick={() => setPicker(true)} />
      </div>
      <Sheet open={sheet} title={DEV.sheetDone} onCancel={() => setSheet(false)} onDone={() => setSheet(false)}>
        <p>{copy('scan.cover')}</p>
      </Sheet>
      <Modal
        open={confirm}
        size="confirm"
        title={copy('dialog.skip.title')}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button label={DEV.listenPractice} onClick={() => setConfirm(false)} />
            <Button variant="primary" label={DEV.keepRanked} data-autofocus onClick={() => setConfirm(false)} />
          </>
        }
      >
        <p>{copy('scan.cover')}</p>
      </Modal>
      <Modal
        open={picker}
        size="picker"
        title={DEV.picker}
        onClose={() => setPicker(false)}
        footer={
          <>
            <Button label={copy('action.notNow')} onClick={() => setPicker(false)} />
            <Button variant="primary" label={copy('setup.done')} onClick={() => setPicker(false)} />
          </>
        }
      >
        {Array.from({ length: 40 }, (_, i) => (
          <p key={i}>{DEV.filler}</p>
        ))}
      </Modal>
    </section>
  );
}

/** `#/dev/components`: one trigger per primitive, so each can be seen and driven by hand and by Playwright. */
export function DevComponentsScreen() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [rightSheet, setRightSheet] = useState(false);
  const [popover, setPopover] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const toast = useToast();
  return (
    <section data-testid="screen-dev-components">
      <h1>{copy('shortcuts.title')}</h1>
      <div className="app-dev-row">
        <button type="button" onClick={() => setModal(true)}>
          {copy('dialog.skip.title')}
        </button>
        <button type="button" onClick={() => setSheet(true)}>
          {copy('action.moveUp')}
        </button>
        <button type="button" onClick={() => setRightSheet(true)}>
          {copy('action.filter')}
        </button>
        <button type="button" ref={setAnchor} onClick={() => setPopover((v) => !v)} aria-expanded={popover}>
          {copy('action.hearTempo')}
        </button>
        <button
          type="button"
          onClick={() => toast.show({ text: copy('toast.saved'), action: { label: copy('action.undo'), onAction: () => undefined } })}
        >
          {copy('toast.saved')}
        </button>
      </div>
      <Modal open={modal} title={copy('dialog.skip.title')} onClose={() => setModal(false)}>
        <p>{copy('dialog.skip.practiceNotice', { n: 5 })}</p>
        <div className="app-dev-row">
          <button type="button" data-autofocus onClick={() => setModal(false)}>
            {copy('action.keepReading')}
          </button>
          <button type="button" onClick={() => setModal(false)}>
            {copy('action.skip')}
          </button>
        </div>
      </Modal>
      <Sheet open={sheet} title={copy('action.moveUp')} onClose={() => setSheet(false)}>
        <p>{copy('scan.cover')}</p>
      </Sheet>
      <Sheet open={rightSheet} side="right" title={copy('action.filter')} onClose={() => setRightSheet(false)}>
        <p>{copy('scan.cover')}</p>
      </Sheet>
      <Popover open={popover} anchor={anchor} label={copy('action.hearTempo')} onClose={() => setPopover(false)}>
        {copy('stars.tempo.prompt')}
      </Popover>
      <ButtonsGallery />
      <ControlsGallery />
      <ContainersGallery />
      <OverlaysGallery />
      <VerdictGallery />
    </section>
  );
}
