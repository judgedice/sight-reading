// Gates on the resampled capture path (docs/native/AUDIO-DESIGN.md section 8, test 4): `pnpm native:gates:resampled`.
//
// Runs the gate suite (src/testkit/gates, the jobs `pnpm gates` runs) with the microphone signal going through the native
// capture path's resampler (`SincResampler`, the `resample_file` example of sr-audio-core) before the unchanged
// capture and analysis path sees it, in four ways, each against the direct run:
//
//   a   44.1 kHz input into a 48 kHz engine. Each take is rendered at 44.1 kHz (synthesis, phone-mic EQ, click bleed and
//       noise all at 44.1 kHz), converted to 48 kHz, analysed as a 48 kHz capture.
//   b   48 kHz input whose clock runs +200 ppm fast into a 48 kHz engine. Each take is rendered at 48009.6 Hz, the rate
//       the device really samples at, converted with step 1.0002 (the ratio DriftController holds), analysed at 48 kHz.
//   am, bm   the same two routes, but the signal is the direct run's own render, sampled by a device model first (the same
//       resampler: down to 44.1 kHz, or onto the 200 ppm fast clock) and then converted back by the capture path's
//       converter. a and b are the realistic runs (a take rendered where the device would capture it); am and bm
//       are the controlled ones. A render at another rate draws other noise and other attack shapes, so the onset
//       and pitch of a take move by the detector's own noise sensitivity (several ms on a noisy take), which no
//       0.3 ms target can survive; only am and bm hold the content fixed and so measure what the converter does.
//
// Which clock the truth lives on: the engine clock. Scores, click times and truth onsets are in seconds of engine (=
// audible) time; a note sounds at t seconds whatever the input device's clock does. The device merely counts more
// samples per second (b) or fewer (a), and the converter's whole job is to put frame n back at n / 48000 s. So the truth
// is NOT scaled by 1.0002 and a take must come out with every onset at the same time as in the direct run. (Scaling
// the truth would be right only for a run that analyses the device-clock samples as if they were engine frames,
// which is what the converter exists to prevent.)
//
// Compared with the direct run, take by take: every gate keeps its pass or fail; per gate family the largest change of a
// matched onset time (target 0.3 ms) and of a steady pitch median (target 0.5 cent). Nothing is written to
// docs/accuracy-report.md or tools/gates/artifacts/accuracy.json. The result goes to
// tools/native/artifacts/gates-resampled.json (gitignored).
//
//   tsx tools/native/gates-resampled.ts [--quick] [--cases a,b,am,bm] [--workers N] [--reuse-direct]
//                                       [--scale full|fast] [--json PATH]
//
//   --quick          a documented subset (QUICK_SCALE below): 5 scenarios per launch instrument under each of the three
//                    conditions (120 takes), 2 renders per golden displacement case, 40 perfect takes, 3 injected-error
//                    takes per pattern; the same job kinds as the full suite, a seventh of the takes.
//   --reuse-direct   reuse the direct records of the previous run of the same job list (tools/native/artifacts/
//                    gates-direct-<scale>.json); the direct run is deterministic, so this only saves its minutes.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { createScenarioSet, planGoldenDisplacement } from '../../src/testkit/scenarios/index.ts';
import { FAST_SCALE, FULL_SCALE, listJobs, summarize, CONDITIONS, type GateResult, type Job, type SuiteScale, type TakeRecord } from '../../src/testkit/gates/index.ts';
import { makeRoute, ROUTES, type ConvertedRouteId, type RouteId } from './gates-resampled-worker.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : def;
};
const flag = (name: string): boolean => args.includes(`--${name}`);

/** The quick subset, see the header. */
const QUICK_SCALE: SuiteScale = { scenariosPerInstrument: 5, conditions: CONDITIONS, goldenRenders: 2, perfectTakes: 40, tipRuns: 3 };

const ONSET_TARGET_MS = 0.3;
const PITCH_TARGET_CENTS = 0.5;

const quick = flag('quick');
const scaleName = quick ? 'quick' : opt('scale', 'full');
const scale = quick ? QUICK_SCALE : scaleName === 'fast' ? FAST_SCALE : FULL_SCALE;
const workers = Math.max(1, Number(opt('workers', String(Math.max(1, availableParallelism())))));
const cases = opt('cases', 'a,b,am,bm').split(',').filter((c): c is ConvertedRouteId => c in ROUTES);
if (cases.length === 0) throw new Error('--cases takes a list of a, b, am, bm');
const outJson = fileURLToPath(new URL(opt('json', 'tools/native/artifacts/gates-resampled.json'), `file://${ROOT}`));

const log = (s: string): void => void process.stderr.write(`${s}\n`);

// ---------------------------------------------------------------------------------------------------------
// The Rust converter
// ---------------------------------------------------------------------------------------------------------

function buildConverter(): string {
  log('gates-resampled: building the resample_file example (cargo, release)');
  execFileSync('cargo', ['build', '--release', '-p', 'sr-audio-core', '--example', 'resample_file'], { cwd: `${ROOT}src-tauri`, stdio: ['ignore', 'inherit', 'inherit'] });
  const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], { cwd: `${ROOT}src-tauri`, encoding: 'utf8', maxBuffer: 1 << 28 })) as { target_directory: string };
  const bin = `${meta.target_directory}/release/examples/resample_file`;
  if (!existsSync(bin)) throw new Error(`resample_file not found at ${bin}`);
  return bin;
}

interface SelfCheck {
  route: string;
  maxErr: number;
  frames: number;
  spawnMs: number;
}

/** A 1 kHz sine at the device rate must come out as the same sine at the engine rate, frame n at n / 48000 s (the world's time). */
function selfCheck(bin: string, id: ConvertedRouteId): SelfCheck {
  const route = makeRoute(bin, id);
  // The device's own rate; in the matched cases the direct render's, 48 kHz here.
  const inRate = route.deviceRateHz ?? 48000;
  const hz = 1000;
  const n = Math.round(inRate * 2);
  const x = new Float32Array(n);
  for (let m = 0; m < n; m++) x[m] = 0.5 * Math.sin((2 * Math.PI * hz * m) / inRate);
  const t0 = performance.now();
  const y = route.convert(x, inRate);
  const r = { engineRateHz: route.engineRateHz };
  const spawnMs = performance.now() - t0;
  let maxErr = 0;
  for (let k = 64; k < y.length - 64; k++) maxErr = Math.max(maxErr, Math.abs((y[k] as number) - 0.5 * Math.sin((2 * Math.PI * hz * k) / r.engineRateHz)));
  if (Math.abs(y.length - Math.round(2 * r.engineRateHz)) > 3) throw new Error(`route ${id}: ${y.length} frames out for 2 s`);
  if (!(maxErr < 2e-3)) throw new Error(`route ${id}: converted sine is off by ${maxErr} (limit 2e-3); the converter is miswired`);
  return { route: id, maxErr, frames: y.length, spawnMs };
}

// ---------------------------------------------------------------------------------------------------------
// Running the jobs
// ---------------------------------------------------------------------------------------------------------

function runAll(jobs: Job[], route: RouteId, bin: string, label: string): Promise<TakeRecord[]> {
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
      w.postMessage({ seq, job: jobs[seq], route });
    };
    for (let k = 0; k < Math.min(workers, jobs.length); k++) {
      const w = new Worker(new URL('./gates-resampled-worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'], workerData: { bin } });
      w.on('message', (m: { seq: number; record?: TakeRecord; error?: string }) => {
        if (m.error) {
          pool.forEach((x) => void x.terminate());
          reject(new Error(`${label}: job ${JSON.stringify(jobs[m.seq])} failed: ${m.error}`));
          return;
        }
        results[m.seq] = m.record as TakeRecord;
        done++;
        if (done % 100 === 0 || done === jobs.length) {
          const el = (Date.now() - t0) / 1000;
          log(`gates-resampled: ${label} ${done}/${jobs.length} takes, ${el.toFixed(0)} s elapsed, ~${((el / done) * (jobs.length - done)).toFixed(0)} s left`);
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

// ---------------------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------------------

interface DeltaStats {
  /** Matched onsets (or steady medians) compared. */
  n: number;
  maxAbs: number;
  p99: number;
  meanAbs: number;
  /** Signed mean change (a bias shows here). */
  mean: number;
}

const stats = (d: number[]): DeltaStats => {
  if (d.length === 0) return { n: 0, maxAbs: 0, p99: 0, meanAbs: 0, mean: 0 };
  const a = d.map(Math.abs).sort((x, y) => x - y);
  return { n: d.length, maxAbs: a[a.length - 1] as number, p99: a[Math.min(a.length - 1, Math.floor(0.99 * a.length))] as number, meanAbs: a.reduce((s, v) => s + v, 0) / a.length, mean: d.reduce((s, v) => s + v, 0) / d.length };
};

interface FamilyRow {
  family: string;
  takes: number;
  /** Takes whose matched-onset list or steady-pitch list has another length or order than the direct take (not paired). */
  unpairedOnset: number;
  unpairedPitch: number;
  /** Takes whose onset tp/fp/fn changed. */
  onsetCountChanged: number;
  /** Takes whose count of agreeing verdicts changed. */
  verdictChanged: number;
  onsetMs: DeltaStats;
  pitchCents: DeltaStats;
  meetsOnset: boolean;
  meetsPitch: boolean;
  /** A 24 or 16 kHz capture: analysed at another rate on the converted routes, so not attributable to the converter. */
  analysisRateChanged: boolean;
  /** The take with the largest onset change: id, ms. */
  worstOnset: { id: string; ms: number } | null;
  worstPitch: { id: string; cents: number } | null;
}

/**
 * The rate the direct run captures a take at. The planned condition (and the golden takes, which are planned) draw
 * 48, 48, 24 or 16 kHz captures; a 24 or 16 kHz capture is analysed at its own rate in the direct run and at 12 kHz
 * (the 48 kHz engine's analysis rate) on every converted route, a change of the analysis itself that the converter
 * does not cause. Those takes are reported on their own rows.
 */
let scenarios: ReturnType<typeof createScenarioSet> | null = null;
function directCaptureRate(job: Job): number {
  if (job.kind === 'scenario') return job.condition === 'planned' ? (scenarios ??= createScenarioSet()).plan(job.index).capture.captureRateHz ?? 48000 : 48000;
  if (job.kind === 'golden') return planGoldenDisplacement(job.case, job.r).capture.captureRateHz ?? 48000;
  return 48000;
}
const lowRate = (r: TakeRecord): boolean => directCaptureRate(r.job) !== 48000;
const familyOf = (r: TakeRecord): string => `${r.job.kind === 'scenario' ? `${r.job.condition}/${r.timbre}` : r.job.kind}${lowRate(r) ? ` @${directCaptureRate(r.job) / 1000}k` : ''}`;

function compareFamilies(direct: TakeRecord[], other: TakeRecord[]): FamilyRow[] {
  const acc = new Map<string, { takes: number; uo: number; up: number; oc: number; vc: number; on: number[]; pc: number[]; wo: { id: string; ms: number } | null; wp: { id: string; cents: number } | null }>();
  const rowFor = (f: string): NonNullable<ReturnType<typeof acc.get>> => {
    let x = acc.get(f);
    if (!x) acc.set(f, (x = { takes: 0, uo: 0, up: 0, oc: 0, vc: 0, on: [], pc: [], wo: null, wp: null }));
    return x;
  };
  direct.forEach((d, i) => {
    const o = other[i] as TakeRecord;
    if (d.skipped || o.skipped) return;
    for (const f of [familyOf(d), lowRate(d) ? 'ALL 24/16 kHz captures' : 'ALL 48 kHz captures']) {
      const x = rowFor(f);
      x.takes++;
      if (d.onset.tp !== o.onset.tp || d.onset.fp !== o.onset.fp || d.onset.fn !== o.onset.fn) x.oc++;
      if (d.verdict.agree !== o.verdict.agree || d.verdict.n !== o.verdict.n) x.vc++;
      const sameOnsets = d.onset.samples.length === o.onset.samples.length && d.onset.samples.every((s, k) => s.rule === (o.onset.samples[k] as { rule: string }).rule);
      if (sameOnsets) {
        d.onset.samples.forEach((s, k) => {
          const dm = (o.onset.samples[k] as { errMs: number }).errMs - s.errMs;
          x.on.push(dm);
          if (!x.wo || Math.abs(dm) > Math.abs(x.wo.ms)) x.wo = { id: d.id, ms: dm };
        });
      } else x.uo++;
      const samePitch = d.cents.length === o.cents.length && d.cents.every((s, k) => s.vibrato === (o.cents[k] as { vibrato: boolean }).vibrato);
      if (samePitch) {
        d.cents.forEach((s, k) => {
          const dc = (o.cents[k] as { errCents: number }).errCents - s.errCents;
          x.pc.push(dc);
          if (!x.wp || Math.abs(dc) > Math.abs(x.wp.cents)) x.wp = { id: d.id, cents: dc };
        });
      } else x.up++;
    }
  });
  return [...acc.entries()]
    .sort(([a], [b]) => (a.startsWith('ALL') ? 1 : 0) - (b.startsWith('ALL') ? 1 : 0) || a.localeCompare(b))
    .map(([family, x]) => {
      const onsetMs = stats(x.on);
      const pitchCents = stats(x.pc);
      return {
        family,
        takes: x.takes,
        unpairedOnset: x.uo,
        unpairedPitch: x.up,
        onsetCountChanged: x.oc,
        verdictChanged: x.vc,
        onsetMs,
        pitchCents,
        meetsOnset: onsetMs.maxAbs <= ONSET_TARGET_MS,
        meetsPitch: pitchCents.maxAbs <= PITCH_TARGET_CENTS,
        analysisRateChanged: family.includes('24/16') || / @\d+k$/.test(family),
        worstOnset: x.wo,
        worstPitch: x.wp,
      };
    });
}

const gateKey = (g: GateResult): string => `${g.scope}|${g.id}|${g.metric}`;

interface GateMove {
  key: string;
  direct: number | null;
  value: number | null;
  delta: number | null;
  threshold: number;
  op: string;
  directPass: boolean;
  pass: boolean;
}

function compareGates(direct: GateResult[], other: GateResult[]): { flips: GateMove[]; moved: GateMove[]; total: number; directPass: number; pass: number } {
  const byKey = new Map(other.map((g) => [gateKey(g), g]));
  const flips: GateMove[] = [];
  const moved: GateMove[] = [];
  for (const d of direct) {
    const o = byKey.get(gateKey(d));
    if (!o) continue;
    const m: GateMove = { key: gateKey(d), direct: d.value, value: o.value, delta: d.value !== null && o.value !== null ? o.value - d.value : null, threshold: d.threshold, op: d.op, directPass: d.pass, pass: o.pass };
    if (d.pass !== o.pass) flips.push(m);
    if (m.delta === null ? d.value !== o.value : Math.abs(m.delta) > 1e-9) moved.push(m);
  }
  // Largest moves first, relative to the size of the threshold they are judged against.
  const rel = (m: GateMove): number => (m.delta === null ? Infinity : Math.abs(m.delta) / Math.max(Math.abs(m.threshold), 0.01));
  moved.sort((a, b) => rel(b) - rel(a));
  return { flips, moved, total: direct.length, directPass: direct.filter((g) => g.pass).length, pass: other.filter((g) => g.pass).length };
}

const isBlocking = (g: GateResult): boolean => !g.pass && !g.note?.includes('R54');

// ---------------------------------------------------------------------------------------------------------

const commit = (): string | null => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const cfg = configs();
const jobs = listJobs(scale);
const jobsHash = createHash('sha256').update(JSON.stringify(jobs)).digest('hex').slice(0, 16);
const bin = buildConverter();
const checks = cases.map((c) => selfCheck(bin, c));
for (const c of checks) log(`gates-resampled: converter self-check, 1 kHz sine, route ${c.route}: max error ${c.maxErr.toExponential(2)}, ${c.frames} frames, ${c.spawnMs.toFixed(0)} ms for 2 s of audio including process start`);

const t00 = Date.now();
log(`gates-resampled: ${jobs.length} takes per run, ${workers} workers, scale ${scaleName}, cases ${cases.join(' and ')} plus direct`);

const cachePath = `${ROOT}tools/native/artifacts/gates-direct-${scaleName}.json`;
let direct: TakeRecord[] | null = null;
let directSec: number | null = null;
if (flag('reuse-direct') && existsSync(cachePath)) {
  const c = JSON.parse(readFileSync(cachePath, 'utf8')) as { jobsHash: string; records: TakeRecord[]; durationSec: number };
  if (c.jobsHash === jobsHash) {
    direct = c.records;
    directSec = c.durationSec;
    log(`gates-resampled: reusing the direct run of ${cachePath}`);
  }
}
if (!direct) {
  const t = Date.now();
  direct = await runAll(jobs, 'direct', bin, 'direct');
  directSec = (Date.now() - t) / 1000;
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ jobsHash, durationSec: directSec, records: direct }));
}
const directSummary = summarize(direct, cfg);

interface CaseResult {
  description: string;
  durationSec: number;
  gates: { total: number; directPass: number; pass: number; flips: GateMove[]; movedCount: number; topMoved: GateMove[] };
  blockingFailures: number;
  families: FamilyRow[];
  /** True when the take's signal is the direct run's (the onset and pitch targets apply); false when it is rendered again at the device rate. */
  contentMatched: boolean;
  targetsMet: boolean;
}
const result: Record<string, CaseResult> = {};
for (const c of cases) {
  const t = Date.now();
  const recs = await runAll(jobs, c, bin, `case ${c}`);
  const durationSec = (Date.now() - t) / 1000;
  const summary = summarize(recs, cfg);
  const g = compareGates(directSummary.gates, summary.gates);
  const families = compareFamilies(direct, recs);
  const blockingFailures = summary.gates.filter(isBlocking).length;
  result[c] = {
    description: ROUTES[c].description,
    durationSec,
    gates: { total: g.total, directPass: g.directPass, pass: g.pass, flips: g.flips, movedCount: g.moved.length, topMoved: g.moved.slice(0, 25) },
    blockingFailures,
    families,
    contentMatched: ROUTES[c].deviceRateHz === null,
    targetsMet: g.flips.length === 0 && families.every((f) => f.analysisRateChanged || (f.meetsOnset && f.meetsPitch)),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------

const totalSec = (Date.now() - t00) / 1000;
const out = {
  generated: new Date().toISOString(),
  commit: commit(),
  scale: scaleName,
  takesPerRun: jobs.length,
  workers,
  targets: { onsetMs: ONSET_TARGET_MS, pitchCents: PITCH_TARGET_CENTS },
  durationSec: { total: totalSec, direct: directSec, ...Object.fromEntries(cases.map((c) => [c, (result[c] as CaseResult).durationSec])) },
  converterSelfCheck: checks,
  directGates: { total: directSummary.gates.length, pass: directSummary.gates.filter((g) => g.pass).length, blockingFailures: directSummary.gates.filter(isBlocking).length },
  cases: result,
};
mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, `${JSON.stringify(out, null, 1)}\n`);

const f2 = (v: number): string => v.toFixed(3);
console.log(`\ngates on the resampled path (${scaleName}: ${jobs.length} takes per run, ${(totalSec / 60).toFixed(1)} min in all; direct ${directSec === null ? 'n/a' : (directSec / 60).toFixed(1)} min)`);
console.log(`direct: ${out.directGates.pass}/${out.directGates.total} gates pass, ${out.directGates.blockingFailures} blocking`);
for (const c of cases) {
  const r = result[c] as CaseResult;
  console.log(`\ncase ${c}: ${r.description}`);
  console.log(`  gates: ${r.gates.pass}/${r.gates.total} pass (direct ${r.gates.directPass}); pass/fail flips: ${r.gates.flips.length}; headline values moved: ${r.gates.movedCount}; blocking failures ${r.blockingFailures}; ${(r.durationSec / 60).toFixed(1)} min`);
  for (const m of r.gates.flips) console.log(`  FLIP ${m.key}: ${m.direct} -> ${m.value} (needs ${m.op} ${m.threshold}), pass ${m.directPass} -> ${m.pass}`);
  for (const m of r.gates.topMoved.slice(0, 5)) console.log(`  moved ${m.key}: ${m.direct} -> ${m.value}`);
  console.log('  family                 takes  max d onset ms  p99     n onsets  max d pitch c  p99     n pitch  unpaired o/p  verdict/count changed');
  for (const f of r.families) {
    const mark = `${f.meetsOnset ? ' ' : '!'}${f.meetsPitch ? ' ' : '!'}`;
    console.log(`${mark}${f.family.padEnd(24)} ${String(f.takes).padStart(5)}  ${f2(f.onsetMs.maxAbs).padStart(14)}  ${f2(f.onsetMs.p99)}  ${String(f.onsetMs.n).padStart(8)}  ${f2(f.pitchCents.maxAbs).padStart(13)}  ${f2(f.pitchCents.p99)}  ${String(f.pitchCents.n).padStart(7)}  ${`${f.unpairedOnset}/${f.unpairedPitch}`.padStart(12)}  ${f.verdictChanged}/${f.onsetCountChanged}`);
  }
  if (r.families.some((f) => f.analysisRateChanged)) console.log('  rows marked @24k, @16k and "24/16 kHz captures": the direct run analyses those at their own rate, every converted route at 12 kHz; excluded from the targets');
  console.log(`  targets (onset <= ${ONSET_TARGET_MS} ms, pitch <= ${PITCH_TARGET_CENTS} c, no flips): ${r.targetsMet ? 'met' : 'NOT met'}${r.contentMatched ? '' : ' (not content-matched: a render at another rate draws other noise, so the onset and pitch columns include synthesis differences)'}`);
}
console.log(`\nwrote ${outJson}`);
process.exit(cases.some((c) => (result[c] as CaseResult).gates.flips.length > 0 || ((result[c] as CaseResult).contentMatched && !(result[c] as CaseResult).targetsMet)) ? 1 : 0);
