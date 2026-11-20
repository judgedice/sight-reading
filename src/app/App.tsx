import './app.css';
import '../ui/tokens.css';
import '../ui/note-colours.css';
import '../ui/primitives/primitives.css';
import { AppearanceProvider, type AppearanceSettings } from './appearance.tsx';
import { RouterProvider, useRoute, type LocationSource } from './router.tsx';
import { routeTable, type RouteDef } from './routes.tsx';
import { Shell } from './Shell.tsx';
import { ToastProvider } from '../ui/primitives/index.ts';

export interface AppProps {
  /** Appearance from the settings store; the composition root passes it. Defaults: system, no contrast, system motion. */
  appearance?: AppearanceSettings;
  /** Replace the table to swap placeholders for real screens (see createRouteTable). */
  table?: readonly RouteDef[];
  /** Resolve dev-only routes. Defaults to the build's DEV flag. */
  dev?: boolean;
  /** Test seam for the hash. */
  location?: LocationSource;
  showBetaBadge?: boolean;
  /** True while a take's result is open; `#/practice/tips` goes to it (else to Practice). Defaults to none open. */
  resultOpen?: () => boolean;
}

function Screen() {
  const route = useRoute();
  const { Screen: Current } = route.def;
  return <Current route={route} />;
}

function Providers({ showBetaBadge }: { showBetaBadge: boolean }) {
  const route = useRoute();
  // No toast during a take (04 section 7.5, 8.4).
  return (
    <ToastProvider suppressed={route.def.id === 'practice.play'}>
      <Shell showBetaBadge={showBetaBadge}>
        <Screen />
      </Shell>
    </ToastProvider>
  );
}

export function App({ appearance, table = routeTable, dev, location, showBetaBadge = false, resultOpen }: AppProps) {
  return (
    <AppearanceProvider {...(appearance ? { settings: appearance } : {})}>
      <RouterProvider table={table} {...(dev !== undefined ? { dev } : {})} {...(location ? { source: location } : {})} {...(resultOpen ? { resultOpen } : {})}>
        <Providers showBetaBadge={showBetaBadge} />
      </RouterProvider>
    </AppearanceProvider>
  );
}
