// Proves the negative lint fixtures fail lint as intended (01 section 3, 05 W10) and the
// positive ones pass. Each fixture states its expectation on its first lines:
//   // expect: <ruleId> | none        (ESLint fixtures, linted at their real path)
//   /* @lint-as <path> */ + /* expect: <ruleId> | none */   (CSS fixtures)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const fixtureRoot = join(root, 'test/lint-fixtures');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const expectation = (text: string): string => {
  const m = /expect:\s*([^\s*]+)/.exec(text);
  if (!m?.[1]) throw new Error('fixture without an expect: header');
  return m[1];
};

const tsFiles = walk(join(fixtureRoot, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
const cssFiles = walk(join(fixtureRoot, 'css')).filter((f) => f.endsWith('.css'));

describe('eslint fixtures', () => {
  const eslint = new ESLint({ cwd: root, ignore: false });

  it('finds fixtures', () => {
    expect(tsFiles.length).toBeGreaterThan(20);
    expect(tsFiles.some((f) => expectation(readFileSync(f, 'utf8')) !== 'none')).toBe(true);
  });

  for (const file of tsFiles) {
    const name = relative(fixtureRoot, file);
    const want = expectation(readFileSync(file, 'utf8'));
    it(`${name} -> ${want}`, async () => {
      const [result] = await eslint.lintFiles([file]);
      const messages = result?.messages ?? [];
      const fatal = messages.filter((m) => m.fatal);
      expect(fatal, JSON.stringify(fatal)).toEqual([]);
      if (want === 'none') {
        expect(messages.map((m) => `${m.ruleId}: ${m.message}`)).toEqual([]);
      } else {
        expect(messages.map((m) => m.ruleId)).toContain(want);
      }
    });
  }
});

describe('stylelint fixtures', () => {
  for (const file of cssFiles) {
    const name = relative(fixtureRoot, file);
    const text = readFileSync(file, 'utf8');
    const want = expectation(text.split('\n')[1] ?? '');
    const as = /@lint-as\s+(\S+)/.exec(text)?.[1];
    it(`${name} -> ${want}`, async () => {
      const result = await stylelint.lint({
        code: text,
        codeFilename: join(root, as ?? 'src/app/x.css'),
        cwd: root,
      });
      const rules = result.results.flatMap((r) => r.warnings.map((w) => w.rule));
      if (want === 'none') expect(rules).toEqual([]);
      else expect(rules).toContain(want);
    });
  }
});
