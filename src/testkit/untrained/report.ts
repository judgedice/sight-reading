/** The untrained-voice section of docs/accuracy-report.md (round 2 detection; reported, non-blocking). */
import { UNTRAINED_BLEED_DB, UNTRAINED_GATE, summarizeUntrained, type UntrainedRecord, type UntrainedSummary } from './run.ts';

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;
const per = (x: number): string => x.toFixed(3);

function row(name: string, s: UntrainedSummary): string {
  return `| ${name} | ${s.takes} | ${s.notes} | ${per(s.detectedPerNote)} | ${per(s.extraGhostsPerNote)} | ${per(s.extrasPerNote)} | ${pct(s.falseWrongLive)} | ${pct(s.falseWrongPitch)} | ${pct(s.falseMissed)} | ${pct(s.octaveRate)} |`;
}

export function renderUntrainedSection(rs: readonly UntrainedRecord[]): string {
  const all = summarizeUntrained(rs);
  const g = UNTRAINED_GATE;
  const lines: string[] = [];
  lines.push('## Untrained voice (reported, non-blocking)');
  lines.push('');
  lines.push(
    `The untrained-voice performer model (src/testkit/untrained/voice.ts) sings each written note once, on pitch, the way an untrained singer does: scoops, drift, wide irregular vibrato, breathy and creaky onsets, consonants, wobbling releases, breaths, low level, and a laptop mic that rolls off the fundamental. Speakers with click bleed at ${UNTRAINED_BLEED_DB} dB. Shipped corpus, difficulties 1 to 5, mostly baritone and bass. Every extra, wrong pitch and missed note is false.`,
  );
  lines.push('');
  lines.push(`Gate (reported, does not fail the run): extra ghosts drawn ≤ ${g.extraGhostsPerNote} and final extras ≤ ${g.extrasPerNote} per written note, false wrong pitch ≤ ${pct(g.falseWrongPitch)}, false missed ≤ ${pct(g.falseMissed)}. Result: **${all.pass ? 'pass' : 'fail'}**.`);
  lines.push('');
  lines.push('| Scope | Takes | Notes | Detected / note | Extra ghosts / note (live) | Final extras / note | Shown wrong pitch live | False wrong pitch | False missed | Read an octave off |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  lines.push(row('All', all));
  for (const [name, lo, hi] of [['Difficulty 1 to 3', 1, 3], ['Difficulty 4 to 5', 4, 5]] as const) {
    const sub = rs.filter((r) => r.level >= lo && r.level <= hi);
    if (sub.length > 0) lines.push(row(name, summarizeUntrained(sub)));
  }
  for (const v of ['voice-baritone', 'voice-bass']) {
    const sub = rs.filter((r) => r.instrumentId === v);
    if (sub.length > 0) lines.push(row(v.replace('voice-', 'Voice, '), summarizeUntrained(sub)));
  }
  const ex = rs.flatMap((r) => r.examples.map((e) => `${r.id}: ${e}`)).slice(0, 8);
  if (ex.length > 0) {
    lines.push('');
    lines.push('<details><summary>Sample false verdicts</summary>');
    lines.push('');
    for (const e of ex) lines.push(`- ${e}`);
    lines.push('');
    lines.push('</details>');
  }
  lines.push('');
  return lines.join('\n');
}
