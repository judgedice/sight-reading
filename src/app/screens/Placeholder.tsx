import '../../ui/components/form/form.css';
import { copy } from '../../ui/copy/copy.ts';
import { Glyph } from '../../ui/primitives/index.ts';
import './states/states.css';
import { hashFromPath } from '../route-match.ts';
import type { ScreenProps } from '../route-types.ts';

/** Home's Start target for the skip link (04 section 8.2). Later packages keep this id on their Start button. */
export const START_BUTTON_ID = 'start-practice';

/** Stand-in for every screen until its package lands. Shows the title and the matched path. */
export function PlaceholderScreen({ route }: ScreenProps) {
  const { def, path } = route;
  const title = def.titleKey ? copy(def.titleKey) : path;
  return (
    <section data-testid={`screen-${def.id}`} data-route-id={def.id}>
      <h1>{title}</h1>
      <p>{path}</p>
      {def.id === 'home' ? (
        <button type="button" id={START_BUTTON_ID}>
          {copy('action.start')}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Shown for a path no route matches (a stale bookmark or a mistyped hash): the error layout with one action, a real
 * link to Practice drawn as the hero button (not-found mockup).
 */
export function NotFoundScreen({ route }: ScreenProps) {
  return (
    <section className="err-screen not-found" data-testid="screen-not-found" data-route-id={route.def.id}>
      <span className="err-screen-icon" aria-hidden="true">
        <Glyph id="home" size={24} />
      </span>
      <h1 className="err-screen-heading">{copy('notFound.title')}</h1>
      <p className="err-screen-body">{copy('notFound.body')}</p>
      <div className="err-screen-actions">
        <a href={hashFromPath('/')} className="ui-button ui-button-primary ui-button-hero">
          <span>{copy('notFound.action')}</span>
        </a>
      </div>
    </section>
  );
}
