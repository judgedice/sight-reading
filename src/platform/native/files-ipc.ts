/**
 * The one place the file, link and keep-awake services touch `@tauri-apps/api` (the audio layer has its own in
 * `audio/ipc.ts`). Everything else in `files.ts` takes an `Invoke`, so tests run without Tauri.
 */
import { invoke } from '@tauri-apps/api/core';

/** `invoke` as the native services use it: a command name and a JSON object or raw bytes. */
export type Invoke = (cmd: string, args?: Record<string, unknown> | Uint8Array) => Promise<unknown>;

/** Tauri's `invoke`, with rejections (strings) turned into `Error`s. */
export const tauriInvoke: Invoke = async (cmd, args) => {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    throw e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
  }
};
