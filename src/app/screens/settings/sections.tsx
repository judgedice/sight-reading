/** Profile, Audio, Display, Practice and Accessibility (04 section 5.11). Changes apply at once. */
import { useEffect, useState } from 'react';
import type { Calibration, OutputMode } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Button, SegmentedControl, Select, Stepper, Toggle } from '../../../ui/components/form/index.ts';
import { useNavigate } from '../../router.tsx';
import { patchSection, normalizeDisplayName, NAME_MAX } from './model.ts';
import { Row, Section } from './Section.tsx';
import { text } from './text.ts';
import { useReadable, useSettingsServices, type InputDevice } from './context.ts';

export function ProfileSection() {
  const s = useSettingsServices();
  const profile = useReadable(s.profile);
  const savedName = profile?.displayName ?? '';
  const [draft, setDraft] = useState(savedName);
  useEffect(() => setDraft(savedName), [savedName]);

  const commit = (): void => {
    if (!profile) return;
    const name = normalizeDisplayName(draft);
    if (name === null) {
      setDraft(savedName);
      return;
    }
    if (name !== savedName) s.profile.set({ ...profile, displayName: name });
  };

  return (
    <Section id="profile" title={copy('settings.section.profile')}>
      <Row label={copy('settings.profile.name')} htmlFor="set-name" hint={profile ? text('settings.profile.hint') : text('settings.profile.none')}>
        <input
          id="set-name"
          className="set-text"
          type="text"
          maxLength={NAME_MAX}
          value={draft}
          disabled={!profile}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      </Row>
    </Section>
  );
}

const OUTPUTS: readonly { value: OutputMode; label: string }[] = [
  { value: 'speakers', label: copy('output.speakers') },
  { value: 'wired', label: copy('output.wiredHeadphones') },
  { value: 'bluetooth', label: copy('output.bluetooth') },
];

const METHOD_TEXT: Record<Calibration['method'], 'settings.audio.method.loopback' | 'settings.audio.method.play-along' | 'settings.audio.method.reported'> = {
  loopback: 'settings.audio.method.loopback',
  'play-along': 'settings.audio.method.play-along',
  reported: 'settings.audio.method.reported',
};

/** Latest calibration on this device, for the audio row. */
function latestCalibration(all: readonly Calibration[]): Calibration | null {
  return [...all].sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : a.measuredAt > b.measuredAt ? -1 : 0))[0] ?? null;
}

export function AudioSection() {
  const s = useSettingsServices();
  const navigate = useNavigate();
  const settings = useReadable(s.settings);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [calibration, setCalibration] = useState<Calibration | null | undefined>(undefined);

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

  useEffect(() => {
    let live = true;
    s.repos.calibrations.all().then(
      (all) => live && setCalibration(latestCalibration(all)),
      () => live && setCalibration(null),
    );
    return () => {
      live = false;
    };
  }, [s]);

  const practice = settings.practice;
  const inputOptions = [{ value: '', label: text('settings.audio.defaultDevice') }, ...devices.map((d) => ({ value: d.id, label: d.label }))];
  const calibrationLine =
    calibration === undefined
      ? null
      : calibration === null
        ? text('settings.audio.notCalibrated')
        : text('settings.audio.calibrated', {
            date: new Date(calibration.measuredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
            method: text(METHOD_TEXT[calibration.method]),
          });

  return (
    <Section id="audio" title={copy('settings.section.audio')}>
      <Row label={copy('settings.audio.input')}>
        <Select
          ariaLabel={copy('settings.audio.input')}
          options={inputOptions}
          value={settings.audio.inputDeviceId ?? ''}
          onChange={(v) => s.settings.set(patchSection(settings, 'audio', { inputDeviceId: v === '' ? null : v }))}
        />
      </Row>
      <Row label={copy('settings.audio.output')}>
        <SegmentedControl<OutputMode>
          ariaLabel={copy('settings.audio.output')}
          options={OUTPUTS}
          value={practice.outputMode}
          onChange={(v) => s.settings.set(patchSection(settings, 'practice', { outputMode: v }))}
        />
      </Row>
      <Row label={copy('action.calibrate')} hint={calibrationLine ?? undefined}>
        <div className="set-actions">
          <Button label={copy('action.calibrate')} variant="secondary" onClick={() => navigate('/calibrate')} />
          <Button label={copy('action.checkAudio')} variant="tertiary" onClick={() => navigate('/calibrate')} />
        </div>
      </Row>
      <Row label={copy('settings.audio.clickSound')}>
        <SegmentedControl<'tick' | 'wood'>
          ariaLabel={copy('settings.audio.clickSound')}
          options={[
            { value: 'tick', label: copy('settings.audio.click.tick') },
            { value: 'wood', label: copy('settings.audio.click.wood') },
          ]}
          value={practice.clickTimbre}
          onChange={(v) => s.settings.set(patchSection(settings, 'practice', { clickTimbre: v }))}
        />
      </Row>
      <Row label={copy('settings.audio.metronomeVolume')} htmlFor="set-metronome-volume">
        <div className="set-range-wrap">
          <input
            id="set-metronome-volume"
            className="set-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={settings.audio.metronomeVolume}
            onChange={(e) => s.settings.set(patchSection(settings, 'audio', { metronomeVolume: Number(e.target.value) }))}
          />
          <output htmlFor="set-metronome-volume" className="set-range-value">
            {text('settings.audio.volumeValue', { n: settings.audio.metronomeVolume })}
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
      <Row label={copy('settings.audio.a4')}>
        <Stepper
          ariaLabel={copy('settings.audio.a4')}
          value={practice.a4Hz}
          min={415}
          max={446}
          formatValue={(n) => `${n} Hz`}
          onChange={(v) => s.settings.set(patchSection(settings, 'practice', { a4Hz: v }))}
        />
      </Row>
    </Section>
  );
}

export function DisplaySection() {
  const s = useSettingsServices();
  const settings = useReadable(s.settings);
  return (
    <Section id="display" title={copy('settings.section.display')}>
      <Row label={copy('settings.display.theme')}>
        <SegmentedControl<'system' | 'light' | 'dark'>
          ariaLabel={copy('settings.display.theme')}
          options={[
            { value: 'system', label: copy('settings.display.theme.system') },
            { value: 'light', label: copy('settings.display.theme.light') },
            { value: 'dark', label: copy('settings.display.theme.dark') },
          ]}
          value={settings.display.theme}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { theme: v }))}
        />
      </Row>
      <Row label={copy('settings.display.liveFeedback')}>
        <SegmentedControl<'full' | 'after-take'>
          ariaLabel={copy('settings.display.liveFeedback')}
          options={[
            { value: 'full', label: copy('settings.display.liveFeedback.full') },
            { value: 'after-take', label: copy('settings.display.liveFeedback.afterTake') },
          ]}
          value={settings.display.liveFeedback}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { liveFeedback: v }))}
        />
      </Row>
      <Row label={copy('settings.display.cents')}>
        <Toggle
          label={copy('settings.display.cents')}
          checked={settings.display.showCentsMs}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { showCentsMs: v }))}
        />
      </Row>
    </Section>
  );
}

export function PracticeSection() {
  const s = useSettingsServices();
  const settings = useReadable(s.settings);
  const prefs = settings.practicePrefs;
  return (
    <Section id="practice" title={copy('settings.section.practice')}>
      <Row label={copy('settings.practice.stars')}>
        <Toggle
          label={copy('settings.practice.stars')}
          checked={prefs.showStars}
          onChange={(v) => s.settings.set(patchSection(settings, 'practicePrefs', { showStars: v }))}
        />
      </Row>
      <Row label={copy('settings.practice.tips')}>
        <Toggle
          label={copy('settings.practice.tips')}
          checked={prefs.showTips}
          onChange={(v) => s.settings.set(patchSection(settings, 'practicePrefs', { showTips: v }))}
        />
      </Row>
      <Row label={copy('settings.practice.beta')}>
        <Toggle
          label={copy('settings.practice.beta')}
          checked={prefs.showBeta}
          onChange={(v) => s.settings.set(patchSection(settings, 'practicePrefs', { showBeta: v }))}
        />
      </Row>
      {s.runPlacement ? (
        <Row label={copy('action.runPlacementAgain')} hint={text('settings.placement.hint')}>
          <Button label={copy('action.runPlacementAgain')} variant="secondary" onClick={() => s.runPlacement?.()} />
        </Row>
      ) : null}
    </Section>
  );
}

export function AccessibilitySection() {
  const s = useSettingsServices();
  const settings = useReadable(s.settings);
  const a = settings.accessibility;
  return (
    <Section id="accessibility" title={copy('settings.section.accessibility')}>
      <Row label={copy('settings.accessibility.reduceMotion')}>
        <SegmentedControl<'system' | 'on' | 'off'>
          ariaLabel={copy('settings.accessibility.reduceMotion')}
          options={[
            { value: 'system', label: copy('settings.accessibility.reduceMotion.system') },
            { value: 'on', label: copy('settings.accessibility.reduceMotion.on') },
            { value: 'off', label: copy('settings.accessibility.reduceMotion.off') },
          ]}
          value={a.reduceMotion}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { reduceMotion: v }))}
        />
      </Row>
      <Row label={copy('settings.accessibility.highContrast')}>
        <Toggle
          label={copy('settings.accessibility.highContrast')}
          checked={a.highContrast}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { highContrast: v }))}
        />
      </Row>
      <Row label={copy('settings.accessibility.shortcuts')}>
        <Toggle
          label={copy('settings.accessibility.shortcuts')}
          checked={a.keyboardShortcuts}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { keyboardShortcuts: v }))}
        />
      </Row>
      <Row label={copy('settings.accessibility.announce')}>
        <Toggle
          label={copy('settings.accessibility.announce')}
          checked={a.announceResults}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { announceResults: v }))}
        />
      </Row>
    </Section>
  );
}
