// Renders every mockup to ../png at deviceScaleFactor 2. Usage: node render.cjs [name-filter]
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
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const f of files) {
      const base = f.replace('.html', '');
      // A page can opt out of a size with <meta name="sizes" content="phone">.
      for (const theme of ['light', 'dark']) {
        await page.goto('file://' + path.join(dir, f) + '?' + theme);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        const sizesMeta = await page.evaluate(() => document.querySelector('meta[name=sizes]')?.content || 'desktop phone');
        if (!sizesMeta.includes(size.tag)) continue;
        const full = await page.evaluate(() => !document.body.classList.contains('viewport-only'));
        await page.screenshot({ path: path.join(out, `${base}-${size.tag}-${theme}.png`), fullPage: full });
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('rendered', files.length, 'files');
})();
