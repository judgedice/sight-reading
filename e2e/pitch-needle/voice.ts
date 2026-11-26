// The synthetic untrained voice the steady pitch needle specs sing into Chromium's fake microphone (round 3,
// docs/redesign/round3/03-pitch-steadiness.md): a held note that starts with a scoop from 200 c below over 250 ms and
// then wobbles about ±22 c at 3.3 Hz around `centreCents` from the target (the owner's median figures, §2), with a
// little vocal colour (eight harmonics, falling 6 dB an octave). No recording: generated here, written to test-results.
// Also the page-side seeding the specs use so they reach Match a note without the first-run setup.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import type { AppSettings, PitchSteadiness } from '../../src/core/types.ts';
import { defaultAppSettings } from '../../src/store/defaults.ts';
import { encodeWav } from '../../src/testkit/wav.ts';

export const VOICE_RATE = 48000;
/** Baritone's first Match a note target (the middle of its served range at difficulty 1). */
export const G3 = 55;

/** Cents against the target at `t` seconds into a note. */
export function voiceCents(t: number, centreCents: number): number {
  const scoop = t < 0.25 ? -200 * (1 - t / 0.25) : 0;
  return centreCents + scoop + 22 * Math.sin(2 * Math.PI * 3.3 * t);
}

/**
 * Writes the fake microphone's WAV: `notes` held notes of `holdSec`, each after 0.3 s of silence, and 0.5 s of silence
 * at the end. Chromium loops the file (unless the flag says %noloop), so any listening window meets a held note.
 */
export function writeVoiceWav(path: string, o: { midi: number; centreCents: number; holdSec?: number; notes?: number }): void {
  const hold = o.holdSec ?? 9;
  const notes = o.notes ?? 1;
  const noteLen = 0.3 + hold;
  const out = new Float32Array(Math.round((notes * noteLen + 0.5) * VOICE_RATE));
  for (let k = 0; k < notes; k++) {
    let ph = 0;
    const start = Math.round((k * noteLen + 0.3) * VOICE_RATE);
    const n = Math.round(hold * VOICE_RATE);
    for (let i = 0; i < n; i++) {
      const t = i / VOICE_RATE;
      const hz = 440 * 2 ** ((o.midi - 69 + voiceCents(t, o.centreCents) / 100) / 12);
      ph += (2 * Math.PI * hz) / VOICE_RATE;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(h * ph) / h;
      const env = Math.min(1, t / 0.04) * Math.min(1, (hold - t) / 0.06);
      out[start + i] = 0.05 * env * v;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: VOICE_RATE, channels: [out] }));
}

/**
 * Opens the app once, stores settings for a baritone who has finished setup (the microphone on, `steadiness` as the
 * Pitch needle setting, absent for the default), and reloads. Match a note itself stores nothing.
 */
export async function seedBaritone(page: Page, o: { steadiness?: PitchSteadiness; theme?: AppSettings['display']['theme'] } = {}): Promise<void> {
  const base = defaultAppSettings();
  const settings: AppSettings = {
    ...base,
    onboardingDone: true,
    practice: { ...base.practice, instrumentId: 'voice-baritone', listening: true, mode: 'practice', outputMode: 'wired' },
    display: { ...base.display, theme: o.theme ?? 'system', ...(o.steadiness ? { pitchSteadiness: o.steadiness } : {}) },
  };
  await page.goto('./');
  // The app has opened (and created) its store by the time the first-run screen shows.
  await page.getByTestId('screen-welcome').waitFor({ timeout: 30_000 });
  await page.evaluate(
    (s) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('srt');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.close();
            reject(new Error('the app store is not set up yet'));
            return;
          }
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(s, 'settings');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    settings,
  );
  await page.goto('./#/');
  await page.reload();
}

/** The phase of the Match a note body (`data-phase`), every animation frame, into `window.__phases`. */
export async function recordPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __phases: { t: number; phase: string; at: number | null }[] };
    w.__phases = [];
    const step = (): void => {
      const body = document.querySelector('.mt-body');
      const needle = document.querySelector<HTMLElement>('[data-testid="match-needle"]');
      if (body) w.__phases.push({ t: performance.now(), phase: body.getAttribute('data-phase') ?? '', at: needle ? Number(needle.dataset.at) : null });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export async function phases(page: Page): Promise<{ t: number; phase: string; at: number | null }[]> {
  return page.evaluate(() => (window as unknown as { __phases: { t: number; phase: string; at: number | null }[] }).__phases);
}
