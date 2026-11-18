import { useEffect, useRef, type ReactNode } from 'react';
import { copy } from '../ui/copy/copy.ts';
import { Glyph, GlyphSprite } from '../ui/primitives/index.ts';
import { Link, useRoute } from './router.tsx';
import { TABS } from './routes.tsx';
import { START_BUTTON_ID } from './screens/Placeholder.tsx';

export interface ShellProps {
  /** Shows the "iOS: beta" badge next to the brand (05). */
  showBetaBadge?: boolean;
  children: ReactNode;
}


/** App bar, tab bar, skip link and the main landmark (04 section 3.2). */
export function Shell({ showBetaBadge = false, children }: ShellProps) {
  const route = useRoute();
  const { def } = route;
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const chromeless = def.chrome === 'none';

  // Document title follows the route.
  useEffect(() => {
    const screen = def.titleKey ? copy(def.titleKey) : route.path;
    document.title = [screen, copy('app.name')].join(' | ');
  }, [def, route.path]);

  // After a route change, put focus on <main> unless the new screen already took it (2.4.3).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [route.path, def.id]);

  return (
    <div className="app-shell" data-testid="app-placeholder" data-chrome={chromeless ? 'none' : 'full'}>
      <GlyphSprite />
      {def.id === 'home' ? (
        <button
          type="button"
          className="app-skip-link"
          onClick={() => document.getElementById(START_BUTTON_ID)?.focus()}
        >
          {copy('nav.skipToStart')}
        </button>
      ) : null}
      {chromeless ? null : (
        <header className="app-bar">
          <Link to="/" className="app-brand">
            <span>{copy('app.name')}</span>
            {showBetaBadge ? <span className="app-beta">{copy('app.beta')}</span> : null}
          </Link>
          <nav className="app-tabs" aria-label={copy('app.name')}>
            {TABS.map((tab) => (
              <Link
                key={tab.id}
                to={tab.path}
                className="app-tab"
                {...(def.tab === tab.id ? { 'aria-current': 'page' as const } : {})}
              >
                {copy(tab.labelKey)}
              </Link>
            ))}
          </nav>
          <Link
            to="/settings"
            className="app-gear"
            aria-label={copy('nav.settings')}
            {...(def.id === 'settings' ? { 'aria-current': 'page' as const } : {})}
          >
            <Glyph id="settings" />
          </Link>
        </header>
      )}
      <main ref={mainRef} id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
