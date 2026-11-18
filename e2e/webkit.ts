// WebKit projects for every Playwright config (01 P21, 05 section 9 IOS7). The sandbox has no WebKit install (and
// `playwright install` is not run there), so they are opt-in: IOS_WEBKIT=1 adds them. CI sets it after installing WebKit.
// WebKit has no fake microphone, so the audio paths use the synthetic capture source (`?synthCapture=<ms>`, e2e/synthetic)
// or the practise-without-listening path; specs that need Chromium's fake capture file stay Chromium-only.
import { devices, type Project } from '@playwright/test';

export const webkitEnabled = process.env['IOS_WEBKIT'] === '1';

export type WebkitName = 'desktop' | 'iphone' | 'ipad';

const descriptors = {
  desktop: { name: 'webkit', device: 'Desktop Safari' },
  iphone: { name: 'webkit-iphone', device: 'iPhone 14' },
  ipad: { name: 'webkit-ipad', device: 'iPad Pro 11' },
} as const;

/** WebKit projects for the given form factors; an empty list unless IOS_WEBKIT=1. `extra` is merged into each project. */
export function webkitProjects(which: readonly WebkitName[] = ['desktop'], extra: Partial<Project> = {}): Project[] {
  if (!webkitEnabled) return [];
  return which.map((k) => ({ name: descriptors[k].name, ...extra, use: { ...devices[descriptors[k].device], ...extra.use } }));
}
