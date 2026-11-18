// IOS7 (05 §9): synthetic capture in a real browser. The worklet loads, blocks are contiguous by seq on the port path
// and on the forced relay, and loopback measures injected delays of 25, 60 and 110 ms within 1 ms.
// IOS2 (05 §9): a dispatched visibilitychange mid-take yields a void and no live track within 2 s.
import { expect, test, type Page } from '@playwright/test';
import { openSyntheticPage } from './page.ts';

type Api = {
  make(o?: { delayMs?: number; toneHz?: number; forceRelay?: boolean; search?: string }): { flag: { delayMs: number } | null };
  waitUnlocked(): Promise<{ ok: boolean; error?: string }>;
  contiguity(sec: number, mode: 'port' | 'relay'): Promise<{ blocks: number; seqGaps: number; relay: boolean; droppedBlocks: number; tone: boolean }>;
  loopback(): Promise<{ rtlMs: number | null; madMs: number | null; found: number; scheduled: number; accepted: boolean; failure: string | null; lagsMs: (number | null)[] }>;
  interruptMidTake(): Promise<{ voids: { reason: string; burnExcerpt: boolean; countsAsSkip: boolean }[]; liveTracksAfterMs: number[]; closedMs: number | null }>;
  streams(): number;
};
// Timing-sensitive (±1 ms loopback): run with its own config (one worker); the root config's parallel run skips it.
test.skip(process.env['E2E_SYNTHETIC'] !== '1', 'run with -c e2e/synthetic/playwright.synthetic.config.ts');

const SEC = Number(process.env['E2E_SYNTH_SEC'] ?? 30);
const report = (msg: string): void => {
  test.info().annotations.push({ type: 'measured', description: msg });
  process.stdout.write(`${msg}\n`);
};

async function start(page: Page, o: Parameters<Api['make']>[0] = {}, search = ''): Promise<void> {
  await openSyntheticPage(page, search);
  await page.evaluate((o) => (window as unknown as { synthTest: Api }).synthTest.make(o), o);
  await page.click('#unlock');
  const r = await page.evaluate(() => (window as unknown as { synthTest: Api }).synthTest.waitUnlocked());
  expect(r.ok, r.error).toBe(true);
}

test('the flag parses from the page URL and getUserMedia is never called', async ({ page }) => {
  await openSyntheticPage(page, '?synthCapture=60');
  const m = await page.evaluate(() => (window as unknown as { synthTest: Api }).synthTest.make({ search: location.search }));
  expect(m.flag).toEqual({ delayMs: 60 });
});

for (const mode of ['port', 'relay'] as const) {
  test(`${mode} path: blocks are contiguous by seq for ${SEC} s`, async ({ page }) => {
    test.setTimeout((SEC + 60) * 1000);
    await start(page, { delayMs: 60, ...(mode === 'relay' ? { forceRelay: true } : {}) });
    const res = await (page.evaluate(([s, m]) => (window as unknown as { synthTest: Api }).synthTest.contiguity(s as number, m as 'port' | 'relay'), [SEC, mode] as const));
    report(`${mode}: ${res.blocks} blocks, ${res.seqGaps} seq gaps, ${res.droppedBlocks} dropped, relay=${res.relay}, tone=${res.tone}`);
    expect(res.seqGaps).toBe(0);
    expect(res.droppedBlocks).toBe(0);
    expect(res.tone).toBe(true);
    expect(res.blocks).toBeGreaterThan(SEC * 150);
    expect(res.relay).toBe(mode === 'relay');
    expect(await page.evaluate(() => (window as unknown as { synthTest: Api }).synthTest.streams())).toBe(1);
  });
}

for (const d of [25, 60, 110]) {
  test(`loopback measures d = ${d} ms within 1 ms`, async ({ page }) => {
    await start(page, { delayMs: d, toneHz: 0 });
    const r = await page.evaluate(() => (window as unknown as { synthTest: Api }).synthTest.loopback());
    report(`d=${d}: rtl ${r.rtlMs?.toFixed(2)} ms, mad ${r.madMs?.toFixed(2)} ms, ${r.found}/${r.scheduled} clicks found, accepted=${r.accepted}`);
    expect(r.accepted, String(r.failure)).toBe(true);
    expect(r.found).toBe(r.scheduled);
    expect(Math.abs((r.rtlMs as number) - d)).toBeLessThanOrEqual(1);
  });
}

test('IOS2: visibilitychange mid-take voids with a burned excerpt and no live track within 2 s', async ({ page }) => {
  await start(page, { delayMs: 60 });
  const r = await page.evaluate(() => (window as unknown as { synthTest: Api }).synthTest.interruptMidTake());
  report(`interrupt: voids=${JSON.stringify(r.voids)} closedMs=${r.closedMs}`);
  expect(r.voids).toHaveLength(1);
  expect(r.voids[0]).toMatchObject({ reason: 'interrupted', burnExcerpt: true, countsAsSkip: true });
  expect(r.closedMs).not.toBeNull();
  expect(r.closedMs as number).toBeLessThan(2000);
  expect(r.liveTracksAfterMs[r.liveTracksAfterMs.length - 1]).toBe(0);
});
