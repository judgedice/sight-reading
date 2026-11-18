import { copy } from '../../ui/copy/copy.ts';
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

/** Shown for a path no route matches (a stale bookmark or a mistyped hash). */
export function NotFoundScreen({ route }: ScreenProps) {
  return (
    <section className="not-found" data-testid="screen-not-found" data-route-id={route.def.id}>
      <h1>{copy('notFound.title')}</h1>
      <p>{copy('notFound.body')}</p>
      <p>
        <a href={hashFromPath('/')}>{copy('notFound.action')}</a>
      </p>
    </section>
  );
}
