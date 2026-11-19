// Routes the walk visits after onboarding, in tour order. `#/dev/components` is last (dev server only).
import { go } from '../design/helpers.ts';

export { go };

export const HASH_ROUTES_A11Y: readonly string[] = [
  '#/', '#/progress', '#/history', '#/settings', '#/settings/audio', '#/settings/display', '#/settings/practice',
  '#/settings/accessibility', '#/settings/data', '#/settings/about', '#/calibrate', '#/credits', '#/practice/tips', '#/practice/results',
  '#/no-such-page', '#/dev/components',
];
