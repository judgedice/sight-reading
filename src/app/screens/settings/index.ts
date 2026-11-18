import { createElement } from 'react';
import type { ScreenOverrides } from '../../routes.tsx';
import type { ScreenComponent, ScreenProps } from '../../route-types.ts';
import { SettingsScreen } from './SettingsScreen.tsx';
import type { SettingsServices } from './context.ts';

export { SettingsScreen } from './SettingsScreen.tsx';
export type { SettingsServices, AboutInfo, InputDevice } from './context.ts';
export { exportBackupText, importBackupText, deleteAllData, backupFileName, importErrorText } from './data-io.ts';
export { patchSection, normalizeDisplayName, sizeParts, NAME_MAX, DELETE_WORD } from './model.ts';

/** The settings route screen with its services bound. Used for #/settings and #/settings/:section. */
export function createSettingsScreen(services: SettingsServices): ScreenComponent {
  return function BoundSettingsScreen(props: ScreenProps) {
    return createElement(SettingsScreen, { ...props, services });
  };
}

/** Route overrides for createRouteTable: replaces the settings placeholders (both settings routes share the id). */
export function settingsScreenOverrides(services: SettingsServices): ScreenOverrides {
  return { settings: createSettingsScreen(services) };
}
