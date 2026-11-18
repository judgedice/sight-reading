/**
 * Reserved `kv` keys (01 section 11). These are device-local: they are never exported, and import keeps them.
 */

/** The AppSettings document, kept in the `kv` store so the database has the four stores 01 section 11 lists. */
export const KV_SETTINGS = 'settings';
/** Storage-loss marker `{ installId, createdAt, hadProfile }` (05 W12). */
export const KV_INSTALL = 'install';
/** Set once `navigator.storage.persist()` has been requested (05 W12). */
export const KV_PERSIST_REQUESTED = 'persistRequested';

export const RESERVED_KV_KEYS: readonly string[] = [KV_SETTINGS, KV_INSTALL, KV_PERSIST_REQUESTED];

export function isReservedKvKey(key: string): boolean {
  return RESERVED_KV_KEYS.includes(key);
}
