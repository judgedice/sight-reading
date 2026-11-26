// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalize, setupModel, type SetupContext } from '../../../app/screens/setup/model.ts';
import { countEligible } from '../../../corpus/select/index.ts';
import { loadConfigs } from '../../../rules/index.ts';
import { shippedManifest } from '../../../corpus/select/testing/shipped.ts';
import type { Configs, KeySig, PracticeSettings } from '../../../core/types.ts';
import { act, click, key, mount, type Mounted } from '../../primitives/test-render.ts';
import { tokens } from '../../tokens.ts';
import { DifficultyControl } from './DifficultyControl.tsx';
import { FallbackNote, FALLBACK_NOTE_DURATION_MS } from './FallbackNote.tsx';
import { KeyGrid } from './KeyGrid.tsx';
import { LengthInline, LengthRow } from './LengthRow.tsx';
import { ModeControl } from './ModeControl.tsx';
import { ModePill } from './ModePill.tsx';
import { MiniKeyStaff, TimeSignatureMark } from './MusicMarks.tsx';
import { TempoRow } from './TempoRow.tsx';
import { TimeSegments } from './TimeSegments.tsx';
import type { DifficultyRowView, KeyRowView, LengthRowView, TempoRowView, TimeRowView } from './types.ts';
import { XpLine } from './XpLine.tsx';
import { difficultyRow, keyRow, lengthChoice, lengthOnly, tempoRow, timeRow } from './story/fixtures.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  vi.useRealTimers();
});

const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
const radios = (): HTMLElement[] => $$('[role="radio"]');
const byName = (name: string): HTMLElement => {
  const el = radios().find((r) => (r.getAttribute('aria-label') ?? r.textContent ?? '').startsWith(name));
  if (!el) throw new Error(`no radio ${name}`);
  return el;
};

/** A touch tap: pointer events with pointerType touch, then the click the browser fires. */
function tap(el: HTMLElement): void {
  act(() => {
    for (const type of ['pointerdown', 'pointerup']) {
      const e = new Event(type, { bubbles: true }) as Event & { pointerType?: string };
      Object.defineProperty(e, 'pointerType', { value: 'touch' });
      el.dispatchEvent(e);
    }
  });
  click(el);
}

// ---- The real setup model feeds the controls unchanged ------------------------------------------------------------

const read = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as unknown;
const cfg: Configs = loadConfigs({
  grading: read('config/grading-config.json'),
  levels: read('config/levels.json'),
  instruments: read('config/instruments.json'),
  progression: read('config/progression.json'),
  tips: read('config/tips.json'),
  budget: read('config/measurement-budget.json'),
  trumpetValves: read('data/trumpet-valves.json'),
} as never);
const manifest = shippedManifest((f) => readFileSync(join(process.cwd(), 'public/corpus/v1', f), 'utf8'));
const ctx: SetupContext = {
  cfg,
  eligible: (id, level, meter) => countEligible(manifest, id, level, meter, cfg),
  showBeta: false,
  playerLevel: () => 2,
};
const settings = (over: Partial<PracticeSettings>): PracticeSettings => ({
  instrumentId: 'flute',
  level: 2,
  writtenKey: 'random',
  meter: 'random',
  bpm: 'random',
  bars: 'random',
  // Practice: the chosen difficulty applies (Ranked is locked at the player's own, R76).
  mode: 'practice',
  listening: true,
  metronome: 'audible',
  clickTimbre: 'tick',
  outputMode: 'speakers',
  a4Hz: 440,
  ...over,
});

describe('fed by the setup model', () => {
  it.each(['flute', 'voice-bass', 'voice-baritone', 'trumpet-bb'])('%s: every key and meter chosen sends its value, Any sends random', (instrumentId) => {
    for (const level of [1, 2, 5]) {
      const m = setupModel(normalize(settings({ instrumentId, level }), ctx), ctx);
      // The model's rows are the controls' props, with no mapping (type check).
      const rows: [DifficultyRowView, KeyRowView, TimeRowView, TempoRowView, LengthRowView] = [m.difficulty, m.key, m.time, m.tempo, m.length];
      expect(rows).toHaveLength(5);

      const keys: (KeySig | 'random')[] = [];
      const clef = m.instrument.clefs[0]!.clef;
      current?.unmount();
      current = mount(<KeyGrid expanded row={m.key} clef={clef} difficulty={m.level} onChange={(k) => keys.push(k)} />);
      const options = m.key.groups.flatMap((g) => g.keys);
      expect(radios()).toHaveLength(options.length + 1);
      radios().slice(1).forEach((r) => click(r));
      click(radios()[0]!);
      expect(keys).toEqual([...options.map((o) => o.key), 'random']);
      if (m.instrument.writtenMinusSounding.chromatic !== 0) {
        expect($$('.su-chip-concert').length).toBe(options.length);
      }

      const meters: string[] = [];
      current.render(<TimeSegments expanded row={m.time} onChange={(v) => meters.push(v)} />);
      radios().slice(1).forEach((r) => click(r));
      click(radios()[0]!);
      expect(meters).toEqual([...m.time.options.map((o) => o.meter), 'random']);
    }
  });
});

// ---- Key grid ---------------------------------------------------------------------------------------------------

describe('KeyGrid', () => {
  it('chooses by mouse, touch and arrow keys; one Tab stop; Home and End', () => {
    const sent: (KeySig | 'random')[] = [];
    current = mount(<KeyGrid row={keyRow(1, '1:major', 3)} clef="bass" difficulty={2} onChange={(k) => sent.push(k)} />);
    expect($('[role="radiogroup"]').getAttribute('aria-labelledby')).toBeTruthy();
    expect(radios().filter((r) => r.tabIndex === 0)).toEqual([byName('G major')]);
    expect(byName('G major').getAttribute('aria-checked')).toBe('true');
    expect(byName('G major').querySelector('.su-check')).not.toBeNull();

    click(byName('F major'));
    tap(byName('A minor'));
    click(byName('Any key'));
    expect(sent).toEqual([{ fifths: -1, mode: 'major' }, { fifths: 0, mode: 'minor' }, 'random']);

    sent.length = 0;
    key(byName('G major'), 'ArrowRight');
    expect(document.activeElement).toBe(byName('F major'));
    key(byName('G major'), 'ArrowLeft');
    key(byName('G major'), 'Home');
    key(byName('G major'), 'End');
    key(byName('D minor'), 'ArrowDown');
    expect(sent).toEqual([{ fifths: -1, mode: 'major' }, { fifths: 0, mode: 'major' }, 'random', { fifths: -1, mode: 'minor' }, 'random']);
  });

  it('up to eight keys: one row, then the key note read with the group (round 2, 01-ux section 7)', () => {
    current = mount(<KeyGrid row={keyRow(1, null, 3)} clef="bass" difficulty={2} onChange={() => undefined} />);
    expect($$('[data-key-button]')).toHaveLength(0);
    expect($('.su-key-row').getAttribute('role')).toBe('radiogroup');
    const note = byId($('[role="radiogroup"]').getAttribute('aria-describedby')!);
    expect(note.textContent).toBe('Difficulty 2 uses major and minor keys with up to 1 sharp or flat. Keys with 2 sharps or flats start at difficulty 3.');
    expect(document.body.textContent).not.toContain('More keys from');
    // Each chip draws a small signature and names the key.
    expect(byName('G major').querySelector('.su-key-sig svg')).not.toBeNull();
    expect(byName('G major').textContent).toBe('G major');
  });

  it('expanded (the phone sheet): names each chip in full, groups Major then Minor, concert keys shown', () => {
    current = mount(<KeyGrid expanded row={keyRow(3, '3:major', 6, -2)} clef="treble" difficulty={5} onChange={() => undefined} />);
    expect(byName('A major').getAttribute('aria-label')).toBe('A major, 3 sharps, sounds G major');
    expect(byName('C major').getAttribute('aria-label')).toBe('C major, no sharps or flats, sounds B♭ major');
    expect($$('.su-key-group-label').map((p) => p.textContent)).toEqual(['Major', 'Minor']);
    expect($$('.su-chip-concert').length).toBe(14);
  });

  it('above eight keys: one button with the value and the count; the keys open in a popover and choosing closes it', () => {
    const sent: (KeySig | 'random')[] = [];
    current = mount(<KeyGrid row={keyRow(3, '3:major', 6)} clef="treble" difficulty={5} onChange={(k) => sent.push(k)} />);
    const button = $('[data-key-button]');
    expect(radios()).toHaveLength(0);
    expect(button.textContent).toContain('A major');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(byId(button.getAttribute('aria-describedby')!).textContent).toBe('14 keys: major and minor, up to 3 sharps or flats.');
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const pop = $('[data-key-popover]');
    expect($$('.su-key-group-label').map((p) => p.textContent)).toEqual(['Major', 'Minor']);
    // Popover chips show the tonic; the spoken name is the full key. Any key sits at the foot.
    expect(byName('E♭ major').textContent).toBe('E♭');
    expect(pop.querySelector('.su-key-pop-foot [role="radio"]')!.textContent).toContain('Any key');
    expect(pop.textContent).toContain('Pick one key, or Any for more XP.');
    click(byName('E♭ major'));
    expect(sent).toEqual([{ fifths: -3, mode: 'major' }]);
    expect($$('[data-key-popover]')).toHaveLength(0);
  });
});

describe('MiniKeyStaff and TimeSignatureMark', () => {
  it('draws the signature at the token staff space, never scaled, with one mark per accidental', () => {
    current = mount(<MiniKeyStaff clef="treble" fifths={-3} />);
    const svg = $('svg');
    const sp = tokens.component['key-chip-staff-space'];
    expect(sp).toBe(6.5);
    expect(Number(svg.getAttribute('height'))).toBeCloseTo((2.4 + 4 + 2) * sp, 1);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`);
    expect(svg.querySelectorAll('line')).toHaveLength(5);
    expect(svg.querySelectorAll('path')).toHaveLength(1 + 3);
    current.render(<MiniKeyStaff clef="bass" fifths={0} />);
    expect(Number($('svg').getAttribute('height'))).toBeCloseTo((1.6 + 4 + 1.6) * sp, 1);
    current.render(<TimeSignatureMark beats={12} unit={8} />);
    expect(Number($('svg').getAttribute('height'))).toBe(4 * tokens.component['time-glyph-staff-space']);
    expect($$('svg path')).toHaveLength(3);
  });
});

// ---- Time --------------------------------------------------------------------------------------------------------

describe('TimeSegments', () => {
  it('Any first, spoken names that always name the meter, a few-pieces dot, the unavailable line read with the group', () => {
    const sent: string[] = [];
    current = mount(<TimeSegments row={timeRow('3/4')} onChange={(v) => sent.push(v)} />);
    expect(radios().map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Any', '4 4 time', '3/4, few pieces']);
    const three = byName('3/4');
    expect(three.querySelector('.su-few-dot')).not.toBeNull();
    expect(three.querySelector('[title]')!.getAttribute('title')).toBe('Few pieces');
    const group = $('[role="radiogroup"]');
    expect(byId(group.getAttribute('aria-describedby')!).textContent).toBe('No 2/4 at difficulty 2 yet.');
    click(byName('4 4 time'));
    tap(radios()[0]!);
    key(three, 'ArrowRight');
    expect(sent).toEqual(['4/4', 'random', 'random']);
  });

  it('above seven meters: Any, the most used and More; a meter chosen there joins the row', () => {
    const base = timeRow('random');
    const opt = (meter: string, selected = false) => {
      const [beats, unit] = meter.split('/').map(Number) as [number, number];
      return { meter, beats, unit, few: false, selected, a11y: { key: 'setup.time.a11y', vars: { beats, unit } } };
    };
    const all = ['4/4', '3/4', '2/4', '6/8', '2/2', '3/8', '3/2', '9/8'];
    const row = (chosen: string | null) => {
      const options = all.map((m) => opt(m, m === chosen));
      return { ...base, any: { ...base.any, selected: chosen === null }, options, top: options.slice(0, 5), more: options.slice(5), hiddenNote: null };
    };
    const sent: string[] = [];
    current = mount(<TimeSegments row={row(null)} onChange={(v) => sent.push(v)} />);
    expect(radios()).toHaveLength(6);
    const more = $('[data-time-more]');
    expect(more.textContent).toBe('More3');
    click(more);
    const pop = $('[data-time-popover]');
    expect([...pop.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('aria-label'))).toEqual(['3 8 time', '3 2 time', '9 8 time']);
    click(pop.querySelector<HTMLElement>('[aria-label="9 8 time"]')!);
    expect(sent).toEqual(['9/8']);
    expect($$('[data-time-popover]')).toHaveLength(0);
    current.render(<TimeSegments row={row('9/8')} onChange={() => undefined} />);
    expect(radios().map((r) => r.getAttribute('aria-label') ?? r.textContent).at(-1)).toBe('9 8 time');
    expect($('[data-time-more]').textContent).toBe('More2');
    current.render(<TimeSegments expanded row={row(null)} onChange={() => undefined} />);
    expect(radios()).toHaveLength(9);
    expect($$('[data-time-more]')).toHaveLength(0);
  });
});

// ---- Difficulty --------------------------------------------------------------------------------------------------

describe('DifficultyControl', () => {
  it('steps, skips nothing it should not, shows the description with the Few pieces tag; no Follow switch (R76)', () => {
    const sent: number[] = [];
    current = mount(<DifficultyControl row={difficultyRow(false)} onChange={(v) => sent.push(v)} />);
    expect($('.ui-stepper-value').textContent).toBe('2of 10');
    expect($$('.dom-diff-seg[data-state="no-music"]')).toHaveLength(2);
    expect(document.body.textContent).toContain('Adds eighths, minor keys and one-beat pickups.');
    // The served range is on the range card now, not here (round 2, 01-ux section 6).
    expect(document.body.textContent).not.toContain('At difficulty 2: C3 to C4');
    const tag = $('[data-setup-few]');
    expect(tag.getAttribute('title')).toBe('Few pieces here: some may repeat.');
    expect(tag.querySelector('[aria-hidden="true"]')!.textContent).toBe('Few pieces');
    expect(tag.querySelector('.ui-visually-hidden')!.textContent).toBe('Few pieces here: some may repeat.');
    const group = $('.su-diff-line');
    expect(byId(group.getAttribute('aria-describedby')!).textContent).toBe('No music yet for Baritone voice at difficulty 7 to 8.');
    click($('[aria-label="Increase Difficulty"]'));
    click($('[aria-label="Decrease Difficulty"]'));
    expect($$('input[role="switch"]')).toHaveLength(0);
    expect(sent).toEqual([3, 1]);
  });

  it('Practice: the brass mark at your difficulty, how the choice sits, and Find my difficulty (R75, R76)', () => {
    let found = 0;
    current = mount(<DifficultyControl row={difficultyRow(false)} onChange={() => undefined} onFindLevel={() => found++} placementCount={3} />);
    expect($$('.ui-stepper')).toHaveLength(1);
    expect($('.su-diff-meter').getAttribute('data-yours')).toBe('1');
    expect(document.body.textContent).toContain('One above your difficulty (1).');
    expect(document.body.textContent).toContain('Not sure? Find my difficulty · 3 short pieces');
    click($('[data-testid="find-difficulty"]'));
    expect(found).toBe(1);
  });

  it('Ranked: a read-only row at your difficulty and why it cannot change there (R76)', () => {
    current = mount(<DifficultyControl row={difficultyRow(true)} onChange={() => undefined} onFindLevel={() => undefined} />);
    expect($$('.ui-stepper')).toHaveLength(0);
    expect($('[data-locked="true"]').textContent).toContain('Difficulty 1 of 10, Your difficulty');
    expect(document.body.textContent).toContain('Ranked tries are at your difficulty. It moves up as you do. To choose another, switch to Practice.');
    expect($$('[data-testid="find-difficulty"]')).toHaveLength(0);
  });
});

describe('ModePill (R79)', () => {
  it('Ranked is solid brass, Practice dashed; the accessible name is the visible text', () => {
    current = mount(<ModePill mode="ranked" />);
    expect($('[data-testid="mode-pill"]').getAttribute('data-mode')).toBe('ranked');
    expect($('[data-testid="mode-pill"]').textContent).toBe('Ranked');
    current.render(<ModePill mode="practice" detail="seen before" />);
    expect($('[data-testid="mode-pill"]').getAttribute('data-mode')).toBe('practice');
    expect($('[data-testid="mode-pill"]').textContent).toBe('Practice · seen before');
    expect($('[data-testid="mode-pill"] svg').getAttribute('aria-hidden')).toBe('true');
  });
});

// ---- Tempo -------------------------------------------------------------------------------------------------------

describe('TempoRow', () => {
  it('Any shows the range; the set segment reads the marking and shows the slider and Hear the tempo', () => {
    const sent: (number | 'random')[] = [];
    const heard: number[] = [];
    current = mount(<TempoRow row={tempoRow(true)} value="random" onChange={(v) => sent.push(v)} onHearTempo={(b) => heard.push(b)} />);
    expect($('[data-tempo-range]').textContent).toBe('♩ = 60 to 84');
    expect($$('input[type="range"]')).toHaveLength(0);
    expect(radios().map((r) => r.getAttribute('aria-label'))).toEqual(['Any tempo in range', '♩ equals 72']);
    click(radios()[1]!);
    expect(sent).toEqual([72]);

    current.render(
      <TempoRow row={tempoRow(false)} value={72} onChange={(v) => sent.push(v)} onHearTempo={(b) => heard.push(b)} end={<LengthInline bars={8} />} />,
    );
    expect($('[data-tempo-mark]').textContent).toBe('♩ = 72');
    expect($('[data-tempo-unit]').textContent).toBe('♩');
    expect($<HTMLInputElement>('input[type="range"]').getAttribute('aria-valuetext')).toBe('♩ equals 72');
    click($('[data-hear-tempo]'));
    expect(heard).toEqual([72]);
    expect($('[data-setup-row="length"]').textContent).toBe('Length8 bars');
    click(radios()[0]!);
    expect(sent).toEqual([72, 'random']);
  });
});

// ---- Length, Mode, XP line ---------------------------------------------------------------------------------------

describe('LengthRow', () => {
  it('one length is text; two or more are Any and the bar counts', () => {
    current = mount(<LengthRow row={lengthOnly} onChange={() => undefined} />);
    expect(document.body.textContent).toContain('8 bars (the only length at difficulty 2)');
    expect(radios()).toHaveLength(0);
    const sent: (number | 'random')[] = [];
    current.render(<LengthRow row={lengthChoice} onChange={(v) => sent.push(v)} />);
    expect(radios().map((r) => r.textContent)).toEqual(['Any', '8 bars', '10 bars', '12 bars']);
    click(byName('10 bars'));
    key(byName('Any'), 'End');
    expect(sent).toEqual([10, 12]);
  });
});

describe('ModeControl', () => {
  it('shows the selected hint', () => {
    current = mount(<ModeControl value="ranked" onChange={() => undefined} />);
    expect(document.body.textContent).toContain('At your difficulty, with timed reading and fresh music. Full XP, and good tries move you up.');
  });

  it.each([
    ['calibration', 'Ranked needs calibration on this device.', 'Calibrate'],
    ['mic', 'Ranked needs the microphone.', 'Turn on microphone'],
  ] as const)('blocked by %s: Ranked stays focusable, is never chosen, and the hint line names the reason with its fix as a link', (block, reason, fix) => {
    const sent: string[] = [];
    const fixed: string[] = [];
    current = mount(<ModeControl value="practice" rankedBlock={block} onChange={(v) => sent.push(v)} onFix={(b) => fixed.push(b)} />);
    const ranked = byName('Ranked');
    expect(ranked.getAttribute('aria-disabled')).toBe('true');
    expect(ranked.hasAttribute('disabled')).toBe(false);
    expect(byId(ranked.getAttribute('aria-describedby')!).textContent).toBe(reason);
    click(ranked);
    tap(ranked);
    key(byName('Practice'), 'ArrowLeft');
    expect(document.activeElement).toBe(ranked);
    expect(sent).toEqual([]);
    // One fix control, inside the hint line; no second button.
    const fixes = $$('button').filter((b) => b.textContent === fix);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.closest('.su-mode-hint')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Calibrate now');
    click(fixes[0]!);
    expect(fixed).toEqual([block]);
    expect($('.su-mode-hint').textContent).toBe(`Any difficulty, no time limit, listen first if you like. A quarter of the XP, and your difficulty stays the same. ${reason} ${fix}`);
    current.render(<ModeControl value="practice" rankedBlock={block} onChange={() => undefined} />);
    expect($$('button').filter((b) => b.textContent === fix)).toHaveLength(0);
    expect(byId(byName('Ranked').getAttribute('aria-describedby')!).textContent).toBe(reason);
  });
});

describe('XpLine', () => {
  it('bolds the percent; at 0 it renders the none line or nothing', () => {
    current = mount(<XpLine line={{ key: 'setup.xp.line', vars: { percent: 24 } }} />);
    expect($('[data-setup-xp]').textContent).toBe('Choosing Any: +24% XP');
    expect($('[data-setup-xp] b').textContent).toBe('+24% XP');
    current.render(<XpLine line={null} />);
    expect($$('[data-setup-xp]')).toHaveLength(0);
    current.render(<XpLine line={null} none={{ key: 'setup.xp.none', vars: {} }} />);
    expect($('[data-setup-xp]').textContent).toBe('Choose Any for more XP.');
  });
});

describe('FallbackNote', () => {
  it('shows for 6 s in a polite region, announces through the screen region when given, and shows again on a new stamp', () => {
    vi.useFakeTimers();
    const note = { key: 'setup.fallback.key', vars: { key: 'E minor', level: 1 } };
    const expired = vi.fn();
    current = mount(<FallbackNote note={note} stamp={1} onExpire={expired} />);
    expect($('[role="status"]').getAttribute('aria-live')).toBe('polite');
    expect($('.su-fallback').textContent).toBe("Key set to Any: E minor isn't used at difficulty 1.");
    act(() => vi.advanceTimersByTime(FALLBACK_NOTE_DURATION_MS - 1));
    expect($$('.su-fallback')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect($$('.su-fallback')).toHaveLength(0);
    expect(expired).toHaveBeenCalledTimes(1);

    const said: string[] = [];
    current.render(<FallbackNote note={note} stamp={2} announce={(t) => said.push(t)} />);
    expect($$('[role="status"]')).toHaveLength(0);
    expect($$('.su-fallback')).toHaveLength(1);
    expect(said).toEqual(["Key set to Any: E minor isn't used at difficulty 1."]);
  });
});

// ---- 05 section 16 item 4 ----------------------------------------------------------------------------------------

describe('no control is disabled without a visible reason next to it', () => {
  it('every disabled or aria-disabled control names a visible, non-empty reason', () => {
    current = mount(
      <div>
        <DifficultyControl row={difficultyRow(false)} onChange={() => undefined} />
        <KeyGrid row={keyRow(1, null, 3)} clef="bass" difficulty={2} onChange={() => undefined} />
        <TimeSegments row={timeRow('random')} onChange={() => undefined} />
        <TempoRow row={tempoRow(false)} value={72} onChange={() => undefined} onHearTempo={() => undefined} />
        <LengthRow row={lengthChoice} onChange={() => undefined} />
        <ModeControl value="practice" rankedBlock="calibration" onChange={() => undefined} onFix={() => undefined} />
      </div>,
    );
    const inert = $$('[aria-disabled="true"], :disabled');
    expect(inert.length).toBeGreaterThan(0);
    for (const el of inert) {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      const reasons = ids.map((id) => document.getElementById(id)).filter((r): r is HTMLElement => r !== null && !r.hidden);
      expect(reasons.map((r) => r.textContent?.trim()).join(''), el.outerHTML.slice(0, 120)).not.toBe('');
      // The reason is in the same row as the control.
      expect(reasons.every((r) => r.closest('[data-setup-row]') === el.closest('[data-setup-row]'))).toBe(true);
    }
  });
});
