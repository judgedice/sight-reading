/**
 * Storage-loss detector (05 W12). A marker `{ installId, createdAt, hadProfile }` lives in `kv`; its `installId` is
 * mirrored in a second storage area (localStorage on web). Safari can delete one and keep the other, or delete
 * IndexedDB wholesale after 7 days away. Pure: the mirror, ids and clock are injected.
 */
import type { KeyValue, StoreRepos } from '../core/platform.ts';
import { KV_INSTALL } from './keys.ts';

/** A second, independently evictable copy of the install id. */
export interface InstallMirror {
  get(): string | null;
  set(installId: string): void;
}

export interface StorageLossDeps {
  kv: KeyValue;
  repos: Pick<StoreRepos, 'profile'>;
  mirror: InstallMirror;
  /** UUID. */
  idGen(): string;
  /** ISO 8601 UTC. */
  clockWall(): string;
}

export type InstallMarker = { installId: string; createdAt: string; hadProfile: boolean };

/** `first-run`: nothing existed, markers written. `ok`. `lost`: show the storage-loss card with [Import backup]. */
export type StorageStatus = { status: 'first-run' | 'ok' | 'lost'; installId: string | null };

function parseMarker(v: unknown): InstallMarker | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o['installId'] !== 'string' || typeof o['createdAt'] !== 'string') return null;
  return { installId: o['installId'], createdAt: o['createdAt'], hadProfile: o['hadProfile'] === true };
}

async function writeFresh(d: StorageLossDeps, hadProfile: boolean): Promise<string> {
  const installId = d.idGen();
  const marker: InstallMarker = { installId, createdAt: d.clockWall(), hadProfile };
  await d.kv.set(KV_INSTALL, marker);
  d.mirror.set(installId);
  return installId;
}

/** Call once at start-up, before any screen reads data. */
export async function checkStorage(d: StorageLossDeps): Promise<StorageStatus> {
  const marker = parseMarker(await d.kv.get(KV_INSTALL));
  const mirrored = d.mirror.get();
  const profile = await d.repos.profile.get();

  if (!marker && mirrored === null) {
    return { status: 'first-run', installId: await writeFresh(d, profile !== undefined) };
  }
  if (!marker || mirrored === null || marker.installId !== mirrored) {
    return { status: 'lost', installId: marker?.installId ?? mirrored };
  }
  if (!profile && marker.hadProfile) return { status: 'lost', installId: marker.installId };
  if (profile && !marker.hadProfile) await d.kv.set(KV_INSTALL, { ...marker, hadProfile: true });
  return { status: 'ok', installId: marker.installId };
}

/** After the player imports a backup or dismisses the card: start a fresh marker pair. */
export async function acknowledgeStorageLoss(d: StorageLossDeps): Promise<string> {
  return writeFresh(d, (await d.repos.profile.get()) !== undefined);
}
