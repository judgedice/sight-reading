/**
 * Native platform seam (PLAN R83, docs/native/AUDIO-DESIGN.md section 4): the Tauri implementation of the interfaces in
 * `src/core/platform.ts`, beside `src/platform/web/`. It may import `src/platform/shared/` and the same layers
 * `src/platform/web/` may. `boot.ts` is the entry (`src/app/main.tsx` imports it on demand, as its own chunk);
 * `audio/ipc.ts` is the only file that imports `@tauri-apps/api`. Nothing imports this index.
 */
export type { NativeBoot, NativeBootOptions } from './boot.ts';
export type { NativeAudioBackendOptions } from './audio/native-audio-backend.ts';
export type { NativeIpc } from './audio/ipc.ts';
