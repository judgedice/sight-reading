import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_LIMIT, measure } from './size-check.ts';

describe('measure', () => {
  it('reports woff2 assets by file size and keeps them out of the js and css totals', () => {
    const dist = mkdtempSync(join(tmpdir(), 'size-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/a.js"></script>');
    writeFileSync(join(dist, 'assets', 'a.js'), 'console.log(1)');
    writeFileSync(join(dist, 'assets', 'f.woff2'), Buffer.alloc(1234));
    const r = measure(dist);
    expect(r.fonts).toEqual([{ file: 'assets/f.woff2', bytes: 1234 }]);
    expect(r.files.map((f) => f.file)).toEqual(['assets/a.js']);
    expect(FONT_LIMIT).toBe(260_000);
  });
});
