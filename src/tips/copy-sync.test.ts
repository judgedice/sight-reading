// The tip words mirrored in text.ts must equal their copy keys (tips/ may not import ui/; test files may).
import { describe, expect, it } from 'vitest';
import { copyTemplate } from '../ui/copy/copy.ts';
import { BARS_JOIN_TEMPLATE, DIRECTION_WORD, formatBars } from './text.ts';

describe('tip words match the copy catalogue', () => {
  it('direction words and the bar-list join', () => {
    expect(DIRECTION_WORD.sharp).toBe(copyTemplate('tips.direction.sharp'));
    expect(DIRECTION_WORD.flat).toBe(copyTemplate('tips.direction.flat'));
    expect(BARS_JOIN_TEMPLATE).toBe(copyTemplate('tips.bars.join'));
    expect(formatBars([7, 3, 5])).toBe('3, 5 and 7');
  });
});
