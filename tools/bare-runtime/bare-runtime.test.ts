// 01 §13.3: the pure core runs in a context with only ES2022 globals and gives byte-identical output.
import { describe, expect, it } from 'vitest';
import { bundle, runBundled, runDirect } from './run.ts';

describe('bare runtime', () => {
  it('runs 20 scenarios in a vm context byte-identical to Node', async () => {
    const code = await bundle();
    const bare = runBundled(code);
    expect(bare).toBe(await runDirect());
    expect((JSON.parse(bare) as unknown[]).length).toBe(20);
  });

  it('the vm context really lacks host globals', () => {
    expect(runBundled('var __bare = { runAll: () => [typeof console, typeof setTimeout, typeof process, typeof performance, typeof window].join(",") };')).toBe(
      'undefined,undefined,undefined,undefined,undefined',
    );
  });
});
