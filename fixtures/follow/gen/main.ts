/** Writes fixtures/follow/*.json, fixtures/grade/*.json and fixtures/render/*.events.jsonl. Run: pnpm tsx fixtures/follow/gen/main.ts */
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { buildFollowFiles, buildGradeFiles, buildRenderFiles } from './build.ts';
import { ROOT } from './io.ts';

const dirs: [string, Record<string, string>, RegExp][] = [
  ['fixtures/follow/', buildFollowFiles(), /\.json$/],
  ['fixtures/grade/', buildGradeFiles(), /\.json$/],
  ['fixtures/render/', buildRenderFiles(), /\.events\.jsonl$/],
];
for (const [dir, files, pat] of dirs) {
  const url = new URL(dir, ROOT);
  for (const f of readdirSync(url)) if (pat.test(f) && !(f in files)) unlinkSync(new URL(f, url));
  for (const [name, text] of Object.entries(files)) writeFileSync(new URL(name, url), text);
  console.warn(`${dir}: ${Object.keys(files).length} files`);
}
