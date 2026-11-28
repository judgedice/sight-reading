// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { saveFile, setNativeFileSaver } from './save-file.ts';

afterEach(() => setNativeFileSaver(null));

describe('saveFile', () => {
  it('without a native saver clicks a download link on a Blob URL, as the export sites did (the web path)', async () => {
    const clicks: string[] = [];
    const blobs: Blob[] = [];
    const orig = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = orig(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = () => clicks.push((el as HTMLAnchorElement).download);
      return el;
    }) as typeof document.createElement;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (b) => {
      blobs.push(b as Blob);
      return 'blob:x';
    };
    URL.revokeObjectURL = () => undefined;
    try {
      const p = saveFile('web.json', '{"a":1}');
      // The click is in the synchronous part, inside the caller's gesture.
      expect(clicks).toEqual(['web.json']);
      expect(await p).toBe('saved');
      expect(blobs[0]!.type).toBe('application/json');
      expect(blobs[0]!.size).toBe(7);
    } finally {
      document.createElement = orig;
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
    }
  });

  it('goes to the native saver once one is installed, with the bytes and the type', async () => {
    const got: unknown[] = [];
    setNativeFileSaver(async (name, data, mime) => {
      got.push([name, data, mime]);
      return 'cancelled';
    });
    expect(await saveFile('n.json', new Uint8Array([1, 2]), 'text/plain')).toBe('cancelled');
    expect(got).toEqual([['n.json', new Uint8Array([1, 2]), 'text/plain']]);
  });

  it('passes a failure of the native saver on', async () => {
    setNativeFileSaver(() => Promise.reject(new Error('not-available')));
    await expect(saveFile('n.json', '{}')).rejects.toThrow('not-available');
  });
});
