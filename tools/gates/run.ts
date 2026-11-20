// Synthetic accuracy gates (P18, 01 section 13.2): `pnpm gates`.
//
// Runs every job of the suite (src/testkit/gates/jobs.ts) on worker threads, aggregates the takes into the gate
// results, writes docs/accuracy-report.md and tools/gates/artifacts/accuracy.json (sigma, e90, c90 and latency
// artifacts for the floor check), and exits 1 when a gate fails. Failures in reverberant rooms that PLAN ruling 54
// accepts as a known limit are reported but do not fail the run.
//
//   tsx tools/gates/run.ts [--scale full|fast] [--workers N] [--report-only] [--no-write]
//                          [--out docs/accuracy-report.md] [--json tools/gates/artifacts/accuracy.json]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { FAST_SCALE, FULL_SCALE, listJobs, renderReport, summarize, type Job, type SuiteScale, type TakeRecord } from '../../src/testkit/gates/index.ts';
import { measureUntrained, renderUntrainedSection, summarizeUntrained, untrainedPlans } from '../../src/testkit/untrained/index.ts';

const ROOT = new URL('../../', import.meta.url);
const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : def;
};
const flag = (name: string): boolean => args.includes(`--${name}`);

const scaleName = opt('scale', 'full');
const scale: SuiteScale = scaleName === 'fast' ? FAST_SCALE : FULL_SCALE;
const workers = Math.max(1, Number(opt('workers', String(Math.max(1, availableParallelism())))));
const outMd = fileURLToPath(new URL(opt('out', 'docs/accuracy-report.md'), ROOT));
const outJson = fileURLToPath(new URL(opt('json', 'tools/gates/artifacts/accuracy.json'), ROOT));

function runAll(jobs: Job[]): Promise<TakeRecord[]> {
  const results: TakeRecord[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const pool: Worker[] = [];
    const feed = (w: Worker): void => {
      if (next >= jobs.length) {
        void w.terminate();
        return;
      }
      const seq = next++;
      w.postMessage({ seq, job: jobs[seq] });
    };
    for (let k = 0; k < Math.min(workers, jobs.length); k++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
      w.on('message', (m: { seq: number; record?: TakeRecord; error?: string }) => {
        if (m.error) {
          pool.forEach((x) => void x.terminate());
          reject(new Error(`job ${JSON.stringify(jobs[m.seq])} failed: ${m.error}`));
          return;
        }
        results[m.seq] = m.record as TakeRecord;
        done++;
        if (done % 50 === 0 || done === jobs.length) {
          const el = (Date.now() - t0) / 1000;
          process.stderr.write(`gates: ${done}/${jobs.length} takes, ${el.toFixed(0)} s elapsed, ~${((el / done) * (jobs.length - done)).toFixed(0)} s left\n`);
        }
        if (done === jobs.length) resolve(results);
        else feed(w);
      });
      w.on('error', reject);
      pool.push(w);
      feed(w);
    }
  });
}

const commit = (): string | null => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: fileURLToPath(ROOT), encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const cfg = configs();
const jobs = listJobs(scale);
process.stderr.write(`gates: ${jobs.length} takes on ${workers} workers (scale ${scaleName})\n`);
const started = Date.now();
const records = await runAll(jobs);
const summary = summarize(records, cfg);
// Round 2: the untrained-voice condition, its own reported gate that never fails the run.
const untrainedTakes = scaleName === 'fast' ? 4 : 40;
process.stderr.write(`gates: untrained voice, ${untrainedTakes} takes\n`);
const untrained = untrainedPlans(untrainedTakes).map((p) => measureUntrained(p));
const untrainedSummary = summarizeUntrained(untrained);
const durationSec = (Date.now() - started) / 1000;
const report = `${renderReport(summary, {
  scale,
  scaleName,
  durationSec,
  workers,
  date: new Date().toISOString().slice(0, 10),
  commit: commit(),
  liveProvisionalMs: cfg.grading.live.provisionalMs,
})}\n${renderUntrainedSection(untrained)}`;

if (!flag('no-write')) {
  mkdirSync(dirname(outMd), { recursive: true });
  writeFileSync(outMd, report);
  mkdirSync(dirname(outJson), { recursive: true });
  const artifact = {
    generated: new Date().toISOString(),
    scale: scaleName,
    commit: commit(),
    liveProvisionalMs: cfg.grading.live.provisionalMs,
    onsetByClass: summary.onsetByClass,
    onsetByRule: summary.onsetByRule,
    measuredSigma: summary.measuredSigma,
    measuredC90: summary.measuredC90,
    c90ByInstrument: Object.fromEntries(Object.entries(summary.perInstrument).map(([c, byT]) => [c, Object.fromEntries(Object.entries(byT).map(([t, s]) => [t, { steady: s.c90Steady, all: s.c90All, n: s.c90SteadyN }]))])),
    latency: summary.latency,
    intonationLatency: summary.intonationLatency,
    gates: summary.gates,
    untrainedVoice: untrainedSummary,
  };
  writeFileSync(outJson, `${JSON.stringify(artifact, null, 1)}\n`);
  process.stderr.write(`gates: wrote ${outMd} and ${outJson}\n`);
}

const failing = summary.gates.filter((g) => !g.pass);
const blocking = failing.filter((g) => !g.note?.includes('R54'));
for (const g of failing) {
  process.stderr.write(`gates: FAIL ${g.id} [${g.scope}] ${g.metric}: ${g.value === null ? 'n/a' : g.value.toFixed(4)} (needs ${g.op} ${g.threshold}; ${g.source})${g.note ? ` - ${g.note}` : ''}\n`);
}
process.stderr.write(
  `gates: untrained voice (non-blocking) ${untrainedSummary.pass ? 'pass' : 'FAIL'}: extra ghosts ${untrainedSummary.extraGhostsPerNote.toFixed(3)}/note, extras ${untrainedSummary.extrasPerNote.toFixed(3)}/note, false wrong pitch ${(100 * untrainedSummary.falseWrongPitch).toFixed(2)}%, false missed ${(100 * untrainedSummary.falseMissed).toFixed(2)}%\n`,
);
process.stderr.write(`gates: ${summary.gates.length - failing.length}/${summary.gates.length} pass in ${(durationSec / 60).toFixed(1)} min; ${blocking.length} blocking failure(s)\n`);
process.exit(blocking.length > 0 && !flag('report-only') ? 1 : 0);
