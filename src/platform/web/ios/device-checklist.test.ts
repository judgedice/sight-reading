import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const checklist = read('../../../../docs/ios/device-checklist.md');
const spec = read('../../../../docs/spec/05-ios-fork.md');

/** The bullets of spec section 8.2 (what only a device can show). */
function specSection82Bullets(): string[] {
  const start = spec.indexOf('### 8.2 ');
  const end = spec.indexOf('## 9. v1 work packages');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return spec
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('- '));
}

/** Rows of Part 1, keyed by their 8.2-NN id. Each row is [id, item, procedure, pass, reference]. */
function part1Rows(): string[][] {
  return checklist
    .split('\n')
    .filter((line) => /^\| 8\.2-\d{2} \|/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

describe('IOS8 device checklist', () => {
  it('lists one row per bullet in spec section 8.2 (the count matches)', () => {
    expect(specSection82Bullets().length).toBe(15);
    expect(part1Rows().length).toBe(specSection82Bullets().length);
  });

  it('numbers the rows 8.2-01 to 8.2-15 without gaps', () => {
    const ids = part1Rows().map((r) => r[0]);
    expect(ids).toEqual(Array.from({ length: 15 }, (_, i) => `8.2-${String(i + 1).padStart(2, '0')}`));
  });

  it('every 8.2 row has an item, a procedure, a pass threshold and a spec reference', () => {
    for (const row of part1Rows()) {
      expect(row).toHaveLength(5);
      for (const cell of row.slice(1)) expect(cell.length, row[0]).toBeGreaterThan(0);
    }
  });

  it('rows follow the order of the spec 8.2 bullets (leading word of each item matches its bullet)', () => {
    const lead = (s: string): string => s.replace(/^- /, '').split(' ')[0]!.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const bullets = specSection82Bullets();
    const items = part1Rows().map((r) => r[1]);
    expect(items.length).toBe(bullets.length);
    bullets.forEach((bullet, i) => {
      expect(lead(items[i]!), `row 8.2-${String(i + 1).padStart(2, '0')}`).toBe(lead(bullet));
    });
  });

  it('has the B3 measurements M1 to M5, each with a threshold', () => {
    const measurements = checklist
      .split('\n')
      .filter((line) => /^\| M\d \|/.test(line))
      .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    expect(measurements.map((r) => r[0])).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    for (const row of measurements) expect((row[3] ?? '').length, row[0]).toBeGreaterThan(0);
  });

  it('names the three device classes and both modes from B3', () => {
    expect(checklist).toMatch(/A13-class iPhone/);
    expect(checklist).toMatch(/Current iPhone/);
    expect(checklist).toMatch(/\biPad\b/);
    expect(checklist).toMatch(/Safari tab/);
    expect(checklist).toMatch(/home-screen app/);
  });

  it('states that nothing has been run on a device yet', () => {
    expect(checklist).toMatch(/Nothing in this checklist has been run yet/);
  });
});
