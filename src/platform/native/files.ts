/**
 * File, link and keep-awake services of the native shell (src-tauri/src/files.rs is the other half).
 *
 * - `createNativeFileSaver`: the saver the save seam (`core/save-file.ts`) uses inside the shell. The engine shows the
 *   system save dialog and writes the file; the page never names a path. Mobile answers `not-available`, which
 *   rejects like any failed save, so the screens show their export failure.
 * - `NativeWakeLock`: `navigator.wakeLock` is missing in WKWebView and WebKitGTK, so the keep-awake controller gets a
 *   wake lock that asks the engine (an OS sleep assertion on desktop, the screen flag on mobile).
 * - `classifyLink` and `installLinkHandler`: a webview ignores `target=_blank`. http(s) links to other origins open in the
 *   system browser (the capability allows only http and https); the licence texts of the bundle open in a window of
 *   their own (desktop).
 */
import type { SaveOutcome } from '../../core/save-file.ts';
import type { Invoke } from './files-ipc.ts';

/** The error a platform without the service rejects with (`src-tauri/src/files.rs` `NOT_AVAILABLE`). */
export const NOT_AVAILABLE = 'not-available';

/** The shape of `WakeLockLike` and `WakeLockSentinelLike` in `platform/web/ios/keep-awake.ts` (a native file may not import platform/web); the controller takes this structurally. */
export interface NativeWakeLockSentinel {
  readonly released: boolean;
  release(): Promise<void>;
}

const enc = new TextEncoder();

/** The request body of `save_file`: `u32 LE nameLen`, name, `u32 LE mimeLen`, type, then the bytes. */
export function encodeSaveRequest(name: string, mime: string, data: string | Uint8Array): Uint8Array {
  const n = enc.encode(name);
  const m = enc.encode(mime);
  const body = typeof data === 'string' ? enc.encode(data) : data;
  const out = new Uint8Array(4 + n.length + 4 + m.length + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, n.length, true);
  out.set(n, 4);
  view.setUint32(4 + n.length, m.length, true);
  out.set(m, 8 + n.length);
  out.set(body, 8 + n.length + m.length);
  return out;
}

/** The saver of the save seam over the engine's `save_file`. */
export function createNativeFileSaver(invoke: Invoke): (name: string, data: string | Uint8Array, mime: string) => Promise<SaveOutcome> {
  return async (name, data, mime) => {
    const reply = await invoke('save_file', encodeSaveRequest(name, mime, data));
    if (reply === 'saved' || reply === 'cancelled') return reply;
    throw new Error(`save_file: unexpected reply ${JSON.stringify(reply)}`);
  };
}

/**
 * A wake lock that is one engine-wide lock behind the `navigator.wakeLock` shape. Calls to the engine go one after the
 * other, so a release followed at once by a request cannot arrive in the other order.
 */
export class NativeWakeLock {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly invoke: Invoke) {}

  private send(on: boolean): Promise<void> {
    const next = this.chain.then(
      () => this.invoke('keep_awake', { on }),
      () => this.invoke('keep_awake', { on }),
    );
    this.chain = next.catch(() => undefined);
    return next.then(() => undefined);
  }

  async request(): Promise<NativeWakeLockSentinel> {
    await this.send(true);
    let released = false;
    const send = (on: boolean): Promise<void> => this.send(on);
    return {
      get released() {
        return released;
      },
      async release() {
        if (released) return;
        released = true;
        await send(false);
      },
    };
  }
}

/** What a click on a link should do inside the shell. */
export type LinkAction = { kind: 'external'; url: string } | { kind: 'licence'; name: string };

/** `scheme//host[:port]`: `URL.origin` is the string "null" for a custom scheme such as `tauri:`, so it is built by hand. */
export function originOf(u: { protocol: string; host: string }): string {
  return `${u.protocol}//${u.host}`;
}

const LICENCE_PATH = /(?:^|\/)LICENSES\/([A-Za-z0-9][A-Za-z0-9.-]*\.txt)$/;

/**
 * Classifies a link's resolved `href` against the app's own origin. http(s) to another origin: the system browser.
 * A `LICENSES/<name>.txt` of the app's origin: the licence window. Anything else (hash routes, mailto, ...): `null`,
 * the webview's own behaviour.
 */
export function classifyLink(href: string, appOrigin: string): LinkAction | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const sameApp = originOf(url) === appOrigin;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !sameApp) return { kind: 'external', url: url.href };
  if (sameApp) {
    const m = LICENCE_PATH.exec(url.pathname);
    if (m?.[1] && !m[1].includes('..')) return { kind: 'licence', name: m[1] };
  }
  return null;
}

export interface LinkTarget {
  addEventListener(type: 'click', listener: (e: MouseEvent) => void, capture: boolean): void;
  removeEventListener(type: 'click', listener: (e: MouseEvent) => void, capture: boolean): void;
}

/** Sends the clicks on `a[href]` that `classifyLink` knows to the engine. Returns the function that removes the handler. */
export function installLinkHandler(doc: LinkTarget, appOrigin: string, invoke: Invoke, onError: (e: unknown) => void = () => undefined): () => void {
  const onClick = (e: MouseEvent): void => {
    if (e.defaultPrevented || e.button !== 0) return;
    const el = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!(el instanceof HTMLAnchorElement)) return;
    const action = classifyLink(el.href, appOrigin);
    if (!action) return;
    e.preventDefault();
    const sent = action.kind === 'external' ? invoke('plugin:opener|open_url', { url: action.url }) : invoke('open_licence', { name: action.name });
    sent.catch(onError);
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
