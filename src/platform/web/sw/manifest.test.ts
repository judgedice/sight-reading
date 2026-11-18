// P19 manifest test (05 W14): standalone display, theme colour, relative start and scope, icons present at the
// declared sizes, a 180x180 opaque apple-touch-icon.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const publicDir = fileURLToPath(new URL('../../../../public/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${publicDir}manifest.webmanifest`, 'utf8')) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

/** Width, height, bit depth and colour type from a PNG's IHDR chunk. */
function pngHeader(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  const signature = bytes.subarray(0, 8).toString('hex');
  expect(signature).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

describe('manifest.webmanifest', () => {
  it('is installable as a standalone app with the brand colours', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBe('Sightread');
    expect(manifest.short_name).toBe('Sightread');
    expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('uses relative start_url, scope and id, so the app installs under any subpath', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.id).toBe('./');
  });

  it('declares an any-purpose 192 and 512 icon and a separate maskable 512 icon', () => {
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
    expect(maskable.map((i) => i.sizes)).toEqual(['512x512']);
  });

  it.each(manifest.icons.map((i) => [i.src, i.sizes] as const))('icon %s exists at its declared size', (src, sizes) => {
    const file = `${publicDir}${src}`;
    expect(existsSync(file)).toBe(true);
    const [w, h] = sizes.split('x').map(Number);
    const header = pngHeader(file);
    expect({ width: header.width, height: header.height }).toEqual({ width: w, height: h });
    expect(manifest.icons.every((i) => i.type === 'image/png')).toBe(true);
  });

  it('the apple-touch-icon is 180x180 and has no alpha channel (iOS fills transparency black)', () => {
    const header = pngHeader(`${publicDir}icons/apple-touch-icon.png`);
    expect({ width: header.width, height: header.height }).toEqual({ width: 180, height: 180 });
    // PNG colour types: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. Only 0, 2 and 3 are opaque.
    expect([0, 2, 3]).toContain(header.colorType);
  });
});
