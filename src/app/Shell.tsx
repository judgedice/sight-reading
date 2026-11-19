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

/** Five staff lines with one brass notehead on the third space (06 section 7). */
export function WordmarkMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="app-brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g stroke="var(--text)" strokeWidth="1.3" opacity="0.9">
        <path d="M1.5 4.5h21M1.5 8.25h21M1.5 12h21M1.5 15.75h21M1.5 19.5h21" />
      </g>
      <ellipse cx="13" cy="10.1" rx="3.6" ry="2.6" transform="rotate(-22 13 10.1)" fill="var(--brass)" />
    </svg>
  );
}

/**
 * The chrome around every screen (05 section 3.1):
 * - `full`: wordmark, centre tabs (a bottom bar on phones) and the settings gear;
 * - `onboarding`: the brand only; the welcome screen draws its own large one and steps 2 to 5 hold Back;
 * - `loop`: no app bar and no tabs; the screen's own toolbar has Home at left;
 * - `none`: nothing, for the take.
 * Plus the skip link, the main landmark, the document title and the screen change motion.
 */
export function Shell({ showBetaBadge = false, children }: ShellProps) {
  const route = useRoute();
  const { def } = route;
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const chrome = def.chrome;

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
    // A new screen opens at its top, not at the previous screen's scroll position.
    const page = document.scrollingElement;
    if (page) page.scrollTop = 0;
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [route.path, def.id]);

  const brand = (
    <>
      <WordmarkMark />
      <span className="app-brand-name">{copy('app.name')}</span>
      {showBetaBadge ? <span className="app-beta">{copy('app.beta')}</span> : null}
    </>
  );

  return (
    <div className="app-shell" data-testid="app-placeholder" data-chrome={chrome} data-route-id={def.id}>
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
      {chrome === 'full' ? (
        <header className="app-bar">
          <Link to="/" className="app-brand">
            {brand}
          </Link>
          <nav className="app-tabs" aria-label={copy('app.name')}>
            {TABS.map((tab) => (
              <Link
                key={tab.id}
                to={tab.path}
                className="app-tab"
                {...(def.tab === tab.id ? { 'aria-current': 'page' as const } : {})}
              >
                <Glyph id={tab.glyph} size={22} className="app-tab-icon" />
                <span>{copy(tab.labelKey)}</span>
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
      ) : null}
      {chrome === 'onboarding' ? (
        <header className="app-bar app-bar-brand">
          <span className="app-brand">{brand}</span>
        </header>
      ) : null}
      <main ref={mainRef} id="main" className="app-main" tabIndex={-1}>
        <div key={def.id} className="app-screen">
          {children}
        </div>
      </main>
    </div>
  );
}
