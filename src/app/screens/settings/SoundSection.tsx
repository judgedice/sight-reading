/**
 * Settings > Sound (05 sections 8.14 and 11.2, designer's notes 13 to 15): the metronome sound radio cards with a
 * preview each, the accent, the click volume, the click during the take, the calibration status, the devices and the
 * tuning pitch.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import type { ClickTimbre, MetronomeSound, OutputMode } from '../../../core/types.ts';
import { idleSoundView } from '../../../session/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { CalStatusPill } from '../../../ui/components/calibration-status/index.ts';
import { Button, SegmentedControl, Select, Stepper, Toggle, radioGroupHomeEnd } from '../../../ui/components/form/index.ts';
import { LiveCaption } from '../../../ui/components/sounds/index.ts';
import { Glyph } from '../../../ui/primitives/Glyph.tsx';
import { useNavigate } from '../../router.tsx';
import { patchSection } from './model.ts';
import { Group, Row, Section } from './Section.tsx';
import { text } from './text.ts';
import { useOptionalReadable, useReadable, useSettingsServices, type InputDevice } from './context.ts';
import { SoundWave } from './SoundWave.tsx';

const SOUNDS: readonly { id: MetronomeSound; label: string; hint: string }[] = [
  { id: 'classic', label: copy('settings.audio.click.classic'), hint: copy('settings.audio.click.classic.hint') },
  { id: 'woodblock', label: copy('settings.audio.click.woodblock'), hint: copy('settings.audio.click.woodblock.hint') },
  { id: 'beep', label: copy('settings.audio.click.beep'), hint: copy('settings.audio.click.beep.hint') },
];

const OUTPUTS: readonly { value: OutputMode; label: string }[] = [
  { value: 'speakers', label: copy('output.speakers') },
  { value: 'wired', label: copy('output.wiredHeadphones') },
  { value: 'bluetooth', label: copy('output.bluetooth') },
];

/** The stored sound as the player's three: an older stored `tick` is Classic and `wood` is Woodblock (05 section 11.1). */
export function soundOf(stored: ClickTimbre): MetronomeSound {
  if (stored === 'woodblock' || stored === 'wood') return 'woodblock';
  if (stored === 'beep') return 'beep';
  return 'classic';
}

const idleStore = createStore(idleSoundView);

export function SoundSection() {
  const s = useSettingsServices();
  const navigate = useNavigate();
  const settings = useReadable(s.settings);
  const view = useSyncExternalStore((l) => (s.sounds ?? idleStore).subscribe(l), () => (s.sounds ?? idleStore).getState());
  const calStatus = useOptionalReadable(s.calibrationStatus);
  const [local, setLocal] = useState<MetronomeSound | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);

  useEffect(() => {
    let live = true;
    s.listInputDevices?.().then(
      (d) => live && setDevices(d),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [s]);

  // Leaving the screen stops a preview that is still sounding.
  useEffect(() => () => s.stopSounds?.(), [s]);

  const practice = settings.practice;
  const chosen = soundOf(practice.clickTimbre);
  const accent = practice.accentFirstBeat ?? true;
  const fromStore = view.playing === 'preview' && view.caption?.kind === 'preview' ? view.caption.sound : null;
  const playing = s.sounds ? fromStore : local;
  const soundLabel = (id: MetronomeSound): string => SOUNDS.find((x) => x.id === id)?.label ?? id;

  const press = (id: MetronomeSound): void => {
    if (playing === id) {
      s.stopSounds?.();
      setLocal(null);
      return;
    }
    setLocal(id);
    const done = (): void => setLocal((cur) => (cur === id ? null : cur));
    const started = s.previewSound?.(id);
    if (started) started.then(done, done);
    else done();
  };

  const inputOptions = [{ value: '', label: text('settings.audio.defaultDevice') }, ...devices.map((d) => ({ value: d.id, label: d.label }))];

  return (
    <Section id="audio" title={copy('settings.section.audio')}>
      <Group>
        <div className="set-row set-row-sound">
          <div className="set-sound-head">
            <span className="set-label" id="set-sound-label">
              {copy('settings.audio.clickSound')}
            </span>
            <LiveCaption>{playing ? copy('settings.audio.click.playing', { sound: soundLabel(playing) }) : undefined}</LiveCaption>
          </div>
          <div role="radiogroup" aria-labelledby="set-sound-label" className="set-sounds" onKeyDown={radioGroupHomeEnd}>
            {SOUNDS.map((o) => {
              const isPlaying = playing === o.id;
              const name = copy('settings.audio.click.play', { sound: o.label });
              return (
                <div key={o.id} className="set-sound" data-selected={chosen === o.id ? 'true' : undefined} data-playing={isPlaying ? 'true' : undefined}>
                  <label className="set-sound-main">
                    <input
                      type="radio"
                      name="set-sound"
                      value={o.id}
                      className="ui-form-hidden"
                      checked={chosen === o.id}
                      onChange={() => s.settings.set(patchSection(settings, 'practice', { clickTimbre: o.id }))}
                    />
                    <span className="set-radio" aria-hidden="true">
                      <i />
                    </span>
                    <span className="set-sound-text">
                      <span className="set-label">{o.label}</span>
                      <span className="set-hint">{o.hint}</span>
                    </span>
                  </label>
                  <SoundWave sound={o.id} />
                  <button
                    type="button"
                    className="set-play"
                    aria-label={isPlaying ? copy('action.stop') : name}
                    data-sound={o.id}
                    onClick={() => press(o.id)}
                  >
                    <Glyph id={isPlaying ? 'stop' : 'play'} size={18} />
                    <span className="set-play-text" aria-hidden="true">
                      {isPlaying ? copy('action.stop') : text('settings.audio.click.playShort')}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <p className="set-note">
            <Glyph id="info" size={16} />
            <span>{copy('settings.audio.click.keepsCalibration')}</span>
          </p>
        </div>
        <Row label={copy('settings.audio.accent')} hint={text('settings.audio.accent.hint')} inline>
          <Toggle
            label={copy('settings.audio.accent')}
            checked={accent}
            onChange={(v) => s.settings.set(patchSection(settings, 'practice', { accentFirstBeat: v }))}
          />
        </Row>
        <Row label={copy('settings.audio.metronomeVolume')} htmlFor="set-metronome-volume" hint={copy('settings.audio.metronomeVolume.hint')}>
          <div className="set-range-wrap">
            <Glyph id="volume-2" size={18} />
            <input
              id="set-metronome-volume"
              className="set-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.audio.metronomeVolume}
              onChange={(e) => s.settings.set(patchSection(settings, 'audio', { metronomeVolume: Number(e.target.value) }))}
              onPointerUp={() => void s.playClick?.(chosen)}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) void s.playClick?.(chosen);
              }}
            />
            <output htmlFor="set-metronome-volume" className="set-range-value">
              {text('settings.audio.volumePercent', { n: settings.audio.metronomeVolume })}
            </output>
          </div>
        </Row>
        <Row label={copy('settings.audio.metronome')}>
          <SegmentedControl<'audible' | 'countInOnly'>
            ariaLabel={copy('settings.audio.metronome')}
            options={[
              { value: 'audible', label: copy('settings.audio.metronome.audible') },
              { value: 'countInOnly', label: copy('settings.audio.metronome.countInOnly') },
            ]}
            value={practice.metronome}
            onChange={(v) => s.settings.set(patchSection(settings, 'practice', { metronome: v }))}
          />
        </Row>
      </Group>
      <Group>
        {calStatus ? (
          <Row label={text('settings.audio.calibration')} inline>
            <div className="set-cal">
              <CalStatusPill status={calStatus} variant="line" onCalibrate={() => navigate('/calibrate?from=settings')} />
              {calStatus.state === 'ok' ? (
                <Button label={copy('action.recalibrate')} variant="secondary" size="compact" onClick={() => navigate('/calibrate?from=settings')} />
              ) : null}
            </div>
          </Row>
        ) : null}
        <Row label={copy('settings.audio.input')}>
          <Select
            ariaLabel={copy('settings.audio.input')}
            options={inputOptions}
            value={settings.audio.inputDeviceId ?? ''}
            onChange={(v) => s.settings.set(patchSection(settings, 'audio', { inputDeviceId: v === '' ? null : v }))}
          />
        </Row>
        <Row label={copy('settings.audio.output')}>
          <Select
            ariaLabel={copy('settings.audio.output')}
            options={OUTPUTS}
            value={practice.outputMode}
            onChange={(v) => s.settings.set(patchSection(settings, 'practice', { outputMode: v as OutputMode }))}
          />
        </Row>
        <Row label={copy('settings.audio.a4')} hint={copy('settings.audio.a4.hint')} inline>
          <Stepper
            ariaLabel={copy('settings.audio.a4')}
            value={practice.a4Hz}
            min={415}
            max={446}
            formatValue={(n) => `${n} Hz`}
            onChange={(v) => s.settings.set(patchSection(settings, 'practice', { a4Hz: v }))}
          />
        </Row>
      </Group>
    </Section>
  );
}
