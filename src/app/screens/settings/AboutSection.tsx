/** Settings > About (04 section 5.11): versions, the privacy line, and the link to credits. */
import { Link } from '../../router.tsx';
import { copy } from '../../../ui/copy/copy.ts';
import { Group, Row, Section } from './Section.tsx';
import { useSettingsServices } from './context.ts';

export function AboutSection() {
  const s = useSettingsServices();
  const a = s.about;
  return (
    <Section id="about" title={copy('settings.section.about')}>
      <Group>
        {a.iosBeta ? <p className="set-beta">{copy('app.beta')}</p> : null}
        <p className="set-privacy">{copy('settings.about.privacy')}</p>
        <Row label={copy('common.credits')} inline>
          <Link to="/credits" className="set-link">
            {copy('common.credits')}
          </Link>
        </Row>
        <details className="set-details">
          <summary className="set-summary">{copy('settings.about.technical')}</summary>
          <dl className="set-facts">
            <dt>{copy('settings.about.app')}</dt>
            <dd>{a.appVersion}</dd>
            <dt>{copy('settings.about.corpus')}</dt>
            <dd>{a.corpusVersion}</dd>
            <dt>{copy('settings.about.config')}</dt>
            <dd>{a.configVersion}</dd>
          </dl>
        </details>
      </Group>
    </Section>
  );
}
