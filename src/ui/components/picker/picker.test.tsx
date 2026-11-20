// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import grading from '../../../../config/grading-config.json';
import instrumentsJson from '../../../../config/instruments.json';
import budget from '../../../../config/measurement-budget.json';
import levels from '../../../../config/levels.json';
import progression from '../../../../config/progression.json';
import tips from '../../../../config/tips.json';
import trumpetValves from '../../../../data/trumpet-valves.json';
import type { RawConfigs } from '../../../core/types.ts';
import { getInstrument } from '../../../instruments/index.ts';
import { keyboardSpan, pictureNotes, rangeModel, staffPlan } from '../../../instruments/range.ts';
import { loadConfigs } from '../../../rules/load-configs.ts';
import { click, key, mount, type Mounted } from '../../primitives/test-render.ts';
import type { RangeData } from '../range/types.ts';
import { InstrumentGrid } from './InstrumentGrid.tsx';
import { soundSetFor } from '../../../instruments/sound-sets.ts';
import { InstrumentPicker, type InstrumentPickerProps, type PickerSoundView } from './InstrumentPicker.tsx';
import { pickerGroups, readingOrder } from './groups.ts';

const cfg = loadConfigs({ grading, levels, instruments: instrumentsJson, progression, tips, budget, trumpetValves } as unknown as RawConfigs);
const instruments = cfg.instruments.instruments;
const rangeFor = (id: string): RangeData => {
  const inst = getInstrument(cfg, id);
  const model = rangeModel(cfg, inst, 2);
  return { model, staff: staffPlan(inst, pictureNotes(model)), keyboard: keyboardSpan(model, inst) };
};

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
});

const all = <T extends Element = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));
const one = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`no ${sel}`);
  return el;
};
const card = (id: string): HTMLButtonElement => one<HTMLButtonElement>(`[data-instrument="${id}"]`);
const buttonByText = (text: string): HTMLButtonElement => {
  const b = all<HTMLButtonElement>('button').find((el) => el.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};
const checkedIds = (): string[] => all('[role="radio"][aria-checked="true"]').map((el) => el.dataset['instrument'] ?? '');

function Grid({ value, onChange, more = false }: { value: string | null; onChange: (id: string) => void; more?: boolean }) {
  return <InstrumentGrid instruments={instruments} value={value} onChange={onChange} rangeFor={rangeFor} showLessTested={more} layout="desktop" />;
}

/** A controlled grid that follows its own onChange, like the picker does. */
function mountGrid(initial: string | null, more = false) {
  const onChange = vi.fn();
  let value = initial;
  const render = (): void => current?.render(<Grid value={value} onChange={handle} more={more} />);
  const handle = (id: string): void => {
    onChange(id);
    value = id;
    render();
  };
  current = mount(<Grid value={value} onChange={handle} more={more} />);
  return onChange;
}

function mountPicker(props: Partial<InstrumentPickerProps> = {}) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  current = mount(
    <InstrumentPicker
      open
      instruments={instruments}
      value="voice-bass"
      rangeFor={rangeFor}
      showLessTested={false}
      onDone={onDone}
      onCancel={onCancel}
      layout="dialog"
      {...props}
    />,
  );
  return { onDone, onCancel };
}

describe('picker groups (05 section 6.2)', () => {
  it('voice group shows every voice in config order', () => {
    const configVoices = instruments.filter((i) => i.family === 'voice').map((i) => i.id);
    expect(configVoices).toEqual(['voice-soprano', 'voice-mezzo', 'voice-alto', 'voice-tenor', 'voice-baritone', 'voice-bass']);
    expect(pickerGroups(instruments, { showLessTested: false })[0]).toMatchObject({ id: 'voice' });
    mountGrid('voice-bass');
    const voiceCards = all('[aria-labelledby$="-voice"] [role="radio"]').map((el) => el.dataset['instrument']);
    expect(voiceCards).toEqual(configVoices);
    expect(all('[aria-labelledby$="-voice"] .pk-name').map((el) => el.textContent)).toEqual([
      'Soprano',
      'Mezzo',
      'Alto',
      'Tenor',
      'Baritone',
      'Bass',
    ]);
  });

  it('orders groups and cards as the spec lists them, less tested last', () => {
    const groups = pickerGroups(instruments, { showLessTested: true });
    expect(groups.map((g) => g.id)).toEqual(['voice', 'woodwinds', 'brass', 'strings', 'keyboard']);
    const ids = (g: string): string[] => groups.find((x) => x.id === g)!.instruments.map((i) => i.id);
    expect(ids('woodwinds')).toEqual(['flute', 'clarinet-bb', 'sax-alto', 'oboe', 'bassoon', 'sax-tenor', 'sax-bari']);
    expect(ids('brass')).toEqual(['trumpet-bb', 'horn-f', 'trombone', 'euphonium-bc', 'euphonium-tc', 'tuba']);
    expect(ids('strings')).toEqual(['violin', 'cello', 'viola', 'double-bass', 'guitar']);
    expect(ids('keyboard')).toEqual(['piano-rh', 'piano-lh']);
  });

  it('hides less-tested instruments unless the switch is on or one is the current choice', () => {
    const off = readingOrder(pickerGroups(instruments, { showLessTested: false }));
    expect(off).not.toContain('oboe');
    expect(off).toHaveLength(instruments.filter((i) => i.status === 'launch').length);
    expect(readingOrder(pickerGroups(instruments, { showLessTested: false, keep: ['oboe'] }))).toContain('oboe');
  });
});

describe('instrument cards (05 section 6.3, 06 section 6.11)', () => {
  it('names a card with its full name and range: "Baritone voice, range G2 to G4"', () => {
    mountGrid('voice-bass');
    expect(card('voice-baritone').getAttribute('aria-label')).toBe('Baritone voice, range G2 to G4');
    expect(card('voice-baritone').getAttribute('role')).toBe('radio');
  });

  it('voices show the sung range; tenor adds "Written an octave higher"', () => {
    mountGrid('voice-bass');
    expect(card('voice-tenor').querySelector('.pk-range')?.textContent).toBe('A2 to A4');
    expect(card('voice-tenor').querySelector('.pk-note')?.textContent).toBe('Written an octave higher');
    expect(card('voice-tenor').querySelector('.pk-clef')).not.toBeNull();
  });

  it('transposing cards keep the written range and add "bars show sounding pitch"', () => {
    mountGrid('voice-bass');
    const clarinet = card('clarinet-bb');
    expect(clarinet.querySelector('.pk-range')?.textContent).toBe('E3 to G6');
    expect(Array.from(clarinet.querySelectorAll('.pk-note > span')).map((s) => s.textContent)).toEqual([
      'Sounds a major 2nd lower',
      'bars show sounding pitch',
    ]);
    expect(card('flute').querySelector('.pk-note')?.textContent).toBe('');
  });

  it('every card has the same skeleton: icon, name, range, ruler, second line', () => {
    mountGrid('voice-bass');
    for (const el of all('[role="radio"]')) {
      expect(Array.from(el.children).map((c) => c.className.split(' ')[0])).toEqual(
        expect.arrayContaining(['pk-pic', 'pk-name', 'pk-range', 'pk-ruler', 'pk-note']),
      );
    }
  });

  it('marks the selected card with aria-checked and a check mark', () => {
    mountGrid('voice-baritone');
    expect(checkedIds()).toEqual(['voice-baritone']);
    expect(card('voice-baritone').querySelector('.pk-check')).not.toBeNull();
    expect(card('voice-bass').querySelector('.pk-check')).toBeNull();
  });

  it('marks less-tested cards with the badge', () => {
    mountGrid('voice-bass', true);
    expect(card('oboe').querySelector('.pk-badge')?.textContent).toBe('less tested');
    expect(card('flute').querySelector('.pk-badge')).toBeNull();
  });
});

describe('radio group keyboard (05 section 6.3, 14 item 3)', () => {
  it('has one Tab stop, on the selected card', () => {
    mountGrid('voice-tenor');
    expect(all('[role="radio"]').filter((el) => el.tabIndex === 0).map((el) => el.dataset['instrument'])).toEqual(['voice-tenor']);
    expect(all('[role="radiogroup"]')).toHaveLength(1);
  });

  it('arrow keys move across groups and select', () => {
    const onChange = mountGrid('voice-bass');
    act(() => card('voice-bass').focus());
    key(card('voice-bass'), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('flute');
    expect(document.activeElement).toBe(card('flute'));
    key(card('flute'), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('voice-bass');
    expect(document.activeElement).toBe(card('voice-bass'));
    key(card('voice-bass'), 'ArrowDown');
    key(card('flute'), 'ArrowDown');
    expect(onChange).toHaveBeenLastCalledWith('clarinet-bb');
    key(card('clarinet-bb'), 'ArrowUp');
    expect(onChange).toHaveBeenLastCalledWith('flute');
  });

  it('Home and End jump to the first and last card; arrows wrap', () => {
    const onChange = mountGrid('voice-baritone');
    key(card('voice-baritone'), 'End');
    expect(onChange).toHaveBeenLastCalledWith('piano-rh');
    key(card('piano-rh'), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('voice-soprano');
    key(card('voice-soprano'), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('piano-rh');
    key(card('piano-rh'), 'Home');
    expect(onChange).toHaveBeenLastCalledWith('voice-soprano');
  });

  it('Space and Enter select (the cards are buttons) and so does a click', () => {
    const onChange = mountGrid(null);
    click(card('voice-mezzo'));
    expect(onChange).toHaveBeenLastCalledWith('voice-mezzo');
    expect(card('voice-mezzo').tagName).toBe('BUTTON');
    expect(card('voice-mezzo').type).toBe('button');
  });

  it('with nothing selected, the first card is the Tab stop', () => {
    mountGrid(null);
    expect(all('[role="radio"]').filter((el) => el.tabIndex === 0).map((el) => el.dataset['instrument'])).toEqual(['voice-soprano']);
  });
});

describe('InstrumentPicker dialog (05 section 6.4)', () => {
  it('opens on the current instrument with focus on its card and its picture in the right column', () => {
    mountPicker({ value: 'voice-bass' });
    expect(one('[role="dialog"]').getAttribute('aria-modal')).toBe('true');
    expect(checkedIds()).toEqual(['voice-bass']);
    expect(document.activeElement).toBe(card('voice-bass'));
    expect(one('.pk-column [data-testid="range-a11y"]').textContent).toBe('Bass voice range: E2 to F4. At difficulty 2: A2 to A3.');
    expect(all('.pk-column [data-testid="keyboard-strip"]')).toHaveLength(1);
  });

  it('a pick updates the picture at once; Done applies it', () => {
    const { onDone, onCancel } = mountPicker();
    click(card('voice-baritone'));
    expect(checkedIds()).toEqual(['voice-baritone']);
    expect(one('.pk-picked-name').textContent).toBe('Baritone voice');
    expect(one('.pk-column [data-testid="range-a11y"]').textContent).toBe('Baritone voice range: G2 to G4. At difficulty 2: C3 to C4.');
    click(buttonByText('Done'));
    expect(onDone).toHaveBeenCalledWith({ instrumentId: 'voice-baritone', showLessTested: false });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancel discards the pick', () => {
    const { onDone, onCancel } = mountPicker();
    click(card('voice-baritone'));
    click(buttonByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Escape discards the pick', () => {
    const { onDone, onCancel } = mountPicker();
    click(card('voice-baritone'));
    key(document, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reopening starts again from the current instrument', () => {
    const props = { instruments, value: 'voice-bass', rangeFor, showLessTested: false, onDone: vi.fn(), onCancel: vi.fn(), layout: 'dialog' as const };
    current = mount(<InstrumentPicker open {...props} />);
    click(card('voice-baritone'));
    current.render(<InstrumentPicker open={false} {...props} />);
    current.render(<InstrumentPicker open {...props} />);
    expect(checkedIds()).toEqual(['voice-bass']);
  });

  it('the less-tested switch shows more cards and is reported with Done', () => {
    const { onDone } = mountPicker();
    expect(all('[data-instrument="oboe"]')).toHaveLength(0);
    const sw = one<HTMLInputElement>('input[role="switch"]');
    click(sw);
    expect(all('[data-instrument="oboe"]')).toHaveLength(1);
    click(card('oboe'));
    click(buttonByText('Done'));
    expect(onDone).toHaveBeenCalledWith({ instrumentId: 'oboe', showLessTested: true });
  });

  it('note buttons in the picture call onHearNote with the sounding pitch and the instrument', () => {
    const onHearNote = vi.fn();
    mountPicker({ onHearNote });
    click(card('clarinet-bb'));
    click(one('.pk-column button[aria-label="Hear E3"]'));
    expect(onHearNote).toHaveBeenCalledWith(50, 'clarinet-bb');
  });
});

describe('InstrumentPicker sheet (phones, designer note 6)', () => {
  it('has Cancel and Done in the head and a pinned panel without the keyboard strip', () => {
    const { onDone, onCancel } = mountPicker({ layout: 'sheet', onHearNote: vi.fn() });
    expect(one('.pk-sheet').getAttribute('role')).toBe('dialog');
    expect(all('[data-testid="picker-panel"] [data-testid="range-picture"]')).toHaveLength(1);
    expect(all('[data-testid="picker-panel"] [data-testid="keyboard-strip"]')).toHaveLength(0);
    expect(all('[data-testid="picker-panel"] button.rp-note-pill')).toHaveLength(4);
    click(card('voice-baritone'));
    expect(one('[data-testid="picker-panel"] .pk-picked-name').textContent).toBe('Baritone voice');
    click(buttonByText('Done'));
    expect(onDone).toHaveBeenCalledWith({ instrumentId: 'voice-baritone', showLessTested: false });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancel, Escape and a scrim tap discard', () => {
    const { onDone, onCancel } = mountPicker({ layout: 'sheet' });
    click(buttonByText('Cancel'));
    key(document, 'Escape');
    click(one('[data-testid="sheet-scrim"]'));
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('lists the non-voice groups one card a row', () => {
    mountPicker({ layout: 'sheet' });
    expect(all('.pk-grid-phone .pk-cards-list').length).toBeGreaterThan(0);
    expect(all('.pk-grid-phone .pk-cards-voices [role="radio"]')).toHaveLength(6);
  });
});

/** A fake sound path that records every call and plays nothing: the picker's side of "Play my range". */
function fakeSound() {
  const state = { playing: null as string | null, index: null as number | null, failed: false };
  const calls = { play: [] as Array<{ id: string; midis: readonly number[] }>, stop: 0, prepare: [] as string[] };
  let rejectNext = false;
  const view = (): PickerSoundView => ({
    play: (id, midis) => {
      calls.play.push({ id, midis });
      if (rejectNext) return Promise.reject(new Error('blocked'));
      state.playing = id;
      state.index = 0;
      return Promise.resolve();
    },
    stop: () => {
      calls.stop++;
      state.playing = null;
      state.index = null;
    },
    prepare: (id) => void calls.prepare.push(id),
    ...state,
  });
  return { state, calls, view, failNext: () => (rejectNext = true) };
}

function mountWithSound(fake: ReturnType<typeof fakeSound>, extra: Partial<InstrumentPickerProps> = {}) {
  const props = {
    instruments,
    value: 'voice-baritone',
    rangeFor,
    showLessTested: false,
    onDone: vi.fn(),
    onCancel: vi.fn(),
    layout: 'dialog' as const,
    standInFor: (id: string) => soundSetFor(id).standIn,
    ...extra,
  };
  const draw = (): void => current?.render(<InstrumentPicker open {...props} sound={fake.view()} />);
  current = mount(<InstrumentPicker open {...props} sound={fake.view()} />);
  return { draw };
}

describe('Play my range (round 2, 01-ux section 2)', () => {
  it('choosing a card plays nothing and only prepares sound on hover or focus', () => {
    const fake = fakeSound();
    mountWithSound(fake);
    click(card('voice-bass'));
    click(card('trumpet-bb'));
    expect(fake.calls.play).toEqual([]);
    expect(fake.calls.stop).toBe(0);
    expect(fake.calls.prepare).toContain('trumpet-bb');
  });

  it('Play my range plays the four chips low to high with the instrument id', async () => {
    const fake = fakeSound();
    mountWithSound(fake);
    expect(one('[data-testid="play-range"]').textContent).toBe('Play my range');
    expect(one('.pk-play-caption').textContent).toBe('Lowest, your notes at difficulty 2, highest.');
    await act(async () => click(one('[data-testid="play-range"]')));
    expect(fake.calls.play).toHaveLength(1);
    const { id, midis } = fake.calls.play[0]!;
    expect(id).toBe('voice-baritone');
    expect(midis).toHaveLength(4);
    expect([...midis]).toEqual([...midis].sort((a, b) => a - b));
    expect(soundSetFor(id).set).toBe('voice-baritone');
  });

  it('shows Stop, "Playing C3", step dots, and brass chip, notehead and key for the sounding note', () => {
    const fake = fakeSound();
    fake.state.playing = 'voice-baritone';
    fake.state.index = 1;
    mountWithSound(fake);
    expect(one('[data-testid="play-range"]').textContent).toBe('Stop');
    expect(one('[data-testid="play-now"]').textContent).toMatch(/^Playing [A-G]/);
    expect(all('[data-testid="play-steps"] i')).toHaveLength(4);
    expect(all('[data-testid="play-steps"] i.is-now')).toHaveLength(1);
    expect(all('.pk-column [data-sounding="true"]')).toHaveLength(1);
    expect(all('.pk-column .rp-note-lit')).toHaveLength(1);
    expect(all('.pk-column .rp-kb-lit')).toHaveLength(1);
  });

  it('Stop ends the sound', () => {
    const fake = fakeSound();
    fake.state.playing = 'voice-baritone';
    fake.state.index = 0;
    mountWithSound(fake);
    click(one('[data-testid="play-range"]'));
    expect(fake.calls.stop).toBe(1);
  });

  it('switching to Bass while Baritone plays stops the sound; so do Done and Cancel', async () => {
    const fake = fakeSound();
    mountWithSound(fake);
    await act(async () => click(one('[data-testid="play-range"]')));
    click(card('voice-bass'));
    expect(fake.calls.stop).toBe(1);
    expect(fake.state.playing).toBeNull();
    await act(async () => click(one('[data-testid="play-range"]')));
    expect(fake.calls.play[1]!.id).toBe('voice-bass');
    click(buttonByText('Cancel'));
    current?.unmount();
    expect(fake.calls.stop).toBe(2);
  });

  it('a voice says how it will sound; a euphonium says the trombone stands in', () => {
    const fake = fakeSound();
    mountWithSound(fake);
    expect(one('[data-testid="sound-line"]').textContent).toContain('This is how it will sound.');
    expect(one('[data-testid="sound-line"]').textContent).toContain('in baritone range');
    click(card('voice-bass'));
    click(card('trumpet-bb'));
    expect(one('[data-testid="sound-line"]').textContent).toContain('trumpet sound');
    expect(all('[data-testid="stand-in-line"]')).toHaveLength(0);
  });

  it('euphonium shows the trombone stand-in line', () => {
    const fake = fakeSound();
    mountWithSound(fake, { value: 'euphonium-bc', showLessTested: true });
    expect(one('[data-testid="stand-in-line"]').textContent).toBe("There's no euphonium sound yet. You'll hear a trombone.");
    expect(soundSetFor('euphonium-bc')).toEqual({ set: 'trombone', standIn: 'trombone' });
  });

  it('a sound that fails to start shows the failed line', async () => {
    const fake = fakeSound();
    fake.failNext();
    mountWithSound(fake);
    await act(async () => click(one('[data-testid="play-range"]')));
    expect(one('[data-testid="play-failed"]').textContent).toBe("That sound didn't play. Check your volume and try again.");
  });

  it('without a sound path the picker has no Play button', () => {
    mountPicker();
    expect(all('[data-testid="play-range"]')).toHaveLength(0);
  });
});
