/** Profile, Display, Practice and Accessibility (05 section 8.14). Changes apply at once. Sound is in SoundSection. */
import { useEffect, useState } from 'react';
import { copy } from '../../../ui/copy/copy.ts';
import { Button, SegmentedControl, Toggle } from '../../../ui/components/form/index.ts';
import { patchSection, normalizeDisplayName, NAME_MAX } from './model.ts';
import { Group, Row, Section } from './Section.tsx';
import { text } from './text.ts';
import { useReadable, useSettingsServices } from './context.ts';
import { NOTE_LETTERS } from '../../../notation/note-colours.ts';

/**
 * The note colour key (PLAN R69): seven swatches, each a small notehead in its letter's colour with the letter beside
 * it. One image to screen readers, named in words, so the colour is never the only cue.
 */
function NoteColourKey() {
  return (
    <span className="set-note-key" role="img" aria-label={copy('settings.display.noteColours.key')} data-testid="note-colour-key">
      {NOTE_LETTERS.map((l) => (
        <span key={l} className="set-note-key-item" aria-hidden="true">
          <svg className="set-note-key-head" viewBox="0 0 14 10" focusable="false" data-letter={l}>
            <ellipse cx="7" cy="5" rx="6.2" ry="4" transform="rotate(-20 7 5)" />
          </svg>
          {l.toUpperCase()}
        </span>
      ))}
    </span>
  );
}

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
      <Group>
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
      </Group>
    </Section>
  );
}

export function DisplaySection() {
  const s = useSettingsServices();
  const settings = useReadable(s.settings);
  const ghosts = settings.display.ghostsLive ?? 'from4';
  return (
    <Section id="display" title={copy('settings.section.display')}>
      <Group>
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
      <Row label={copy('settings.display.cents')} inline>
        <Toggle
          label={copy('settings.display.cents')}
          checked={settings.display.showCentsMs}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { showCentsMs: v }))}
        />
      </Row>
      <Row label={copy('settings.display.ghostsLive')} hint={copy('settings.display.ghostsLive.hint')}>
        <SegmentedControl<'from4' | 'always' | 'never'>
          ariaLabel={copy('settings.display.ghostsLive')}
          options={[
            { value: 'from4', label: copy('settings.display.ghostsLive.from4') },
            { value: 'always', label: copy('settings.display.ghostsLive.always') },
            { value: 'never', label: copy('settings.display.ghostsLive.never') },
          ]}
          value={ghosts}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { ghostsLive: v }))}
        />
      </Row>
      <Row label={copy('settings.display.noteColours')} hint={copy('settings.display.noteColours.hint')} below={<NoteColourKey />} inline>
        <Toggle
          label={copy('settings.display.noteColours')}
          checked={settings.display.noteColours === true}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { noteColours: v }))}
        />
      </Row>
      <Row label={copy('settings.display.showHeard')} hint={copy('settings.display.showHeard.hint')} inline>
        <Toggle
          label={copy('settings.display.showHeard')}
          checked={settings.display.showHeard === true}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { showHeard: v }))}
        />
      </Row>
      </Group>
    </Section>
  );
}

export function PracticeSection() {
  const s = useSettingsServices();
  const settings = useReadable(s.settings);
  const prefs = settings.practicePrefs;
  // The starting-pitch switch only means something for a voice (PLAN R7; 01-ux §10): other instruments show nothing.
  const isVoice = s.configs.instrumentById[settings.practice.instrumentId]?.family === 'voice';
  return (
    <Section id="practice" title={copy('settings.section.practice')}>
      <Group>
      {isVoice ? (
        <Row label={copy('settings.practice.autoReference')} hint={copy('settings.practice.autoReference.hint')} inline>
          <Toggle
            label={copy('settings.practice.autoReference')}
            checked={settings.practice.autoReference !== false}
            onChange={(v) => s.settings.set(patchSection(settings, 'practice', { autoReference: v }))}
          />
        </Row>
      ) : null}
      <Row label={copy('settings.practice.beatLine')} hint={copy('settings.practice.beatLine.hint')} inline>
        <Toggle
          label={copy('settings.practice.beatLine')}
          checked={settings.display.beatLine !== false}
          onChange={(v) => s.settings.set(patchSection(settings, 'display', { beatLine: v }))}
        />
      </Row>
      <Row label={copy('settings.practice.stars')} inline>
        <Toggle
          label={copy('settings.practice.stars')}
          checked={prefs.showStars}
          onChange={(v) => s.settings.set(patchSection(settings, 'practicePrefs', { showStars: v }))}
        />
      </Row>
      <Row label={copy('settings.practice.tips')} inline>
        <Toggle
          label={copy('settings.practice.tips')}
          checked={prefs.showTips}
          onChange={(v) => s.settings.set(patchSection(settings, 'practicePrefs', { showTips: v }))}
        />
      </Row>
      <Row label={copy('settings.practice.beta')} inline>
        <Toggle
          label={copy('settings.practice.beta')}
          checked={prefs.showBeta}
          onChange={(v) => s.settings.set(patchSection(settings, 'practicePrefs', { showBeta: v }))}
        />
      </Row>
      {s.runPlacement ? (
        <Row label={copy('action.runPlacementAgain')} hint={text('settings.placement.hint')} inline>
          <Button label={copy('action.runPlacementAgain')} variant="secondary" onClick={() => s.runPlacement?.()} />
        </Row>
      ) : null}
      </Group>
    </Section>
  );
}

export function AccessibilitySection() {
  const s = useSettingsServices();
  const settings = useReadable(s.settings);
  const a = settings.accessibility;
  return (
    <Section id="accessibility" title={copy('settings.section.accessibility')}>
      <Group>
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
      <Row label={copy('settings.accessibility.highContrast')} inline>
        <Toggle
          label={copy('settings.accessibility.highContrast')}
          checked={a.highContrast}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { highContrast: v }))}
        />
      </Row>
      <Row label={copy('settings.accessibility.shortcuts')} inline>
        <Toggle
          label={copy('settings.accessibility.shortcuts')}
          checked={a.keyboardShortcuts}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { keyboardShortcuts: v }))}
        />
      </Row>
      <Row label={copy('settings.accessibility.announce')} inline>
        <Toggle
          label={copy('settings.accessibility.announce')}
          checked={a.announceResults}
          onChange={(v) => s.settings.set(patchSection(settings, 'accessibility', { announceResults: v }))}
        />
      </Row>
      </Group>
    </Section>
  );
}
