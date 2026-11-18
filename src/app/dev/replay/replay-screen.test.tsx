// @vitest-environment jsdom
// P20 <DevReplayScreen>: loads a render stream and an attempt export from a file input, reports a replay that matches
// the stored results, reports a bad file, and scrubs the event timeline.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttemptRecord } from '../../../core/types.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { makeAttempt } from '../../../store/test-data.ts';
import { DevReplayScreen } from './replay-screen.tsx';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

async function load(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

function q(c: HTMLElement, id: string): HTMLElement {
  const el = c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no ${id}`);
  return el;
}

const streamText = readFileSync(join(process.cwd(), 'fixtures', 'render', 'mozart-violin-stop.events.jsonl'), 'utf8');

describe('<DevReplayScreen>', () => {
  it('asks for a file before anything is loaded', () => {
    m = mount(<DevReplayScreen />);
    expect(m.container.textContent).toContain('Load a file to replay it.');
    expect(m.container.querySelector('[data-testid="screen-dev-replay"]')).not.toBeNull();
  });

  it('replays a render stream and shows its final alignment once the cursor is at the end', async () => {
    m = mount(<DevReplayScreen />);
    const input = q(m.container, 'replay-file') as HTMLInputElement;
    await load(input, new File([streamText], 'mozart.events.jsonl', { type: 'application/x-ndjson' }));
    expect(q(m.container, 'replay-label').textContent).toBe('mozart.events.jsonl');
    expect(q(m.container, 'replay-final').textContent).toMatch(/judgments/);
    expect(q(m.container, 'replay-end').textContent).toBe('complete');
    expect(q(m.container, 'replay-problems').textContent).toBe('Stream problems: none.');
  });

  it('scrubbing back before the final shows the final as not reached', async () => {
    m = mount(<DevReplayScreen />);
    const input = q(m.container, 'replay-file') as HTMLInputElement;
    await load(input, new File([streamText], 'mozart.events.jsonl'));
    const range = q(m.container, 'replay-cursor') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(range, '3');
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(q(m.container, 'replay-final').textContent).toBe('not reached');
    expect(q(m.container, 'replay-end').textContent).toBe('-');
  });

  it('reports an attempt replay that matches its stored results and offers the diagnostics download', async () => {
    const r: AttemptRecord = makeAttempt(3, {
      judgments: [
        {
          expectedIdx: 0, status: 'matched', detectedId: 1, timing: 'on-time', timingErrorMs: 2, pitch: 'in-tune', playedConcertMidi: 60, centsError: 0,
          octaveDisplaced: false, duration: 'ok', heldRatio: 1, credit: { p: 1, n: 1, o: 1, d: 1 }, marginal: false, rejudged: false,
        },
      ],
    });
    m = mount(<DevReplayScreen />);
    const input = q(m.container, 'replay-file') as HTMLInputElement;
    await load(input, new File([JSON.stringify(r)], 'attempt.json', { type: 'application/json' }));
    expect(q(m.container, 'replay-identity').getAttribute('data-ok')).toBe('true');
    expect(q(m.container, 'replay-identity').textContent).toBe('Replay matches the stored results.');
    expect(q(m.container, 'replay-export').textContent).toBe('Download diagnostics');
    expect(q(m.container, 'replay-judged').textContent).toBe('1');
  });

  it('shows the parse error for a file that is not a replay source', async () => {
    m = mount(<DevReplayScreen />);
    const input = q(m.container, 'replay-file') as HTMLInputElement;
    await load(input, new File(['{"hello": 1}'], 'bad.json'));
    expect(q(m.container, 'replay-error').textContent).toMatch(/bad\.json is neither/);
    expect(m.container.textContent).toContain('Load a file to replay it.');
  });
});
