import { describe, expect, it } from 'vitest';
import round2 from '../src/ui/copy/round2-spec.json';
import { lintCopy } from './lint-copy.ts';

describe('lintCopy', () => {
  it('finds keys that no source mentions', () => {
    const r = lintCopy(['a.b', 'a.c'], [`copy('a.b')`]);
    expect(r.unused).toEqual(['a.c']);
  });
  it('counts a dynamic template or concatenated prefix as use of every key under it', () => {
    expect(lintCopy(['mod.x', 'mod.y', 'z.q'], ['copy(`mod.${id}`)']).unused).toEqual(['z.q']);
    expect(lintCopy(['mod.x', 'z.q'], [`copy('mod.' + id)`]).unused).toEqual(['z.q']);
  });
  it('the real catalogue has no key outside the baseline', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const en = JSON.parse(readFileSync('src/ui/copy/en.json', 'utf8')) as Record<string, string>;
    const files = walk('src').filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$|test-services|testkit|copy\/copy\.ts/.test(f));
    const r = lintCopy(Object.keys(en), files.map((f) => readFileSync(f, 'utf8')));
    // Keys added in round 2 wait for the screens that use them (06-plan.md decision 11); R2-22 empties the list.
    expect(r.unused.filter((k) => !(k in round2.added))).toEqual([]);
    expect(r.staleAllow).toEqual([]);
  });
});
