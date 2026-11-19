// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, key, mount, type Mounted } from '../../primitives/test-render.ts';
import { INFO_HOVER_DELAY_MS } from '../../primitives/InfoButton.tsx';
import { SHEET_SWIPE_DISTANCE } from '../../primitives/Sheet.tsx';
import { CoachMark } from './CoachMark.tsx';
import { LiveCaption } from './LiveCaption.tsx';
import { ListenConfirm } from './ListenConfirm.tsx';
import { ReferenceInfo, referenceText } from './ReferenceInfo.tsx';
import { SoundsDock } from './SoundsDock.tsx';
import { SoundsExplainSheet } from './SoundsExplainSheet.tsx';
import { SoundsGroup } from './SoundsGroup.tsx';
import { formatClock } from './ListenConfirm.tsx';
import type { SoundsModel } from './types.ts';

// The reference text as 05 section 10 sets it, quoted here on purpose so a catalogue edit cannot drift unnoticed.
const VOICE_INFO =
  "This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there. We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in.";
const INSTRUMENT_INFO = 'The key chord is the home chord of this piece, at concert pitch. It gives away no notes, so you can use it in ranked takes too.';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const q = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];

function pointer(el: Element, type: string, init: { pointerType?: string; clientY?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', cancelable: true, clientY: init.clientY ?? 0 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    el.dispatchEvent(event);
  });
}

function stubMedia(matching: (query: string) => boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: matching(query), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

const model = (over: Partial<SoundsModel> = {}): SoundsModel => ({
  reference: 'voice',
  ranked: true,
  tempo: { unit: '♩', bpm: 72 },
  tuning: false,
  tuningSeconds: 3,
  playing: null,
  ...over,
});

describe('reference text (05 section 10)', () => {
  it('the voice and instrument popovers carry the spec text verbatim, under their titles', () => {
    expect(referenceText('voice').body).toBe(VOICE_INFO);
    expect(referenceText('instrument').body).toBe(INSTRUMENT_INFO);
    expect(referenceText('voice').title).toBe('What is the reference?');
    expect(referenceText('instrument').title).toBe('What is the key chord?');
    for (const [kind, body, title] of [
      ['voice', VOICE_INFO, 'What is the reference?'],
      ['instrument', INSTRUMENT_INFO, 'What is the key chord?'],
    ] as const) {
      current = mount(<ReferenceInfo kind={kind} />);
      click(q('.ui-info-button'));
      expect(q('.ui-popover-title').textContent).toBe(title);
      expect(q('.ui-popover-body').textContent).toBe(body);
      current.unmount();
      current = null;
    }
  });

  it('the popover and the explain sheet show the same text', () => {
    current = mount(<SoundsExplainSheet open model={model()} onClose={() => undefined} />);
    expect(q('.sd-explain-ref-title').textContent).toBe('What is the reference?');
    expect(q('.sd-explain-ref-body').textContent).toBe(VOICE_INFO);
  });

  it('the info button is named for its control, carries the caption as a native title and is a real button', () => {
    current = mount(<ReferenceInfo kind="voice" />);
    const button = q('.ui-info-button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('About Hear starting pitch');
    expect(button.getAttribute('title')).toBe('Plays the key chord, then your first note.');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    current.unmount();
    current = mount(<ReferenceInfo kind="instrument" />);
    expect(q('.ui-info-button').getAttribute('aria-label')).toBe('About Hear the key');
    expect(q('.ui-info-button').getAttribute('title')).toBe('Plays the key chord, so you hear the key.');
  });
});

describe('the popover opens by click, tap, Enter, Space and a 400 ms hover with a fine pointer', () => {
  it('a mouse click opens it and pins it', () => {
    current = mount(<ReferenceInfo kind="voice" />);
    click(q('.ui-info-button'));
    expect(document.querySelector('.ui-popover')).not.toBeNull();
    expect(q('.ui-info-button').getAttribute('aria-expanded')).toBe('true');
  });

  it('a tap (touch pointer, then the click it produces) opens it, and hovering as touch does not', () => {
    vi.useFakeTimers();
    stubMedia(() => false);
    current = mount(<ReferenceInfo kind="voice" />);
    const button = q('.ui-info-button');
    pointer(button, 'pointerenter', { pointerType: 'touch' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.querySelector('.ui-popover')).toBeNull();
    pointer(button, 'pointerdown', { pointerType: 'touch' });
    click(button);
    expect(document.querySelector('.ui-popover')).not.toBeNull();
  });

  it.each([['Enter'], [' ']])('%j on the focused button opens it (a browser turns Enter and Space on a button into a click)', (k) => {
    current = mount(<ReferenceInfo kind="instrument" />);
    const button = q('.ui-info-button') as HTMLButtonElement;
    expect(button.type).toBe('button');
    button.focus();
    // The platform's activation behaviour: keydown Enter fires click; Space fires click on keyup.
    key(button, k);
    act(() => {
      if (k === ' ') button.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
      button.click();
    });
    expect(document.querySelector('.ui-popover')).not.toBeNull();
    expect(q('.ui-popover-body').textContent).toBe(INSTRUMENT_INFO);
  });

  it('a 400 ms hover with a fine pointer opens it; leaving closes it', () => {
    vi.useFakeTimers();
    stubMedia((query) => query.includes('pointer: fine'));
    current = mount(<ReferenceInfo kind="voice" />);
    const button = q('.ui-info-button');
    pointer(button, 'pointerenter', { pointerType: 'mouse' });
    act(() => void vi.advanceTimersByTime(INFO_HOVER_DELAY_MS - 10));
    expect(document.querySelector('.ui-popover')).toBeNull();
    act(() => void vi.advanceTimersByTime(20));
    expect(document.querySelector('.ui-popover')).not.toBeNull();
    pointer(button, 'pointerleave', { pointerType: 'mouse' });
    act(() => void vi.advanceTimersByTime(300));
    expect(document.querySelector('.ui-popover')).toBeNull();
  });

  it('Escape closes it and focus returns to the button', () => {
    current = mount(<ReferenceInfo kind="voice" />);
    const button = q('.ui-info-button');
    click(button);
    q('.ui-popover').focus();
    key(document, 'Escape');
    expect(document.querySelector('.ui-popover')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe('SoundsGroup (desktop)', () => {
  it('lists Listen first, Hear the tempo and Hear starting pitch for a voice, with captions and no tuning', () => {
    current = mount(<SoundsGroup model={model()} onPress={() => undefined} headerNote="note" />);
    const titles = qa('.sd-sound-label').map((el) => el.textContent);
    expect(titles).toEqual(['Listen first', 'Hear the tempo', 'Hear starting pitch']);
    const captions = qa('.sd-sound-caption').map((el) => el.textContent);
    expect(captions[0]).toBe('Makes this practice');
    expect(captions[1]).toBe('One bar of clicks at ♩ = 72.');
    expect(captions[2]).toBe('Plays the key chord, then your first note.');
    expect(qa('.ui-info-button')).toHaveLength(1);
  });

  it('shows Hear the key and Check my tuning for a clarinet, and the practice caption outside ranked', () => {
    current = mount(<SoundsGroup model={model({ reference: 'instrument', tuning: true, ranked: false })} onPress={() => undefined} />);
    expect(qa('.sd-sound-label').map((el) => el.textContent)).toEqual(['Listen first', 'Hear the tempo', 'Hear the key', 'Check my tuning']);
    expect(qa('.sd-sound-caption')[0]?.textContent).toBe('Hear how it goes before you play.');
    expect(qa('.sd-sound-caption')[3]?.textContent).toBe("Hold any note for 3 seconds. We'll allow for your tuning.");
  });

  it('a press reports the sound; the playing sound has the brass state and Listen reads Stop', () => {
    const onPress = vi.fn();
    current = mount(<SoundsGroup model={model({ ranked: false, playing: 'listen' })} onPress={onPress} />);
    const first = q('[data-sound=listen]');
    expect(first.getAttribute('data-playing')).toBe('true');
    expect(first.querySelector('.sd-sound-label')?.textContent).toBe('Stop');
    expect(q('[data-sound=tempo]').getAttribute('data-playing')).toBeNull();
    click(q('[data-sound=tempo] .sd-sound-main'));
    expect(onPress).toHaveBeenCalledWith('tempo');
  });

  it('a disabled sound is aria-disabled, stays focusable and ignores a press', () => {
    const onPress = vi.fn();
    current = mount(<SoundsGroup model={model({ disabled: { tempo: true } })} onPress={onPress} />);
    const button = q('[data-sound=tempo] .sd-sound-main');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders the header note only when given', () => {
    current = mount(<SoundsGroup model={model()} onPress={() => undefined} headerNote="Quiet during the take" />);
    expect(q('.sd-group-note').textContent).toBe('Quiet during the take');
    current.render(<SoundsGroup model={model()} onPress={() => undefined} />);
    expect(document.querySelector('.sd-group-note')).toBeNull();
  });

  it('shows the live caption above the card with bars hidden from assistive tech', () => {
    current = mount(<SoundsGroup model={model({ playing: 'reference' })} onPress={() => undefined} caption="Key chord: G major" />);
    const cap = q('[data-testid=live-caption]');
    expect(cap.textContent).toBe('Key chord: G major');
    expect(cap.querySelector('.sd-eq')?.getAttribute('aria-hidden')).toBe('true');
    expect(cap.compareDocumentPosition(q('.sd-group')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('SoundsDock (phone)', () => {
  it('has three buttons with short labels and the full name as the accessible name', () => {
    current = mount(<SoundsDock model={model()} onPress={() => undefined} />);
    const buttons = qa('.sd-dock-button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Listen first', 'Hear the tempo', 'Hear starting pitch']);
    expect(buttons.map((b) => b.querySelector('.sd-dock-label')?.textContent)).toEqual(['Listen first', 'Tempo', 'Starting pitch']);
    expect(qa('.sd-dock-button[data-sound=listen] .sd-dock-sub')[0]?.textContent).toBe('Makes this practice');
  });

  it('uses Key for instruments and leaves Check my tuning out of the dock', () => {
    current = mount(<SoundsDock model={model({ reference: 'instrument', tuning: true })} onPress={() => undefined} />);
    expect(qa('.sd-dock-button').map((b) => b.getAttribute('aria-label'))).toEqual(['Listen first', 'Hear the tempo', 'Hear the key']);
    expect(qa('.sd-dock-label').map((b) => b.textContent)).toEqual(['Listen first', 'Tempo', 'Key']);
  });

  it('has no second line in practice, and Listen reads Stop while it plays', () => {
    current = mount(<SoundsDock model={model({ ranked: false, playing: 'listen' })} onPress={() => undefined} />);
    expect(document.querySelector('.sd-dock-sub')).toBeNull();
    expect(q('.sd-dock-button[data-sound=listen]').getAttribute('aria-label')).toBe('Stop');
  });

  it('"What do these do?" opens the explain sheet', () => {
    current = mount(<SoundsDock model={model()} onPress={() => undefined} />);
    expect(document.querySelector('[data-testid=explain-list]')).toBeNull();
    click(q('.sd-dock-info'));
    expect(q('.ui-sheet-title').textContent).toBe('What do these do?');
    expect(q('[data-testid=explain-list]')).not.toBeNull();
  });
});

describe('SoundsExplainSheet', () => {
  it('lists three rows for a voice, by full name, with the reference row highlighted', () => {
    current = mount(<SoundsExplainSheet open model={model()} onClose={() => undefined} />);
    expect(qa('.sd-explain-row')).toHaveLength(3);
    expect(qa('.sd-explain-title').map((el) => el.textContent)).toEqual(['Listen first', 'Hear the tempo', 'Hear starting pitch']);
    expect(qa('.sd-explain-row[data-highlight=true]').map((el) => el.dataset['sound'])).toEqual(['reference']);
    expect(q('.sd-explain-extra').textContent).toBe('In a ranked take, this makes it practice. We ask first.');
  });

  it('lists four rows for a clarinet: the dock sounds plus Check my tuning', () => {
    current = mount(<SoundsExplainSheet open model={model({ reference: 'instrument', tuning: true })} onClose={() => undefined} />);
    expect(qa('.sd-explain-row')).toHaveLength(4);
    expect(qa('.sd-explain-title').map((el) => el.textContent)).toEqual(['Listen first', 'Hear the tempo', 'Hear the key', 'Check my tuning']);
    expect(q('.sd-explain-ref-body').textContent).toBe(INSTRUMENT_INFO);
  });

  it('never reads Stop and has no ranked line in practice; the first caption is the practice one', () => {
    current = mount(<SoundsExplainSheet open model={model({ ranked: false, playing: 'listen' })} onClose={() => undefined} />);
    expect(qa('.sd-explain-title')[0]?.textContent).toBe('Listen first');
    expect(qa('.sd-explain-caption')[0]?.textContent).toBe('Hear how it goes before you play.');
    expect(document.querySelector('.sd-explain-extra')).toBeNull();
  });

  it('closes on Escape and on the scrim', () => {
    const onClose = vi.fn();
    current = mount(<SoundsExplainSheet open model={model()} onClose={onClose} />);
    key(document, 'Escape');
    click(q('[data-testid=sheet-scrim]'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('LiveCaption', () => {
  it('shows three bars and the text; a failure shows the text without bars; empty keeps only the line', () => {
    current = mount(<LiveCaption>{'Key chord: G major'}</LiveCaption>);
    expect(qa('.sd-eq i')).toHaveLength(3);
    current.render(<LiveCaption failed>{"That sound didn't play."}</LiveCaption>);
    expect(document.querySelector('.sd-eq')).toBeNull();
    expect(q('.sd-live-cap').textContent).toBe("That sound didn't play.");
    current.render(<LiveCaption />);
    expect(q('.sd-live-cap').textContent).toBe('');
  });

  it('is not a live region of its own: the screen announces (05 section 14 item 7)', () => {
    current = mount(<LiveCaption>{'Tempo'}</LiveCaption>);
    expect(q('.sd-live-cap').getAttribute('aria-live')).toBeNull();
    expect(q('.sd-live-cap').getAttribute('role')).toBeNull();
  });
});

describe('ListenConfirm', () => {
  const noop = (): void => undefined;

  it('on desktop is a dialog with Keep it ranked primary and focused, and states the time left', () => {
    stubMedia(() => false);
    current = mount(<ListenConfirm open secondsLeft={18} onKeepRanked={noop} onListen={noop} />);
    expect(q('[role=dialog]').classList.contains('ui-modal')).toBe(true);
    expect(q('.ui-modal-title').textContent).toBe('Listen first?');
    expect(q('.ui-modal-body').textContent).toContain("Hearing the music before you play makes this a practice take. It earns less XP and doesn't count toward your rank.");
    expect(q('[data-testid=confirm-time]').textContent).toBe('0:18 left');
    const keep = document.activeElement as HTMLElement;
    expect(keep.textContent).toBe('Keep it ranked');
    expect(keep.classList.contains('ui-button-primary')).toBe(true);
    expect(qa('.ui-modal-foot .ui-button').map((b) => b.textContent)).toEqual(['Listen, make it practice', 'Keep it ranked']);
  });

  it('on phones is a sheet with Keep it ranked first, primary and focused', () => {
    stubMedia((query) => query.includes('max-width: 639'));
    current = mount(<ListenConfirm open secondsLeft={18} onKeepRanked={noop} onListen={noop} />);
    expect(q('[role=dialog]').classList.contains('ui-sheet')).toBe(true);
    expect(qa('.sd-confirm-actions .ui-button').map((b) => b.textContent)).toEqual(['Keep it ranked', 'Listen, make it practice']);
    expect((document.activeElement as HTMLElement).textContent).toBe('Keep it ranked');
  });

  it.each([['dialog'], ['sheet']] as const)('%s: Escape and a scrim tap keep it ranked, and nothing starts', (presentation) => {
    const keep = vi.fn();
    const listen = vi.fn();
    current = mount(<ListenConfirm open secondsLeft={18} presentation={presentation} onKeepRanked={keep} onListen={listen} />);
    key(document, 'Escape');
    expect(keep).toHaveBeenCalledTimes(1);
    click(q(presentation === 'dialog' ? '[data-testid=modal-scrim]' : '[data-testid=sheet-scrim]'));
    expect(keep).toHaveBeenCalledTimes(2);
    expect(listen).not.toHaveBeenCalled();
  });

  it('a swipe down on the sheet keeps it ranked', () => {
    const keep = vi.fn();
    current = mount(<ListenConfirm open secondsLeft={18} presentation="sheet" onKeepRanked={keep} onListen={noop} />);
    const grabber = q('[data-testid=sheet-grabber]');
    pointer(grabber, 'pointerdown', { clientY: 100 });
    pointer(grabber, 'pointermove', { clientY: 100 + SHEET_SWIPE_DISTANCE + 10 });
    pointer(grabber, 'pointerup', { clientY: 100 + SHEET_SWIPE_DISTANCE + 10 });
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('"Listen, make it practice" is the only way in, and it fires once', () => {
    const keep = vi.fn();
    const listen = vi.fn();
    current = mount(<ListenConfirm open secondsLeft={18} presentation="dialog" onKeepRanked={keep} onListen={listen} />);
    click(qa('.ui-modal-foot .ui-button')[0] as HTMLElement);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(keep).not.toHaveBeenCalled();
  });

  it('closes as "Keep it ranked" when the time reaches 0 while it is open', () => {
    const keep = vi.fn();
    current = mount(<ListenConfirm open secondsLeft={1} presentation="dialog" onKeepRanked={keep} onListen={noop} />);
    expect(keep).not.toHaveBeenCalled();
    current.render(<ListenConfirm open secondsLeft={0} presentation="dialog" onKeepRanked={keep} onListen={noop} />);
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed, and takes a wording override for the time line', () => {
    current = mount(<ListenConfirm open={false} secondsLeft={18} onKeepRanked={noop} onListen={noop} />);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    current.render(<ListenConfirm open secondsLeft={18} presentation="dialog" timeLine="custom" onKeepRanked={noop} onListen={noop} />);
    expect(q('[data-testid=confirm-time]').textContent).toBe('custom');
  });

  it('formats the clock as m:ss', () => {
    expect(formatClock(18)).toBe('0:18');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('CoachMark', () => {
  it('is an inline note with "Got it", in the flow and never positioned over anything', () => {
    const onDismiss = vi.fn();
    current = mount(<CoachMark onDismiss={onDismiss} />);
    expect(q('[data-testid=coach-mark]').getAttribute('role')).toBe('note');
    expect(q('[data-testid=coach-mark]').textContent).toBe('New: hear the tempo, the key and the music before you play.Got it');
    expect(document.querySelector('[aria-modal]')).toBeNull();
    click(q('.ui-button'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
