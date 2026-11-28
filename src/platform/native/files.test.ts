import { describe, expect, it } from 'vitest';
import { classifyLink, createNativeFileSaver, encodeSaveRequest, installLinkHandler, NativeWakeLock, type LinkTarget } from './files.ts';

const ORIGIN = 'tauri://localhost';

describe('encodeSaveRequest', () => {
  it('frames name, type and bytes as the engine reads them', () => {
    const body = encodeSaveRequest('sightread-backup-2026-01-02.json', 'application/json', '{"é":1}');
    const view = new DataView(body.buffer);
    const nameLen = view.getUint32(0, true);
    expect(new TextDecoder().decode(body.subarray(4, 4 + nameLen))).toBe('sightread-backup-2026-01-02.json');
    const mimeLen = view.getUint32(4 + nameLen, true);
    expect(new TextDecoder().decode(body.subarray(8 + nameLen, 8 + nameLen + mimeLen))).toBe('application/json');
    expect(new TextDecoder().decode(body.subarray(8 + nameLen + mimeLen))).toBe('{"é":1}');
  });
  it('carries bytes as they are', () => {
    const body = encodeSaveRequest('a.bin', 'application/octet-stream', new Uint8Array([0, 255, 7]));
    expect([...body.subarray(body.length - 3)]).toEqual([0, 255, 7]);
  });
});

describe('the native saver (the save seam installs it in the shell)', () => {
  it('sends the file to the engine and reports its outcome', async () => {
    const calls: { cmd: string; len: number }[] = [];
    let reply: unknown = 'saved';
    const save = createNativeFileSaver(async (cmd, args) => {
      calls.push({ cmd, len: args instanceof Uint8Array ? args.length : -1 });
      return reply;
    });
    expect(await save('x.json', '{}', 'application/json')).toBe('saved');
    reply = 'cancelled';
    expect(await save('x.json', '{}', 'application/json')).toBe('cancelled');
    expect(calls.map((c) => c.cmd)).toEqual(['save_file', 'save_file']);
    expect(calls[0]!.len).toBeGreaterThan(2);
  });
  it('rejects when the engine refuses (mobile: not-available) or answers something unknown', async () => {
    const refuse = createNativeFileSaver(async () => Promise.reject(new Error('not-available')));
    await expect(refuse('x.json', '{}', 'application/json')).rejects.toThrow('not-available');
    const odd = createNativeFileSaver(async () => 'maybe');
    await expect(odd('x.json', '{}', 'application/json')).rejects.toThrow('unexpected reply');
  });
});

describe('NativeWakeLock', () => {
  it('asks the engine to hold the lock and to give it back, in order', async () => {
    const seen: boolean[] = [];
    const lock = new NativeWakeLock(async (_cmd, args) => {
      await new Promise((r) => setTimeout(r, seen.length === 0 ? 20 : 0));
      seen.push((args as { on: boolean }).on);
      return undefined;
    });
    const s = await lock.request();
    expect(s.released).toBe(false);
    const release = s.release();
    const again = lock.request();
    await release;
    await again;
    expect(seen).toEqual([true, false, true]);
    expect(s.released).toBe(true);
  });
  it('a refused request rejects (the controller then raises its hint)', async () => {
    await expect(new NativeWakeLock(async () => Promise.reject(new Error('no bus'))).request()).rejects.toThrow('no bus');
  });
});

describe('classifyLink', () => {
  it('sends other origins over http and https to the browser', () => {
    expect(classifyLink('https://creativecommons.org/licenses/by/4.0/', ORIGIN)).toEqual({ kind: 'external', url: 'https://creativecommons.org/licenses/by/4.0/' });
    expect(classifyLink('http://example.org/a', ORIGIN)).toEqual({ kind: 'external', url: 'http://example.org/a' });
  });
  it('opens the bundle licence texts, relative to the page or the dev server', () => {
    expect(classifyLink('tauri://localhost/LICENSES/CC0-1.0.txt', ORIGIN)).toEqual({ kind: 'licence', name: 'CC0-1.0.txt' });
    expect(classifyLink('http://tauri.localhost/LICENSES/OFL-1.1-Inter.txt', 'http://tauri.localhost')).toEqual({ kind: 'licence', name: 'OFL-1.1-Inter.txt' });
    expect(classifyLink('http://localhost:5173/LICENSES/ISC-Lucide.txt', 'http://localhost:5173')).toEqual({ kind: 'licence', name: 'ISC-Lucide.txt' });
  });
  it('leaves everything else to the webview', () => {
    for (const href of ['tauri://localhost/#/settings/about', 'mailto:a@b.c', 'javascript:alert(1)', 'tauri://localhost/other.txt', 'tauri://localhost/LICENSES/a.json', 'file:///etc/passwd', 'ftp://example.org/a', 'not a url']) {
      expect(classifyLink(href, ORIGIN), href).toBeNull();
    }
  });
});

describe('installLinkHandler', () => {
  function harness() {
    const sent: { cmd: string; args: unknown }[] = [];
    let handler: ((e: MouseEvent) => void) | null = null;
    const target: LinkTarget = {
      addEventListener: (_t, l) => {
        handler = l;
      },
      removeEventListener: () => {
        handler = null;
      },
    };
    const undo = installLinkHandler(target, ORIGIN, async (cmd, args) => void sent.push({ cmd, args }));
    const click = (href: string, init: MouseEventInit = {}): boolean => {
      const a = document.createElement('a');
      a.setAttribute('href', href);
      const span = document.createElement('span');
      a.appendChild(span);
      document.body.appendChild(a);
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
      Object.defineProperty(e, 'target', { value: span });
      handler?.(e);
      a.remove();
      return e.defaultPrevented;
    };
    return { sent, click, undo, active: () => handler !== null };
  }
  it('opens an external link in the system browser through the opener command and stops the webview', () => {
    const h = harness();
    expect(h.click('https://example.org/x')).toBe(true);
    expect(h.sent).toEqual([{ cmd: 'plugin:opener|open_url', args: { url: 'https://example.org/x' } }]);
  });
  it('opens a licence text through the licence command', () => {
    const h = harness();
    expect(h.click(`${ORIGIN}/LICENSES/CC-BY-4.0.txt`)).toBe(true);
    expect(h.sent).toEqual([{ cmd: 'open_licence', args: { name: 'CC-BY-4.0.txt' } }]);
  });
  it('lets in-app links, other buttons and other schemes alone', () => {
    const h = harness();
    expect(h.click('#/settings')).toBe(false);
    expect(h.click('mailto:a@b.c')).toBe(false);
    expect(h.click('https://example.org/x', { button: 1 })).toBe(false);
    expect(h.sent).toEqual([]);
    h.undo();
    expect(h.active()).toBe(false);
  });
});
