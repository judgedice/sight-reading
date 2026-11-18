import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, SW_SCRIPT_URL, type SwContainerLike, type SwRegistrationLike, type SwWorkerLike } from './register.ts';

class FakeWorker implements SwWorkerLike {
  state = 'installing';
  readonly messages: unknown[] = [];
  private readonly listeners: (() => void)[] = [];
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }
  become(state: string): void {
    this.state = state;
    for (const l of this.listeners) l();
  }
}

class FakeRegistration implements SwRegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  private readonly listeners: (() => void)[] = [];
  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.listeners.push(listener);
  }
  fireUpdateFound(): void {
    for (const l of this.listeners) l();
  }
}

class FakeContainer implements SwContainerLike {
  controller: unknown | null = null;
  readonly registrations: { url: string; scope?: string | undefined }[] = [];
  readonly registration = new FakeRegistration();
  registerError: unknown = null;
  private readonly controllerListeners: (() => void)[] = [];
  async register(url: string, options?: { scope?: string }): Promise<SwRegistrationLike> {
    this.registrations.push({ url, scope: options?.scope });
    if (this.registerError) throw this.registerError;
    return this.registration;
  }
  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.controllerListeners.push(listener);
  }
  takeControl(): void {
    for (const l of this.controllerListeners) l();
  }
}

const supported = { serviceWorker: true };

describe('registerServiceWorker', () => {
  it('does nothing when the platform has no service worker (capabilities gate)', async () => {
    const container = new FakeContainer();
    const reload = vi.fn();
    const result = await registerServiceWorker({
      container,
      capabilities: { serviceWorker: false },
      reload,
      onUpdateReady: vi.fn(),
    });
    expect(result).toBeNull();
    expect(container.registrations).toEqual([]);
  });

  it('does nothing when navigator.serviceWorker is absent', async () => {
    const result = await registerServiceWorker({
      container: undefined,
      capabilities: supported,
      reload: vi.fn(),
      onUpdateReady: vi.fn(),
    });
    expect(result).toBeNull();
  });

  it('registers ./sw.js with a relative scope, so it works under any subpath', async () => {
    const container = new FakeContainer();
    await registerServiceWorker({ container, capabilities: supported, reload: vi.fn(), onUpdateReady: vi.fn() });
    expect(container.registrations).toEqual([{ url: SW_SCRIPT_URL, scope: './' }]);
    expect(SW_SCRIPT_URL).toBe('./sw.js');
  });

  it('reports a failed registration and resolves null instead of throwing', async () => {
    const container = new FakeContainer();
    const error = new TypeError('no worker in dev');
    container.registerError = error;
    const onError = vi.fn();
    const result = await registerServiceWorker({
      container,
      capabilities: supported,
      reload: vi.fn(),
      onUpdateReady: vi.fn(),
      onError,
    });
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('a first install (no previous controller) does not prompt or reload', async () => {
    const container = new FakeContainer();
    const reload = vi.fn();
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, capabilities: supported, reload, onUpdateReady });
    container.takeControl();
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('offers a waiting build as an update, and applies it with SKIP_WAITING then reloads once', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    const reload = vi.fn();
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, capabilities: supported, reload, onUpdateReady });

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    const apply = onUpdateReady.mock.calls[0]![0] as () => void;
    apply();
    expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);

    container.takeControl();
    container.takeControl();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('prompts when a new worker finishes installing while the page is controlled', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, capabilities: supported, reload: vi.fn(), onUpdateReady });

    const installing = new FakeWorker();
    container.registration.installing = installing;
    container.registration.fireUpdateFound();
    installing.become('installing');
    expect(onUpdateReady).not.toHaveBeenCalled();
    installing.become('installed');
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it('does not prompt for a first install that finishes with no controller', async () => {
    const container = new FakeContainer();
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, capabilities: supported, reload: vi.fn(), onUpdateReady });
    const installing = new FakeWorker();
    container.registration.installing = installing;
    container.registration.fireUpdateFound();
    installing.become('installed');
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('offers the same waiting worker only once', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ container, capabilities: supported, reload: vi.fn(), onUpdateReady });
    container.registration.installing = waiting;
    container.registration.fireUpdateFound();
    waiting.become('installed');
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });
});
