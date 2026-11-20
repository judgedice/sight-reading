// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, mount, type Mounted } from '../../primitives/test-render.ts';
import { DiagnosticsButton, SureLine, type DiagnosticsButtonServices } from './index.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const m = (node: React.ReactNode): HTMLElement => {
  current = mount(node);
  return current.container;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

function services(over: Partial<DiagnosticsButtonServices> = {}): DiagnosticsButtonServices {
  const text = JSON.stringify({ x: 'y'.repeat(2048) });
  const file = { fileName: 'sightread-try-2026-11-19-1432.json', text, file: { tries: [{}] } };
  return {
    supportAddress: null,
    soundOptInShown: true,
    exportTry: vi.fn(async () => file),
    exportLast: vi.fn(async () => file),
    settings: vi.fn(async () => ({ includeAudio: false })),
    setSettings: vi.fn(async () => undefined),
    download: vi.fn(),
    ...over,
  };
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const names = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => b.textContent);

describe('DiagnosticsButton', () => {
  it('with no address the button and title read "Save diagnostics" and there is no send line', async () => {
    const c = m(<DiagnosticsButton services={services()} layout="dialog" />);
    expect(c.querySelector('button')?.textContent).toBe('Save diagnostics');
    click(c.querySelector('button') as HTMLElement);
    await flush();
    expect(dialog()?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Save diagnostics');
    expect(dialog()?.textContent).not.toContain('Email it to');
    expect(dialog()?.textContent).toContain('A file of what the app heard in this try');
    expect(dialog()?.querySelectorAll('li')).toHaveLength(3);
    expect(dialog()?.textContent).toContain('sightread-try-2026-11-19-1432.json · 2 KB');
    expect(dialog()?.textContent).toContain('Settings › Data');
  });

  it('with an address it reads "Send diagnostics" and names the address', async () => {
    const c = m(<DiagnosticsButton services={services({ supportAddress: 'help@example.test' })} layout="dialog" />);
    expect(c.querySelector('button')?.textContent).toBe('Send diagnostics');
    click(c.querySelector('button') as HTMLElement);
    await flush();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Send diagnostics');
    expect(dialog()?.textContent).toContain('Email it to help@example.test.');
  });

  it('shows the sound opt-in only when shown, and saves the choice', async () => {
    const s = services();
    const c = m(<DiagnosticsButton services={s} layout="dialog" />);
    click(c.querySelector('button') as HTMLElement);
    await flush();
    const sw = dialog()?.querySelector('[role="switch"]') as HTMLInputElement;
    expect(sw).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(dialog()?.textContent).toContain('This try has no sound.');
    click(sw);
    expect(s.setSettings).toHaveBeenCalledWith({ includeAudio: true });
    current?.unmount();
    document.body.innerHTML = '';

    const c2 = m(<DiagnosticsButton services={services({ soundOptInShown: false })} layout="dialog" />);
    click(c2.querySelector('button') as HTMLElement);
    await flush();
    expect(dialog()?.querySelector('[role="switch"]')).toBeNull();
  });

  it('Share appears only where the browser can share files; Save file downloads the file', async () => {
    const s = services();
    const c = m(<DiagnosticsButton services={s} layout="dialog" />);
    click(c.querySelector('button') as HTMLElement);
    await flush();
    expect(names(dialog() as HTMLElement).filter((n) => n === 'Share…')).toHaveLength(0);
    expect(names(dialog() as HTMLElement)).toEqual(expect.arrayContaining(['Cancel', 'Save file']));
    const save = [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Save file') as HTMLElement;
    click(save);
    expect(s.download).toHaveBeenCalledWith('sightread-try-2026-11-19-1432.json', expect.any(String));
    expect(dialog()?.textContent).toContain('Saved sightread-try-2026-11-19-1432.json.');
    current?.unmount();
    document.body.innerHTML = '';

    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn(async () => undefined) });
    const c2 = m(<DiagnosticsButton services={services()} layout="dialog" />);
    click(c2.querySelector('button') as HTMLElement);
    await flush();
    expect(names(dialog() as HTMLElement)).toContain('Share…');
  });

  it('exports the named try when given a tryId', async () => {
    const s = services();
    const c = m(<DiagnosticsButton services={s} tryId="abc" layout="dialog" />);
    click(c.querySelector('button') as HTMLElement);
    await flush();
    expect(s.exportTry).toHaveBeenCalledWith('abc');
    expect(s.exportLast).not.toHaveBeenCalled();
  });

  it('is a sheet on a phone layout, with the actions in the body, and Cancel closes it', async () => {
    const c = m(<DiagnosticsButton services={services()} layout="sheet" />);
    click(c.querySelector('button') as HTMLElement);
    await flush();
    expect(document.querySelector('.ui-sheet')).toBeTruthy();
    expect(document.querySelector('.ui-modal')).toBeNull();
    click([...document.querySelectorAll('.dg-actions button')].find((b) => b.textContent === 'Cancel') as HTMLElement);
    expect(dialog()).toBeNull();
  });

  it('keeps Save file inert when the try has no stored trace', async () => {
    const s = services({ exportLast: vi.fn(async () => null) });
    const c = m(<DiagnosticsButton services={s} layout="dialog" />);
    click(c.querySelector('button') as HTMLElement);
    await flush();
    const save = [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Save file') as HTMLElement;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    click(save);
    expect(s.download).not.toHaveBeenCalled();
  });
});

describe('SureLine', () => {
  it('words the three levels and shows the help only when unsure', () => {
    const c = m(<SureLine level="clear" steady={27} total={28} />);
    expect(c.textContent).toBe('We heard you clearly. 27 of 28 notes were steady and clear.');
    current?.unmount();
    expect(m(<SureLine level="clear" />).textContent).toBe('We heard you clearly.');
    current?.unmount();
    expect(m(<SureLine level="mostly" n={1} />).textContent).toBe('We heard most of it. 1 mark may be wrong.');
    current?.unmount();
    expect(m(<SureLine level="mostly" n={4} />).textContent).toBe('We heard most of it. 4 marks may be wrong.');
    current?.unmount();
    const c4 = m(<SureLine level="unsure" />);
    expect(c4.textContent).toContain("We weren't sure about many notes.");
    expect(c4.textContent).toContain('Move the mic away from the speakers');
    expect(c4.querySelectorAll('i[data-on="true"]')).toHaveLength(1);
  });
});
