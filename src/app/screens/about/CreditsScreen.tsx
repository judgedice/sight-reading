/** The credits route (04 section 5.12): every collection with its licences, and a TASL entry for each CC BY work. */
import { useEffect, useState } from 'react';
import type { AttributionsFile, Licence } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { Link } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { licenceLabel } from './attribution.ts';
import type { CreditsServices } from './services.ts';
import { text } from './text.ts';
import './about.css';

export function CreditsScreen({ services }: { services: CreditsServices } & ScreenProps) {
  const [att, setAtt] = useState<AttributionsFile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    services.loadAttributions().then(
      (a) => live && setAtt(a),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [services]);

  const rights = services.rightsContact
    ? `mailto:${services.rightsContact}?subject=${encodeURIComponent(text('credits.rightsProblem.subject'))}`
    : null;

  return (
    <section className="cred-screen" data-testid="screen-credits" data-route-id="credits">
      <h1 className="cred-title">{copy('common.credits')}</h1>
      <p>{text('credits.intro')}</p>

      {failed ? <p role="alert">{text('source.unavailable')}</p> : null}
      {!att && !failed ? <p role="status">{text('source.loading')}</p> : null}

      {att ? (
        <>
          <Card className="cred-card">
            <h2 className="cred-heading">{text('credits.collections')}</h2>
            <ul className="cred-list">
              {att.collections.map((c) => (
                <li key={c.corpus}>
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    {c.name}
                  </a>
                  <p className="cred-muted">
                    {text('credits.collection.licences', {
                      licences: c.licenses.map((l: Licence) => licenceLabel(l)).join(', '),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="cred-card">
            <h2 className="cred-heading">{text('credits.works')}</h2>
            {att.items.length === 0 ? (
              <p>{text('credits.works.none')}</p>
            ) : (
              <ol className="cred-list">
                {att.items.map((i) => (
                  <li key={i.id} className="cred-work">
                    <span className="cred-work-title">{i.title}</span>
                    <p className="cred-muted">{text('credits.work.by', { creator: i.creator })}</p>
                    {i.changes.length > 0 ? (
                      <p className="cred-muted">{text('credits.work.changes', { changes: i.changes.join(', ') })}</p>
                    ) : null}
                    <p className="cred-links">
                      <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {text('credits.link.source')}
                      </a>{' '}
                      <a href={i.licenseUrl} target="_blank" rel="noopener noreferrer">
                        {text('credits.link.licence')}
                      </a>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      ) : null}

      <p className="cred-links">
        <Link to="/settings/about">{text('credits.back')}</Link>
        {rights ? (
          <>
            {' · '}
            <a href={rights}>{copy('credits.reportProblem')}</a>
          </>
        ) : null}
      </p>
    </section>
  );
}
