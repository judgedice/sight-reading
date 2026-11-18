/**
 * Page-side service worker registration and update prompt (P19; 01 section 6.2, 13.4).
 *
 * Registration happens only when `capabilities.serviceWorker` is true (05 section 3, the platform seam). The
 * composition root calls `registerServiceWorker` once at start-up. A new build waits; `onUpdateReady` receives an
 * `apply` function, and the UI calls it when the player accepts the update. `apply` tells the waiting worker to skip
 * waiting, and the page reloads once the new worker controls it.
 *
 * The script URL and scope are relative, so the worker and its cache work under any subpath (the build uses
 * `base: './'`).
 */
import type { PlatformCapabilities } from '../../../core/platform.ts';

export interface SwWorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface SwRegistrationLike {
  readonly installing: SwWorkerLike | null;
  readonly waiting: SwWorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/** The subset of `ServiceWorkerContainer` this module uses. A real `navigator.serviceWorker` satisfies it. */
export interface SwContainerLike {
  readonly controller: unknown | null;
  register(url: string, options?: { scope?: string }): Promise<SwRegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface RegisterOptions {
  /** `navigator.serviceWorker`, or undefined where it does not exist. */
  readonly container: SwContainerLike | undefined;
  readonly capabilities: Pick<PlatformCapabilities, 'serviceWorker'>;
  /** Reloads the page once the new worker takes control. The composition root passes `location.reload`. */
  readonly reload: () => void;
  /** Called once per waiting build. The UI shows the update prompt and calls `apply` on acceptance. */
  readonly onUpdateReady: (apply: () => void) => void;
  /** Called when registration fails (for example in dev, where no worker is built). The app keeps working without one. */
  readonly onError?: (error: unknown) => void;
  /** Defaults to './sw.js', resolved against the document. */
  readonly scriptUrl?: string;
}

/** The worker's file name in the build (vite.config.ts, `filename`). */
export const SW_SCRIPT_URL = './sw.js';

/**
 * Registers the worker when the platform supports it. Resolves to the registration, or null when registration is
 * skipped or fails. Never throws, so a failed registration cannot stop the app from booting.
 */
export async function registerServiceWorker(options: RegisterOptions): Promise<SwRegistrationLike | null> {
  const { container } = options;
  if (!options.capabilities.serviceWorker || container === undefined) return null;

  // A worker that claims a page without a previous controller must not reload it: the first visit has none.
  const hadController = container.controller !== null;
  let reloading = false;
  container.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    options.reload();
  });

  let registration: SwRegistrationLike;
  try {
    registration = await container.register(options.scriptUrl ?? SW_SCRIPT_URL, { scope: './' });
  } catch (error) {
    options.onError?.(error);
    return null;
  }

  let prompted: SwWorkerLike | null = null;
  const offer = (worker: SwWorkerLike): void => {
    if (prompted === worker) return;
    prompted = worker;
    options.onUpdateReady(() => worker.postMessage({ type: 'SKIP_WAITING' }));
  };

  if (registration.waiting && hadController) offer(registration.waiting);

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && container.controller !== null) offer(installing);
    });
  });

  return registration;
}
