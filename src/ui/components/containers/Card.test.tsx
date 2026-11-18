// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../primitives/test-render.ts';
import { Card } from './Card.tsx';
import { q } from '../form/test-helpers.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe('Card', () => {
  it('wraps its children in a surface container', () => {
    current = mount(
      <Card>
        <p>{'Body'}</p>
      </Card>,
    );
    const card = q('.ui-card');
    expect(card.textContent).toBe('Body');
  });
});
