import type { KeyValue } from '../../../core/platform.ts';
import { KV_PERSIST_REQUESTED } from '../../../store/keys.ts';

export interface PersistApi {
  persist(): Promise<boolean>;
}

/**
 * Requests `navigator.storage.persist()` exactly once per install, to be called after the first completed attempt
 * (01 section 11, 05 W12). Returns the grant, or null when it was asked before or the API is missing.
 */
export async function requestPersistOnce(kv: KeyValue, storage: PersistApi | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage): Promise<boolean | null> {
  if (!storage || typeof storage.persist !== 'function') return null;
  if ((await kv.get(KV_PERSIST_REQUESTED)) !== undefined) return null;
  await kv.set(KV_PERSIST_REQUESTED, true);
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
