// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, mount, type Mounted } from '../../primitives/test-render.ts';
import { copy } from '../../copy/copy.ts';
import {
  BeatDots,
  ChecklistItem,
  ComponentBar,
  DifficultyMeter,
  EmptyState,
  GradeBadge,
  HeatStrip,
  LevelMeter,
  RankEmblem,
  ScanTimer,
  StarRow,
  TipCard,
  VerdictGlyph,
  beatPulses,
  difficultySegments,
  groupBeats,
  heatLevel,
  meterZone,
  rankGlyphId,
  scanFraction,
} from './index.ts';
import { GLYPH_IDS } from '../../glyph-ids.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
});
const m = (node: React.ReactNode): HTMLElement => {
  current = mount(node);
  return current.container;
};

describe('BeatDots', () => {
  it('renders one dot per beat with a larger downbeat and marks the current beat', () => {
    const c = m(<BeatDots beatsPerBar={4} currentBeat={2} />);
    const dots = c.querySelectorAll('.dom-beat-dot');
    expect(dots).toHaveLength(4);
    expect(dots[0]?.getAttribute('data-downbeat')).toBe('true');
    expect(dots[1]?.getAttribute('data-downbeat')).toBeNull();
    expect([...dots].map((d) => d.getAttribute('data-state'))).toEqual(['past', 'pulse', 'idle', 'idle']);
    expect(c.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
  it('groups 5/8 as 3+2 and ignores a grouping that does not add up', () => {
    expect(groupBeats(5, [3, 2])).toEqual([[1, 2, 3], [4, 5]]);
    expect(groupBeats(5, [3, 3])).toEqual([[1, 2, 3, 4, 5]]);
    const c = m(<BeatDots beatsPerBar={5} grouping={[3, 2]} currentBeat={null} />);
    expect(c.querySelectorAll('.dom-beats-group')).toHaveLength(2);
  });
  it('above 180 bpm only odd beats pulse', () => {
    expect(beatPulses(2, 120)).toBe(true);
    expect(beatPulses(1, 200)).toBe(true);
    expect(beatPulses(2, 200)).toBe(false);
    const c = m(<BeatDots beatsPerBar={4} currentBeat={2} bpm={200} />);
    expect(c.querySelector('[data-beat="2"]')?.getAttribute('data-state')).toBe('steady');
  });
  it('shows numbers during the count-in', () => {
    const c = m(<BeatDots beatsPerBar={3} currentBeat={3} countIn />);
    expect([...c.querySelectorAll('.dom-beat-number')].map((n) => n.textContent)).toEqual(['1', '2', '3']);
  });
});

describe('DifficultyMeter', () => {
  it('fills `level` of ten segments and leaves the rest empty', () => {
    expect(difficultySegments(3)).toEqual(['filled', 'filled', 'filled', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(difficultySegments(0).every((s) => s === 'empty')).toBe(true);
    expect(difficultySegments(99).every((s) => s === 'filled')).toBe(true);
    expect(difficultySegments(Number.NaN).every((s) => s === 'empty')).toBe(true);
  });
  it('marks segments with no music as hollow dashed, over filled or empty', () => {
    expect(difficultySegments(5, [4, 5, 6])).toEqual(['filled', 'filled', 'filled', 'no-music', 'no-music', 'no-music', 'empty', 'empty', 'empty', 'empty']);
    const c = m(<DifficultyMeter level={2} noMusic={[9, 10]} />);
    const segs = [...c.querySelectorAll('.dom-diff-seg')].map((e) => e.getAttribute('data-state'));
    expect(segs).toHaveLength(10);
    expect(segs.slice(7)).toEqual(['empty', 'no-music', 'no-music']);
  });
  it('is hidden from assistive tech', () => {
    const c = m(<DifficultyMeter level={2} />);
    expect(c.querySelector('.dom-diff')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('LevelMeter', () => {
  it('classifies the three zones', () => {
    expect(meterZone(-50, -40, false)).toBe('below-gate');
    expect(meterZone(-20, -40, false)).toBe('good');
    expect(meterZone(-2, -40, false)).toBe('clipping');
    expect(meterZone(-20, -40, true)).toBe('clipping');
  });
  it('shows "!" only while clipping and is decorative by default', () => {
    const c = m(<LevelMeter levelDb={-20} gateDb={-40} clipping={false} />);
    expect(c.querySelector('.dom-meter-bang')).toBeNull();
    expect(c.querySelector('.dom-meter')?.getAttribute('aria-hidden')).toBe('true');
    current?.render(<LevelMeter levelDb={-1} gateDb={-40} clipping />);
    expect(c.querySelector('.dom-meter-bang')?.textContent).toBe(copy('play.meter.clip'));
  });
  it('exposes a meter role when not decorative', () => {
    const c = m(<LevelMeter levelDb={-30} gateDb={-40} clipping={false} decorative={false} label="Input" />);
    const el = c.querySelector('[role=meter]');
    expect(el?.getAttribute('aria-valuenow')).toBe('-30');
  });
});

describe('BeatDots states', () => {
  it('marks beats already played as past, the current one, and the rest as idle', () => {
    const c = m(<BeatDots beatsPerBar={4} currentBeat={3} />);
    expect([...c.querySelectorAll('.dom-beat-dot')].map((d) => d.getAttribute('data-state'))).toEqual(['past', 'past', 'pulse', 'idle']);
    current?.render(<BeatDots beatsPerBar={4} currentBeat={null} />);
    expect([...c.querySelectorAll('.dom-beat-dot')].every((d) => d.getAttribute('data-state') === 'idle')).toBe(true);
  });
});

describe('ScanTimer', () => {
  it('fills the ring in proportion to the time left', () => {
    expect(scanFraction(15, 30)).toBe(0.5);
    expect(scanFraction(-1, 30)).toBe(0);
    expect(scanFraction(5, 0)).toBe(0);
    const c = m(<ScanTimer remainingSec={7.2} totalSec={30} mode="ranked" />);
    expect(c.querySelector('.dom-scan-number')?.textContent).toBe('8');
    expect(c.querySelector('.dom-scan-ring-fill')).not.toBeNull();
  });
  it('shows a check at 0 in practice but a plain 0 when ranked', () => {
    const p = m(<ScanTimer remainingSec={0} totalSec={30} mode="practice" />);
    expect(p.querySelector('.dom-scan-check')).not.toBeNull();
    expect(p.querySelector('.dom-scan-number')).toBeNull();
    current?.render(<ScanTimer remainingSec={0} totalSec={30} mode="ranked" />);
    expect(p.querySelector('.dom-scan-number')?.textContent).toBe('0');
  });
});

describe('ChecklistItem', () => {
  it('marks active and checked states', () => {
    const c = m(
      <ul>
        <ChecklistItem checked title="Signatures" detail="D major" active />
      </ul>,
    );
    const li = c.querySelector('li');
    expect(li?.getAttribute('data-active')).toBe('true');
    expect(li?.getAttribute('aria-current')).toBe('step');
    expect(c.querySelector('.dom-check-mark svg')).not.toBeNull();
  });
  it('toggles through a checkbox button when onToggle is given', () => {
    const onToggle = vi.fn();
    const c = m(
      <ul>
        <ChecklistItem checked={false} title="Tempo" onToggle={onToggle} />
      </ul>,
    );
    const box = c.querySelector('[role=checkbox]') as HTMLElement;
    expect(box.getAttribute('aria-checked')).toBe('false');
    click(box);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe('GradeBadge pills', () => {
  it.each([
    ['ranked', 'badge.ranked'],
    ['practice', 'badge.practice'],
    ['not-graded', 'results.badge.notGraded'],
    ['incomplete', 'badge.incomplete'],
  ] as const)('renders the %s pill from copy', (kind, key) => {
    const c = m(<GradeBadge kind={kind} />);
    const pill = c.querySelector('.dom-pill');
    expect(pill?.getAttribute('data-kind')).toBe(kind);
    expect(pill?.textContent).toContain(copy(key));
  });
  it('explains an incomplete take with its cap, in text and not only a tooltip', () => {
    const c = m(<GradeBadge kind="incomplete" cap={60} />);
    const why = copy('badge.incomplete.tooltip', { cap: 60 });
    expect(c.querySelector('.dom-pill')?.getAttribute('title')).toBe(why);
    expect(c.querySelector('.dom-sr')?.textContent).toBe(why);
    expect(c.querySelector('.dom-pill svg')).not.toBeNull();
  });
  it('has no letter or score in a pill', () => {
    const c = m(<GradeBadge kind="ranked" />);
    expect(c.querySelector('.dom-grade')).toBeNull();
  });
});

describe('GradeBadge and StarRow', () => {
  it('names the grade, score and stars (04 5.5.2)', () => {
    const c = m(<GradeBadge grade="B" score={85} size={72} stars={2} />);
    expect(c.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('Grade B, 85 out of 100, 2 stars');
    expect(c.querySelector('.dom-grade-score')?.textContent).toBe('85');
  });
  it('omits the score at size 32', () => {
    const c = m(<GradeBadge grade="A" score={92} />);
    expect(c.querySelector('.dom-grade-score')).toBeNull();
    expect(c.querySelector('.dom-grade-letter')?.textContent).toBe('A');
  });
  it('fills the stars it is given and shines only at three', () => {
    const c = m(<StarRow stars={2} shine />);
    expect([...c.querySelectorAll('.dom-star')].map((s) => s.getAttribute('data-filled'))).toEqual(['true', 'true', 'false']);
    expect(c.querySelector('.dom-stars')?.getAttribute('data-shine')).toBeNull();
    current?.render(<StarRow stars={3} shine size="results" label="3 stars" />);
    expect(c.querySelector('.dom-stars')?.getAttribute('data-shine')).toBe('true');
    expect(c.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('3 stars');
  });
});

describe('ComponentBar', () => {
  it('draws one bar filled to the value and shows the number', () => {
    const c = m(<ComponentBar label="Notes" value={86} explainer="Right notes." />);
    expect((c.querySelector('.dom-cbar-fill') as HTMLElement).style.inlineSize).toBe('86%');
    expect(c.querySelector('.dom-cbar-value')?.textContent).toBe('86');
    expect(c.querySelector('[role=meter]')?.getAttribute('aria-valuenow')).toBe('86');
  });
  it('clamps the fill into 0 to 100', () => {
    const c = m(<ComponentBar label="Notes" value={150} explainer="x" />);
    expect((c.querySelector('.dom-cbar-fill') as HTMLElement).style.inlineSize).toBe('100%');
  });
  it('marks only the weakest bar with a hatch attribute that the stylesheet turns into a pattern', () => {
    const c = m(
      <div>
        <ComponentBar label="Notes" value={76} explainer="x" focus />
        <ComponentBar label="In tune" value={93} explainer="x" />
      </div>,
    );
    const fills = [...c.querySelectorAll('.dom-cbar-fill')].map((f) => f.getAttribute('data-weakest'));
    expect(fills).toEqual(['true', null]);
    const css = readFileSync('src/ui/components/domain/domain.css', 'utf8');
    expect(css).toMatch(/\.dom-cbar-fill\[data-weakest='true'\][^}]*repeating-linear-gradient/);
  });
  it('expands to the explainer and detail', () => {
    const c = m(<ComponentBar label="Rhythm" value={82} explainer="On time." detail="6 late" focus />);
    const row = c.querySelector('button') as HTMLElement;
    const panel = c.querySelector('.dom-cbar-panel') as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    click(row);
    expect(panel.hidden).toBe(false);
    expect(row.getAttribute('aria-controls')).toBe(panel.id);
    expect(c.querySelector('.dom-cbar-focus')?.textContent).toBe(copy('component.focus', { component: 'Rhythm' }));
  });
  it('shows no bar and no number when the value is null', () => {
    const c = m(<ComponentBar label="In tune" value={null} explainer="x" />);
    expect(c.querySelector('.dom-cbar-bar')).toBeNull();
    expect(c.querySelector('.dom-cbar-value')).toBeNull();
    expect(c.querySelector('.dom-cbar-unavailable')?.textContent).toBe(copy('component.inTune.notEnough'));
  });
  it('supports controlled expansion', () => {
    const onChange = vi.fn();
    const c = m(<ComponentBar label="Notes" value={50} explainer="x" expanded={false} onExpandedChange={onChange} />);
    click(c.querySelector('button') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(true);
    expect((c.querySelector('.dom-cbar-panel') as HTMLElement).hidden).toBe(true);
  });
});

describe('HeatStrip', () => {
  it('maps shares to the four levels at the spec cut points', () => {
    expect([0, 0.01, 0.25, 0.26, 0.5, 0.51, 1].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
  it('renders a labelled cell per bar and focuses only bars with errors', () => {
    const c = m(<HeatStrip bars={[{ share: 0 }, { share: 0.4, label: 'Bar 2: 2 of 5 notes off' }]} />);
    const cells = c.querySelectorAll('.dom-heat-cell');
    expect(cells).toHaveLength(2);
    expect(cells[1]?.getAttribute('title')).toBe('Bar 2: 2 of 5 notes off');
    expect(cells[1]?.getAttribute('tabindex')).toBe('0');
    expect(cells[0]?.getAttribute('tabindex')).toBeNull();
  });
});

describe('VerdictGlyph and RankEmblem', () => {
  it('references every sprite id and draws the count for plus-n', () => {
    for (const id of GLYPH_IDS) {
      const c = m(<VerdictGlyph id={id} size={9} />);
      expect(c.querySelector('use')?.getAttribute('href')).toBe(`#${id}`);
      current?.unmount();
      current = null;
    }
    const c = m(<VerdictGlyph id="plus-n" count={3} size={14} label="3 more" />);
    expect(c.querySelector('text')?.textContent).toBe('3');
    expect(c.querySelector('svg')?.getAttribute('width')).toBe('14');
    expect(c.querySelector('[role=img]')).not.toBeNull();
  });
  it('clamps ranks into the ten emblems and carries the state', () => {
    expect(rankGlyphId(0)).toBe('rank-1');
    expect(rankGlyphId(10)).toBe('rank-10');
    expect(rankGlyphId(11)).toBe('rank-10');
    const c = m(<RankEmblem rank={3} state="current" size={96} />);
    expect(c.querySelector('use')?.getAttribute('href')).toBe('#rank-3');
    expect(c.querySelector('.dom-rank')?.getAttribute('data-state')).toBe('current');
  });
  it.each(['achieved', 'current', 'future'] as const)('carries the %s state', (state) => {
    const c = m(<RankEmblem rank={5} state={state} size={24} />);
    expect(c.querySelector('.dom-rank')?.getAttribute('data-state')).toBe(state);
  });
});

describe('TipCard and EmptyState', () => {
  const tip = {
    instrumentAbbr: 'Tpt',
    instrumentName: 'Trumpet',
    dimension: 'Notes',
    headline: 'Missed key-signature notes',
    body: 'Name the key.',
    evidence: 'Seen in bars 1, 3, 4.',
  };
  it('shows header, count, and an expandable secondary tip', () => {
    const c = m(<TipCard tip={tip} index={1} total={2} secondary={{ headline: 'Fell behind', body: 'Listen.', evidence: 'Seen in bars 2.' }} />);
    expect(c.textContent).toContain(copy('tips.count', { n: 1, total: 2 }));
    expect(c.querySelector('h2')?.textContent).toBe(copy('results.tip.title'));
    expect(c.querySelector('h3')?.textContent).toBe(tip.headline);
    expect(c.querySelector('.dom-tip-tile')?.getAttribute('aria-hidden')).toBe('true');
    const btn = c.querySelector('.dom-tip-also') as HTMLElement;
    expect(btn.textContent).toBe(copy('results.tip.more', { n: 1 }));
    expect((document.getElementById(btn.getAttribute('aria-controls') ?? '') as HTMLElement).hidden).toBe(true);
    click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toBe(copy('results.tip.less', { n: 1 }));
    expect((document.getElementById(btn.getAttribute('aria-controls') ?? '') as HTMLElement).hidden).toBe(false);
  });
  it('shows hear-bar actions for the primary and the expanded tip', () => {
    const c = m(
      <TipCard
        tip={tip}
        secondary={{ headline: 'h', body: 'b', evidence: 'e', dimension: 'Rhythm' }}
        actions={<button type="button">{'Hear bar 2'}</button>}
        secondaryActions={<button type="button">{'Hear bars 3 to 4'}</button>}
      />,
    );
    expect(c.querySelectorAll('.dom-tip-actions button')).toHaveLength(2);
    expect(c.querySelector('.dom-tip-dim')?.textContent).toBe('Rhythm');
  });
  it('has no disclosure without a secondary tip', () => {
    const c = m(<TipCard tip={tip} />);
    expect(c.querySelector('.dom-tip-also')).toBeNull();
  });
  it('renders the empty state with its action', () => {
    const c = m(<EmptyState icon="info" title={copy('empty.history.title')} body={copy('empty.history.body')} action={<button type="button">{'Go'}</button>} />);
    expect(c.querySelector('h3')?.textContent).toBe('No takes yet');
    expect(c.querySelector('.dom-empty-action button')).not.toBeNull();
    act(() => undefined);
  });
});
