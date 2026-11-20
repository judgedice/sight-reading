// Renders the note-colour mockups to docs/redesign/note-colours/mockups/png at deviceScaleFactor 2.
// Usage: node render2.cjs [name-filter]. Same page options as render.cjs, plus
//   <meta name="themes" content="light"> to render only some themes (default "light dark").
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const dir = path.join(__dirname, '..', '..', 'note-colours', 'mockups');
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
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const f of files) {
      const base = f.replace('.html', '');
      await page.goto('file://' + path.join(dir, f));
      const meta = await page.evaluate(() => ({
        sizes: document.querySelector('meta[name=sizes]')?.content || 'desktop phone',
        themes: document.querySelector('meta[name=themes]')?.content || 'light dark',
        scroll: document.querySelector('meta[name=scroll-shot]')?.content || '',
      }));
      if (!meta.sizes.includes(size.tag)) continue;
      for (const theme of meta.themes.split(' ')) {
        await page.goto('file://' + path.join(dir, f) + '?' + theme);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(120);
        const info = await page.evaluate(() => ({ full: !document.body.classList.contains('viewport-only'), sh: document.documentElement.scrollHeight }));
        await page.screenshot({ path: path.join(out, `${base}-${size.tag}-${theme}.png`), fullPage: info.full });
        if (!info.full && info.sh > size.height + 1) console.log('OVERFLOW', base, size.tag, theme, info.sh);
        if (info.full && info.sh > size.height + 1) console.log('scrolls', base, size.tag, theme, info.sh);
        const [tag, y] = meta.scroll.split(':');
        if (tag === size.tag) {
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
