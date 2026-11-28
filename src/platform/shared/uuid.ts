/**
 * A version 4 UUID from `crypto.getRandomValues`. `crypto.randomUUID` needs a secure context; a webview that serves the
 * bundle from a custom scheme may not count as one, but `getRandomValues` is always there.
 */
export function uuidV4(getRandomValues: (a: Uint8Array) => Uint8Array): string {
  const b = getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

/** `crypto.randomUUID()` where the browser has it (the web build, unchanged), else `uuidV4`. */
export function randomId(c: { randomUUID?: () => string; getRandomValues: <T extends ArrayBufferView>(a: T) => T }): string {
  return typeof c.randomUUID === 'function' ? c.randomUUID() : uuidV4((a) => c.getRandomValues(a));
}
