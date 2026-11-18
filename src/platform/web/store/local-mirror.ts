import type { InstallMirror } from '../../../store/storage-loss.ts';

export const INSTALL_MIRROR_KEY = 'srt.installId';

/** `localStorage` mirror of the install id (05 W12). Private modes that throw read as "absent" and ignore writes. */
export class LocalStorageMirror implements InstallMirror {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {}
  get(): string | null {
    try {
      return this.storage.getItem(INSTALL_MIRROR_KEY);
    } catch {
      return null;
    }
  }
  set(installId: string): void {
    try {
      this.storage.setItem(INSTALL_MIRROR_KEY, installId);
    } catch {
      /* storage unavailable */
    }
  }
}
