/** The settings route (04 section 5.11): a section list beside the sections on wide screens, one page on phones. */
import { useEffect } from 'react';
import { copy } from '../../../ui/copy/copy.ts';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../route-match.ts';
import { Link } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { AboutSection } from './AboutSection.tsx';
import { DataSection } from './DataSection.tsx';
import { SettingsServicesContext, type SettingsServices } from './context.ts';
import { AccessibilitySection, AudioSection, DisplaySection, PracticeSection, ProfileSection } from './sections.tsx';
import { text } from './text.ts';
import './settings.css';

const SECTION_TITLE: Record<SettingsSection, Parameters<typeof copy>[0]> = {
  audio: 'settings.section.audio',
  display: 'settings.section.display',
  practice: 'settings.section.practice',
  accessibility: 'settings.section.accessibility',
  data: 'settings.section.data',
  about: 'settings.section.about',
};

export function SettingsScreen({ route, services }: ScreenProps & { services: SettingsServices }) {
  const section = route.params['section'] as SettingsSection | undefined;

  // A deep link (#/settings/data) brings its section to the top of the page.
  useEffect(() => {
    if (!section) return;
    document.getElementById(`settings-${section}`)?.scrollIntoView?.({ block: 'start' });
  }, [section]);

  return (
    <SettingsServicesContext.Provider value={services}>
      <section className="set-screen" data-testid="screen-settings" data-route-id={route.def.id}>
        <h1 className="set-title">{copy('settings.title')}</h1>
        <div className="set-layout">
          <nav className="set-nav" aria-label={copy('settings.title')}>
            <ul className="set-nav-list">
              <li>
                <Link to="/settings" className="set-nav-link" {...(section === undefined ? { 'aria-current': 'page' as const } : {})}>
                  {text('settings.nav.profile')}
                </Link>
              </li>
              {SETTINGS_SECTIONS.map((id) => (
                <li key={id}>
                  <Link to={`/settings/${id}`} className="set-nav-link" {...(section === id ? { 'aria-current': 'page' as const } : {})}>
                    {copy(SECTION_TITLE[id])}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="set-body">
            <ProfileSection />
            <AudioSection />
            <DisplaySection />
            <PracticeSection />
            <AccessibilitySection />
            <DataSection />
            <AboutSection />
          </div>
        </div>
      </section>
    </SettingsServicesContext.Provider>
  );
}
