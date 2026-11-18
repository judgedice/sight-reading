/** Settings > About (04 section 5.11): versions, the privacy line, and the link to credits. */
import { Link } from '../../router.tsx';
import { copy } from '../../../ui/copy/copy.ts';
import { Section, Row } from './Section.tsx';
import { useSettingsServices } from './context.ts';

export function AboutSection() {
  const s = useSettingsServices();
  const a = s.about;
  return (
    <Section id="about" title={copy('settings.section.about')}>
      {a.iosBeta ? <p className="set-beta">{copy('app.beta')}</p> : null}
      <Row label={copy('settings.about.app')}>
        <span>{a.appVersion}</span>
      </Row>
      <Row label={copy('settings.about.corpus')}>
        <span>{a.corpusVersion}</span>
      </Row>
      <Row label={copy('settings.about.config')}>
        <span>{a.configVersion}</span>
      </Row>
      <p className="set-privacy">{copy('settings.about.privacy')}</p>
      <Row label={copy('common.credits')}>
        <Link to="/credits" className="set-link">
          {copy('common.credits')}
        </Link>
      </Row>
    </Section>
  );
}
