import { describe, expect, it } from 'vitest';
import cargoToml from '../../../src-tauri/Cargo.toml?raw';
import tauriConf from '../../../src-tauri/tauri.conf.json';
import mainSource from '../../app/main.tsx?raw';
import enCopy from '../../ui/copy/en.json';

const APP_NAME = 'Sightread';

describe('the app is named and numbered the same everywhere', () => {
  it('has one name: the product, the window and the copy catalogue (the page title ends with it)', () => {
    expect(tauriConf.productName).toBe(APP_NAME);
    expect(tauriConf.app.windows[0]!.title).toBe(APP_NAME);
    expect(enCopy['app.name']).toBe(APP_NAME);
  });

  it('has one version: the bundle config, the Cargo package and the app constant', () => {
    const cargo = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(cargoToml)?.[1];
    const app = /const APP_VERSION = '([^']+)'/.exec(mainSource)?.[1];
    expect(cargo).toBeDefined();
    expect(tauriConf.version).toBe(cargo);
    expect(tauriConf.version).toBe(app);
  });
});

describe('the bundled origin cannot change between releases', () => {
  const win = tauriConf.app.windows[0] as { useHttpsScheme?: boolean };

  it('sets the scheme choice explicitly, to http (http://tauri.localhost on Windows and Android)', () => {
    // Changing it moves IndexedDB, localStorage and cookies to another origin: every player's data would be left behind.
    expect(win.useHttpsScheme).toBe(false);
  });

  it('keeps the content security policy in step with that choice (the IPC origin follows the scheme)', () => {
    const connect = tauriConf.app.security.csp['connect-src'];
    expect(connect).toContain('http://ipc.localhost');
    expect(connect).not.toContain('https://ipc.localhost');
  });
});
