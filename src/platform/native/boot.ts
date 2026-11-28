/**
 * Native composition (PLAN R83; docs/native/AUDIO-DESIGN.md section 4). `src/app/main.tsx` imports this file on demand
 * when it runs inside the Tauri shell, so it is its own chunk and a browser never loads it (or `@tauri-apps/api`).
 * It builds the backend over the engine's commands, the capabilities, the capture channel the session hands the DSP
 * worker, and the configs with the native calibration floor.
 */
import type { KeyValue, MessagePortLike, PlatformCapabilities, StoreRepos } from '../../core/platform.ts';
import type { Configs, OutputMode } from '../../core/types.ts';
import { NativeAudioBackend } from './audio/native-audio-backend.ts';
import { TauriNativeIpc, type DebugHooks, type NativeIpc } from './audio/ipc.ts';
import { nativeCapabilities } from './capabilities.ts';
import { NativeCalibration } from './calibration.ts';
import { createNativeFileSaver, installLinkHandler, NativeWakeLock, originOf } from './files.ts';
import { tauriInvoke, type Invoke } from './files-ipc.ts';
import type { FileSaver } from '../../core/save-file.ts';

/**
 * `calibration.loopback.minRtlMs` on native, ms (PLAN R86): routes with an interface can measure below the web's 15.
 * Owner to confirm after the first measurements on real hardware.
 */
export const NATIVE_LOOPBACK_MIN_RTL_MS = 3;

/** A copy of the configs whose loopback calibration floor is the native one; `config/*.json` and the web values stay as they are. */
export function nativeConfigs(configs: Configs): Configs {
  const cal = configs.budget.calibration;
  return { ...configs, budget: { ...configs.budget, calibration: { ...cal, loopback: { ...cal.loopback, minRtlMs: NATIVE_LOOPBACK_MIN_RTL_MS } } } };
}

export interface NativeBootOptions {
  /** What `readBrowserCapabilities` found: OS family, display mode, wake lock, storage grant. */
  base: Pick<PlatformCapabilities, 'osFamily' | 'displayMode' | 'wakeLock' | 'persistentStorage'>;
  configs: Configs;
  outputMode: OutputMode;
  /** Tests inject `FakeNativeIpc`; the app uses the Tauri one. */
  ipc?: NativeIpc;
  /** The app's key-value store and repos: with both, the boot carries the native calibration service. */
  kv?: KeyValue;
  repos?: Pick<StoreRepos, 'calibrations'>;
  /** Tests inject the command caller of the file, link and keep-awake services; the app uses Tauri's. */
  invoke?: Invoke;
}

/** The non-audio services of the shell (src-tauri/src/files.rs). */
export interface NativeFiles {
  /** For `setNativeFileSaver` (the save seam). */
  saveFile: FileSaver;
  /** For the keep-awake controller: the engine's sleep lock in place of `navigator.wakeLock`. */
  wakeLock: NativeWakeLock;
  /** Sends http(s) and licence links to the engine. Call once, with the document. Returns the undo. */
  attach(doc: Document): () => void;
}

export interface NativeBoot {
  audio: NativeAudioBackend;
  /** The backend's own object: `outputLatencyReported` follows the engine's trust once it has opened. */
  capabilities: PlatformCapabilities;
  configs: Configs;
  /** The native calibration service (latency record, stale guard, short profile); absent without `kv` and `repos`. */
  calibration: NativeCalibration | null;
  /** The session's capture channel: blocks go from the main thread straight to the DSP worker. */
  createCaptureChannel: () => { port1: MessagePortLike; port2: unknown };
  /** The engine opens the OS default input; there is no device list to offer. */
  inputDevices(): Promise<{ id: string; label: string }[]>;
  /**
   * End-to-end hooks (the fake device started with `SR_E2E_HOOKS=1`): `enabled` lets the composition root expose its test
   * handles, `seed` fixes the session's excerpt choice. Off (and `seed` null) in every other run, and on any failure.
   */
  debugHooks(): Promise<DebugHooks>;
  files: NativeFiles;
}

export function bootNative(o: NativeBootOptions): NativeBoot {
  const capabilities = nativeCapabilities(o.base, null);
  const ipc = o.ipc ?? new TauriNativeIpc();
  const audio = new NativeAudioBackend({ ipc, capabilities, outputMode: o.outputMode });
  const invoke = o.invoke ?? tauriInvoke;
  return {
    files: {
      saveFile: createNativeFileSaver(invoke),
      wakeLock: new NativeWakeLock(invoke),
      attach(doc) {
        return installLinkHandler(doc, originOf(doc.location), invoke, (e) => console.error('link', e));
      },
    },
    audio,
    capabilities,
    configs: nativeConfigs(o.configs),
    calibration: o.kv && o.repos ? new NativeCalibration({ audio, kv: o.kv, repos: o.repos }) : null,
    createCaptureChannel: () => {
      const c = new MessageChannel();
      return { port1: c.port1 as unknown as MessagePortLike, port2: c.port2 };
    },
    inputDevices: async () => [],
    debugHooks: () => ipc.debugHooks().catch((): DebugHooks => ({ enabled: false, seed: null })),
  };
}
