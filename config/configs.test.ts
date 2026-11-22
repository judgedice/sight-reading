// Seeded config files (01 §14 item 5, P0d; 02 §10): schema validity, source citations and the content invariants
// the spec states for each file. Floors are checked in src/rules/floor-check.test.ts.
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Configs, GradingConfig, InstrumentsConfig, LevelsConfig, MeasurementBudget, ProgressionConfig, TipsConfig, TrumpetValveTable } from '../src/core/types.ts';
import { loadConfigs } from '../src/rules/load-configs.ts';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')) as T;

const FILES = [
  ['config/grading-config.json', 'grading-config'],
  ['config/levels.json', 'levels'],
  ['config/instruments.json', 'instruments'],
  ['config/progression.json', 'progression'],
  ['config/tips.json', 'tips'],
  ['config/measurement-budget.json', 'measurement-budget'],
  ['data/trumpet-valves.json', 'trumpet-valves'],
] as const;

const grading = readJson<GradingConfig>('config/grading-config.json');
const levels = readJson<LevelsConfig>('config/levels.json');
const instruments = readJson<InstrumentsConfig>('config/instruments.json');
const progression = readJson<ProgressionConfig>('config/progression.json');
const tips = readJson<TipsConfig>('config/tips.json');
const budget = readJson<MeasurementBudget>('config/measurement-budget.json');
const valves = readJson<TrumpetValveTable>('data/trumpet-valves.json');

describe('schema validity', () => {
  it.each(FILES)('%s validates against schemas/%s.schema.json (Ajv strict)', (file, schema) => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
    const validate = ajv.compile(readJson<object>(`schemas/${schema}.schema.json`));
    expect(validate(readJson<unknown>(file)), JSON.stringify(validate.errors)).toBe(true);
  });
});

/** Collect every object that carries a `_source` key, and every top-level block of a config. */
function sourcedBlocks(value: unknown, path: string, out: { path: string; source: unknown }[]): void {
  if (Array.isArray(value)) value.forEach((v, i) => sourcedBlocks(v, `${path}[${i}]`, out));
  else if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    if ('_source' in rec) out.push({ path, source: rec['_source'] });
    for (const [k, v] of Object.entries(rec)) sourcedBlocks(v, `${path}.${k}`, out);
  }
}

describe('every block cites its spec section', () => {
  const cites = (s: unknown): boolean => typeof s === 'string' && /0[1-5] §/.test(s);
  it.each([
    ['grading-config', grading, ['timing', 'matchWindow', 'intonation', 'live', 'credit', 'components', 'grades', 'gates', 'stops', 'displacement', 'ranked', 'ui', 'voice', 'tuning', 'endOfTake']],
    ['progression', progression, ['xp', 'ranks', 'levelWindow', 'placement', 'skip']],
    ['measurement-budget', budget, ['onsetError', 'timingFloors', 'ioiFloors', 'cents', 'live', 'fundamentals', 'capture', 'calibration']],
    ['tips selection', { selection: tips.selection }, ['selection']],
    ['levels', levels, ['countIn', 'compound', 'breath', 'selection']],
  ] as const)('%s', (_name, doc, blocks) => {
    for (const b of blocks) expect(cites((doc as Record<string, { _source?: unknown }>)[b]?._source), `${_name}.${b}._source`).toBe(true);
  });

  it('levels, patterns, tips, instruments and valve table carry a _source', () => {
    const found: { path: string; source: unknown }[] = [];
    sourcedBlocks(levels, 'levels', found);
    sourcedBlocks(tips, 'tips', found);
    sourcedBlocks(instruments, 'instruments', found);
    sourcedBlocks(valves, 'valves', found);
    expect(found.length).toBeGreaterThan(10 + 35 + 95);
    for (const f of found) expect(cites(f.source), `${f.path}._source = ${String(f.source)}`).toBe(true);
    for (const l of levels.levels) expect(cites(l._source)).toBe(true);
    for (const p of tips.patterns) expect(cites(p._source)).toBe(true);
    for (const t of tips.tips) expect(cites(t._source)).toBe(true);
    expect(cites(instruments._source)).toBe(true);
    expect(cites(valves._source)).toBe(true);
  });
});

describe('loadConfigs on the seeded files', () => {
  it('loads all seven documents', () => {
    const cfg: Configs = loadConfigs({ grading, levels, instruments, progression, tips, budget, trumpetValves: valves });
    expect(cfg.levelByNumber[10]?.level).toBe(10);
    expect(cfg.instrumentById['trumpet-bb']?.family).toBe('high-brass');
    expect(cfg.configVersion).toContain('grading-2.1.0');
  });
});

describe('grading-config.json ui (round 2)', () => {
  it('has the sure thresholds and the calm live limit', () => {
    expect(grading.ui.sure).toEqual({ clearAgree: 0.9, clearMaxChanged: 2, mostlyAgree: 0.75, mostlyMaxChanged: 5 });
    expect(grading.ui.calmLiveUpTo).toBe(3);
  });
});

describe('grading-config.json (02 §4)', () => {
  it('holds the ruling values', () => {
    expect(grading.timing.onsetClassFloors).toEqual({ hard: { goodMs: 40, redMs: 60, badMs: 90 }, soft: { goodMs: 55, redMs: 85, badMs: 120 } }); // R23
    expect(grading.intonation.minSteadyMs).toEqual({ none: 150, vibrato: 180 }); // R18
    expect(grading.live.provisionalMs).toBe(80); // R19
    expect(grading.live.hysteresisCents).toBe(10);
    expect(grading.ranked.maxRtlMs).toBe(120); // R17
    expect(grading.endOfTake.afterLastNoteEndBeats).toBe(1); // R14
    expect(grading.timing.levelBands.map((b) => b.good.absMs)).toEqual([60, 50, 40]);
    expect(grading.timing.ioiCap).toEqual({ good: 0.3, red: 0.4, bad: 0.5 });
  });
  it('has the grade table of 02 §4.7', () => {
    expect(grading.grades.scale.map((r) => [r.grade, r.minScore, r.stars])).toEqual([['S', 97, 3], ['A', 90, 3], ['B', 80, 2], ['C', 70, 1], ['D', 60, 0], ['F', 0, 0]]);
    expect(grading.grades.scale.filter((r) => r.shine).map((r) => r.grade)).toEqual(['S']);
  });
  it('has weights that match 02 §4.4', () => {
    const w = (g: string, l: number) => grading.components.weights.find((r) => r.group === g && l >= r.levels[0] && l <= r.levels[1]);
    expect([w('continuous', 2)?.P, w('continuous', 2)?.I, w('continuous', 2)?.R]).toEqual([0.55, 0.05, 0.4]);
    expect([w('continuous', 5)?.P, w('continuous', 5)?.I, w('continuous', 5)?.R]).toEqual([0.5, 0.1, 0.4]);
    expect([w('continuous', 9)?.P, w('continuous', 9)?.I, w('continuous', 9)?.R]).toEqual([0.45, 0.15, 0.4]);
    expect([w('fixed', 7)?.P, w('fixed', 7)?.I, w('fixed', 7)?.R]).toEqual([0.55, 0, 0.45]);
  });
});

describe('levels.json (02 §2.3)', () => {
  it('has 10 ascending levels with the table values', () => {
    expect(levels.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(levels.levels.map((l) => l.tempo.minBpm)).toEqual([60, 60, 66, 66, 72, 72, 80, 80, 88, 92]);
    expect(levels.levels.map((l) => l.tempo.maxBpm)).toEqual([76, 84, 92, 100, 112, 120, 132, 144, 160, 176]);
    expect(levels.levels.map((l) => l.scanSec)).toEqual([30, 30, 30, 30, 45, 45, 45, 60, 60, 60]);
    // PLAN R70 (supersedes R65): one bar of count-in at every difficulty, at any tempo.
    expect(levels.levels.map((l) => l.countInBars)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(levels.countIn.slowBars).toBe(1);
    expect(levels.levels.map((l) => l.tier)).toEqual(['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E']);
    expect(levels.levels.map((l) => l.npsCap['512'])).toEqual([2, 3, 3.5, 4.5, 5, 6, 6.5, 7, 8, 8]);
    expect(levels.levels.map((l) => l.writtenKeys.maxAccidentals)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 7, 7]);
  });
  it('keeps descriptions within 60 characters and lists are cumulative', () => {
    for (const l of levels.levels) expect(l.description.length).toBeLessThanOrEqual(60);
    for (let i = 1; i < levels.levels.length; i++) {
      const prev = levels.levels[i - 1];
      const cur = levels.levels[i];
      if (!prev || !cur) continue;
      for (const key of ['meters', 'rhythmCells', 'articulations'] as const) {
        for (const item of prev[key]) expect(cur[key], `L${cur.level} ${key} keeps ${item}`).toContain(item);
      }
    }
  });
  it('introduces double accidentals at L8 and church modes only from L5', () => {
    expect(levels.levels.filter((l) => l.doubleAccidentals).map((l) => l.level)).toEqual([8, 9, 10]);
    expect(levels.levels.filter((l) => l.modal.length > 0).map((l) => l.level)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(levels.selection.stretchRate).toBe(0.2);
    expect(levels.selection.maxFracFromLevelBelow).toBe(0.2);
  });
});

describe('instruments.json (02 §1)', () => {
  const launch = instruments.instruments.filter((i) => i.status === 'launch');
  it('holds all 26 instruments, 13 launch ids covering the 8 launch instruments', () => {
    expect(instruments.instruments).toHaveLength(26);
    expect(launch.map((i) => i.id)).toEqual(['voice-soprano', 'voice-mezzo', 'voice-alto', 'voice-tenor', 'voice-baritone', 'voice-bass', 'flute', 'clarinet-bb', 'sax-alto', 'trumpet-bb', 'violin', 'cello', 'piano-rh']);
    expect(new Set(launch.map((i) => (i.family === 'voice' ? 'voice' : i.id))).size).toBe(8);
    for (const i of launch) expect(i.testkitTimbre, i.id).not.toBeNull();
  });
  it('agrees with the per-instrument facts of 02 §1.1 and §1.3', () => {
    const by = (id: string) => instruments.instruments.find((i) => i.id === id);
    expect(by('trumpet-bb')).toMatchObject({ semis: 2, onsetClass: 'hard', fullWrittenRange: [54, 84] });
    expect(by('clarinet-bb')?.semis).toBe(2);
    expect(by('sax-alto')?.semis).toBe(9);
    expect(by('cello')).toMatchObject({ fullWrittenRange: [40, 81], onsetClass: 'soft' });
    expect(by('cello')?.clefs).toEqual([{ clef: 'bass', fromLevel: 1 }, { clef: 'tenor', fromLevel: 7 }, { clef: 'treble', fromLevel: 9 }]);
    expect(by('voice-tenor')).toMatchObject({ semis: 12, relativePitch: true });
    expect(by('piano-rh')?.pitchKind).toBe('fixed');
    expect(by('guitar')?.pitchKind).toBe('fixed');
    expect(by('horn-f')?.onsetClass).toBe('soft');
    expect(by('piano-lh')?.fullWrittenRange[0]).toBe(36);
  });
  it('keeps every tier inside the full range, ascending, and tiers A and B at least 12 semitones wide', () => {
    for (const inst of instruments.instruments) {
      const order = ['A', 'B', 'C', 'D', 'E'] as const;
      for (const t of order) {
        const [lo, hi] = inst.tiers[t];
        expect(lo, `${inst.id} ${t}`).toBeGreaterThanOrEqual(inst.fullWrittenRange[0]);
        expect(hi, `${inst.id} ${t}`).toBeLessThanOrEqual(inst.fullWrittenRange[1]);
        if (t === 'A' || t === 'B') expect(hi - lo, `${inst.id} tier ${t} width`).toBeGreaterThanOrEqual(12);
      }
      expect(inst.tiers.E[0], inst.id).toBe(Math.min(...order.map((t) => inst.tiers[t][0])));
    }
  });
  it('sets lowFundamental from the lowest served sounding pitch (02 §1.2, §4.4)', () => {
    for (const inst of instruments.instruments) {
      const lowest = Math.min(inst.fullWrittenRange[0], ...Object.values(inst.tiers).map((b) => b[0])) - inst.semis;
      const hz = 440 * 2 ** ((lowest - 69) / 12);
      expect(inst.lowFundamental, `${inst.id} lowest ${hz.toFixed(1)} Hz`).toBe(hz < grading.components.lowFundamentalHz);
    }
    expect(launch.filter((i) => i.lowFundamental)).toEqual([]);
  });
  it('carries 01 §7.3 detection values: windows, clarity and change cents', () => {
    const d = (id: string) => instruments.instruments.find((i) => i.id === id)?.detection;
    expect(['flute', 'oboe', 'violin', 'trumpet-bb', 'voice-soprano', 'voice-alto'].map((id) => d(id)?.windowSamples)).toEqual([512, 512, 512, 512, 512, 512]);
    expect(['tuba', 'double-bass'].map((id) => d(id)?.windowSamples)).toEqual([2048, 2048]);
    expect(d('clarinet-bb')?.windowSamples).toBe(1024);
    expect(d('voice-tenor')?.windowSamples).toBe(1024);
    expect(['voice-alto', 'trombone', 'piano-rh', 'tuba'].map((id) => d(id)?.clarityThreshold)).toEqual([0.8, 0.8, 0.8, 0.8]);
    expect(['flute', 'violin', 'horn-f'].map((id) => d(id)?.clarityThreshold)).toEqual([0.85, 0.85, 0.85]);
    expect(['voice-bass', 'flute', 'piano-rh', 'guitar'].map((id) => d(id)?.changeCents)).toEqual([80, 60, 40, 40]);
    expect(d('violin')?.vibratoClass).toBe('vibrato');
    expect(d('flute')?.vibratoClass).toBe('none');
  });
  it('searches each instrument over its sounding range widened by 3 semitones', () => {
    const t = instruments.instruments.find((i) => i.id === 'trumpet-bb');
    expect(t?.detection.minHz).toBeCloseTo(440 * 2 ** ((54 - 2 - 3 - 69) / 12), 1);
    expect(t?.detection.maxHz).toBeCloseTo(440 * 2 ** ((84 - 2 + 3 - 69) / 12), 1);
  });
});

describe('progression.json (02 §5)', () => {
  it('reproduces the rank table and the XP worked examples', () => {
    expect(progression.ranks.table.map((r) => [r.name, r.xp, r.minLevel])).toEqual([
      ['Novice', 0, 1], ['Apprentice', 300, 2], ['Student', 1000, 3], ['Section player', 2500, 4], ['Ensemble player', 5000, 5],
      ['Principal', 9000, 6], ['Soloist', 15000, 7], ['Session player', 24000, 8], ['First call', 36000, 9], ['Maestro', 52000, 10],
    ]);
    const x = progression.xp;
    const base = (l: number) => x.basePerLevel * l + x.baseOffset;
    expect([base(1), base(5), base(10)]).toEqual([10, 34, 64]);
    // L5, S = 85, tempo at mid, random key, streak 6 days: 34 x 0.85 x 1.08 x 1.12 = 34.96 -> 35 XP
    expect(Math.round(base(5) * 0.85 * (1 + x.randomPerSetting) * (1 + x.streakPerDay * 6))).toBe(35);
    // L5 player farming L1 at S = 100: 10 x 1.0 x 0.25 = 2.5 -> 3 XP
    expect(Math.round(base(1) * 1.0 * x.belowMult)).toBe(3);
  });
  it('holds the level window, placement and skip rules', () => {
    expect(progression.levelWindow).toMatchObject({ size: 5, offer: { minCount: 4, score: 85 }, auto: { consecutive: 8, score: 90 }, down: { meanBelow: 60 } });
    expect(progression.placement).toMatchObject({ excerpts: 3, startLevel: 2, upBy: 2, downBy: 1, finalMinScore: 75 });
    expect(progression.skip.postRevealPerRanked).toBe(5);
  });
});

describe('tips.json (02 §6)', () => {
  const enabledPatterns = tips.patterns.filter((p) => p.enabled).map((p) => p.id);
  it('enables exactly the 16 v1 patterns (18 ids; E1/E2 and E28/E29 are pairs) and keeps the 17 later ones disabled', () => {
    expect(enabledPatterns.sort()).toEqual(['E1', 'E12', 'E13', 'E16', 'E18', 'E2', 'E22', 'E23', 'E26', 'E28', 'E29', 'E30', 'E31', 'E4', 'E6', 'E7', 'E8', 'E9']);
    const pairCollapsed = new Set(enabledPatterns.map((id) => (id === 'E2' ? 'E1' : id === 'E29' ? 'E28' : id)));
    expect(pairCollapsed.size).toBe(16);
    const disabled = tips.patterns.filter((p) => !p.enabled).map((p) => p.id);
    expect(disabled).toHaveLength(17);
    expect(disabled).toEqual(expect.arrayContaining(['E3', 'E5', 'E10', 'E11', 'E14', 'E15', 'E17', 'E19', 'E20', 'E21', 'E24', 'E25', 'E27', 'E32', 'E33', 'E34', 'E35']));
  });
  it('keeps pattern names within 40 characters and E30 outside any dimension', () => {
    for (const p of tips.patterns) expect(p.name.length, p.id).toBeLessThanOrEqual(40);
    expect(tips.patterns.find((p) => p.id === 'E30')?.dimension).toBe('none');
  });
  it('restricts E16, E23 and E31 to their instruments', () => {
    const inst = (id: string) => tips.patterns.find((p) => p.id === id)?.instruments;
    expect(inst('E16')).toEqual(['trumpet-bb']);
    expect(inst('E31')).toEqual(['clarinet-bb']);
    expect(inst('E23')).toEqual(['voice-soprano', 'voice-mezzo', 'voice-alto', 'voice-tenor', 'voice-baritone', 'voice-bass']);
  });
  it('has the 14 enabled universal tips and 23 enabled family tips of 02 §6.3 and §6.4', () => {
    const enabled = tips.tips.filter((t) => t.enabled);
    expect(enabled.filter((t) => t.scope === 'universal').map((t) => t.id).sort()).toEqual(['U01', 'U02', 'U04', 'U06', 'U07', 'U08', 'U09', 'U12', 'U13', 'U16', 'U17', 'U18', 'U20', 'U22']);
    expect(enabled.filter((t) => t.scope === 'family')).toHaveLength(23);
    expect(tips.tips.filter((t) => !t.enabled).length).toBe(tips.tips.length - enabled.length);
  });
  it('keeps tip text at 280 characters or fewer and enabled tips on enabled patterns', () => {
    for (const t of tips.tips) expect(t.text.length, t.id).toBeLessThanOrEqual(280);
    for (const t of tips.tips.filter((x) => x.enabled)) {
      for (const p of t.patterns) expect(enabledPatterns, `${t.id} -> ${p}`).toContain(p);
    }
  });
  it('keeps every beta-only family tip disabled (beta instruments get universal tips only, 02 §1.2)', () => {
    const betaIds = new Set(instruments.instruments.filter((i) => i.status === 'beta').map((i) => i.id));
    for (const t of tips.tips.filter((x) => x.scope === 'family' && (x.instruments ?? []).every((id) => betaIds.has(id)))) {
      expect(t.enabled, t.id).toBe(false);
    }
    for (const t of tips.tips.filter((x) => x.enabled && x.scope === 'family')) {
      expect((t.instruments ?? []).every((id) => instruments.instruments.find((i) => i.id === id)?.status === 'launch'), t.id).toBe(true);
    }
  });
  it('marks assertsCause tips per 02 §6.4 and quotes the tip text verbatim', () => {
    const c = tips.tips.filter((t) => t.assertsCause).map((t) => t.id).sort();
    expect(c).toEqual(['CL01', 'CL05', 'FL05', 'FL07', 'KB02', 'KB03', 'KB07', 'LS02', 'SX04', 'US02', 'US03', 'US05']);
    expect(tips.tips.find((t) => t.id === 'U18')?.text).toBe('Clean read. Try the next one 8 bpm faster, or a harder piece at the next difficulty.');
    expect(tips.tips.find((t) => t.id === 'SX04')?.condition).toBe('bflat-involved');
    expect(tips.tips.find((t) => t.id === 'U22')?.text).toContain('{offset}');
    expect(tips.tips.find((t) => t.id === 'U20')?.patterns).toEqual(['E28', 'E29']);
  });
  it('holds the flow rules of 02 §6.1', () => {
    expect(tips.selection).toMatchObject({ primaryMinLostPoints: 3, secondaryMinLostPoints: 5, maxTips: 2, skipRecent: 3, cleanReadPatternId: 'E30', cleanReadTipId: 'U18' });
    expect(tips.selection.assertsCause).toEqual({ minPrimary: 2, ofLast: 5 });
    expect(tips.selection.betaDisabledPatterns).toEqual(['E22', 'E23']);
  });
});

describe('data/trumpet-valves.json (02 §4.5)', () => {
  it('covers written F#3 (54) to C6 (84) once each, with the standard fingerings', () => {
    expect(valves.entries.map((e) => e.writtenMidi)).toEqual(Array.from({ length: 31 }, (_, i) => 54 + i));
    const at = (m: number) => valves.entries.find((e) => e.writtenMidi === m);
    expect(at(54)).toMatchObject({ valves: '123', partial: 2 });
    expect(at(60)).toMatchObject({ valves: '0', partial: 2 });
    expect(at(79)).toMatchObject({ valves: '0', partial: 6 });
    expect(at(84)).toMatchObject({ valves: '0', partial: 8 });
    expect(at(76)).toMatchObject({ valves: '0', partial: 5 });
  });
  it('is consistent with the open harmonic series minus valve length', () => {
    const open: Record<number, number> = { 2: 60, 3: 67, 4: 72, 5: 76, 6: 79, 8: 84 };
    const drop: Record<string, number> = { '0': 0, '2': 1, '1': 2, '12': 3, '23': 4, '13': 5, '123': 6 };
    for (const e of valves.entries) expect(open[e.partial]! - drop[e.valves]!, `written ${e.writtenMidi}`).toBe(e.writtenMidi);
  });
  it('puts written G5 and C6 on the same valves and neighbouring partials (02 §4.9 case 9)', () => {
    const g5 = valves.entries.find((e) => e.writtenMidi === 79);
    const c6 = valves.entries.find((e) => e.writtenMidi === 84);
    expect(g5?.valves).toBe(c6?.valves);
    const openPartials = valves.entries.filter((e) => e.valves === '0').map((e) => e.partial);
    expect(openPartials.indexOf(8) - openPartials.indexOf(6)).toBe(1);
  });
});
