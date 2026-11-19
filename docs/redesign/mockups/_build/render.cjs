// Renders every mockup to ../png at deviceScaleFactor 1. Usage: node render.cjs [name-filter]
// Page options, as <meta> tags in the mockup:
//   sizes="phone"          render only those sizes (default "desktop phone")
//   hc="1"                 also render the high-contrast theme, light and dark (-hc-light, -hc-dark)
//   scroll-shot="phone:700" also render a viewport shot after scrolling by that much (-scrolled-)
// <body class="viewport-only"> renders the viewport instead of the full page.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const dir = path.join(__dirname, '..');
const out = path.join(dir, 'png');
fs.mkdirSync(out, { recursive: true });
const filter = process.argv[2] || '';
const sizes = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'phone', width: 390, height: 844 },
];
(async () => {
  const browser = await chromium.launch();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && f.includes(filter));
  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const f of files) {
      const base = f.replace('.html', '');
      await page.goto('file://' + path.join(dir, f));
      const meta = await page.evaluate(() => ({
        sizes: document.querySelector('meta[name=sizes]')?.content || 'desktop phone',
        hc: !!document.querySelector('meta[name=hc]'),
        scroll: document.querySelector('meta[name=scroll-shot]')?.content || '',
      }));
      if (!meta.sizes.includes(size.tag)) continue;
      const themes = ['light', 'dark', ...(meta.hc ? ['hc-light', 'hc-dark'] : [])];
      for (const theme of themes) {
        const q = theme === 'hc-light' ? 'hc' : theme === 'hc-dark' ? 'dark&hc' : theme;
        await page.goto('file://' + path.join(dir, f) + '?' + q);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(120);
        const full = await page.evaluate(() => !document.body.classList.contains('viewport-only'));
        await page.screenshot({ path: path.join(out, `${base}-${size.tag}-${theme}.png`), fullPage: full });
        const [tag, y] = meta.scroll.split(':');
        if (tag === size.tag && !theme.startsWith('hc')) {
          await page.evaluate((yy) => window.scrollTo(0, +yy), y);
          await page.waitForTimeout(60);
          await page.screenshot({ path: path.join(out, `${base}-${size.tag}-scrolled-${theme}.png`) });
        }
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('rendered', files.length, 'files');
})();
