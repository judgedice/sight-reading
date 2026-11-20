/** Services for the settings screen and its sections, plus the store hooks they share. */
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { KeyValue, StoreRepos } from '../../../core/platform.ts';
import type { AppSettings, Configs, PlayerProfile } from '../../../core/types.ts';
import type { Readable, Writable } from '../home/services.ts';
import type { SettingsDiagnosticsServices, SettingsSoundServices } from './services.ts';

export type { Readable };

export interface InputDevice {
  id: string;
  label: string;
}

/** About-page facts the composition root knows (05). */
export interface AboutInfo {
  appVersion: string;
  corpusVersion: string;
  configVersion: string;
  /** Shows "iOS: beta" under the title (05). */
  iosBeta: boolean;
}

export interface SettingsServices extends SettingsSoundServices, SettingsDiagnosticsServices {
  configs: Configs;
  repos: StoreRepos;
  kv: KeyValue;
  settings: Writable<AppSettings>;
  /** `set` saves the profile and refreshes everything that reads it. */
  profile: Writable<PlayerProfile | undefined>;
  about: AboutInfo;
  /** The device's local calendar day, YYYY-MM-DD: names the export file. */
  localDay(): string;
  /**
   * Called after an import or a delete replaced the stores. The composition root refreshes its stores and calls
   * acknowledgeStorageLoss (store/storage-loss.ts) so the install marker matches the new data.
   */
  onDataReplaced(): void | Promise<void>;
  /** Input devices for the device select. Omitted: only the system default is offered. */
  listInputDevices?(): Promise<InputDevice[]>;
  /** Bytes this origin uses, or null when the browser does not say. Omitted: the row is not shown. */
  storageUsed?(): Promise<number | null>;
  /** Opens the placement flow (02 section 5.1). Omitted: the action is not shown. */
  runPlacement?(): void;
  /** Caches the corpus for offline use (05). Omitted: the action is not shown. */
  downloadMusic?(): Promise<void>;
  /** Address for "Report a rights problem" on the credits page. */
  rightsContact?: string;
}

export const SettingsServicesContext = createContext<SettingsServices | null>(null);

export function useSettingsServices(): SettingsServices {
  const s = useContext(SettingsServicesContext);
  if (!s) throw new Error('Settings needs SettingsServicesContext');
  return s;
}

/** A store value that re-renders on change. `get` must return a stable value between changes. */
export function useReadable<T>(r: { get(): T; subscribe(l: () => void): () => void }): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

/** As `useReadable`, for an optional store: undefined while the root does not provide it. */
export function useOptionalReadable<T>(r: Readable<T> | undefined): T | undefined {
  const subscribe = useCallback((l: () => void) => (r ? r.subscribe(l) : () => undefined), [r]);
  const get = useCallback(() => r?.get(), [r]);
  return useSyncExternalStore(subscribe, get, get);
}
