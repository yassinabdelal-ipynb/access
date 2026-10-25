// The project site at "/": every section is there, every nav link has a target, every picture loads,
// nothing overflows on a phone, and the live demo still works.
const assert = require('node:assert/strict');
let pw; pw = require('playwright');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('requestfailed', (r) => errors.push(`failed ${r.url()}`));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.hero h1').count(), 1);
    for (const id of ['keeps', 'tracks', 'motor', 'how', 'ai', 'try', 'install', 'checked']) assert.equal(await page.locator(`section#${id}`).count(), 1, `section ${id}`);
    const links = await page.locator('header nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    for (const href of links) assert.equal(await page.locator(href).count(), 1, `nav target ${href}`);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } scrollTo(0, 0); });
    await page.waitForTimeout(400);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
    assert.deepEqual(broken, [], 'every picture loads');
    assert.ok(await page.locator('img').evaluateAll((els) => els.every((e) => e.alt.length > 10)), 'every picture has a real description');
    // The same palette as the extension: flat panels with a thin border, no shadows or gradients.
    const card = await page.locator('.card').first().evaluate((el) => { const s = getComputedStyle(el); return { shadow: s.boxShadow, bg: s.backgroundColor, border: s.borderTopWidth }; });
    assert.equal(card.shadow, 'none'); assert.equal(card.border, '1px');
    // Theme
    await page.locator('#themes').getByRole('button', { name: 'Dark theme', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(21, 23, 28)');
    await page.locator('#themes').getByRole('button', { name: 'Light theme', exact: true }).click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(246, 247, 249)');
    // The live demo still runs inside the page
    await page.locator('#preview').getByRole('heading', { name: 'Community workshops', exact: true }).waitFor();
    // Phone width
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling on a phone');
    await page.setViewportSize({ width: 820, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling on a tablet');
    assert.deepEqual(errors, []);
    console.log('Site passed: all sections, working nav, every picture loads and is described, flat palette, light and dark, live demo, phone and tablet widths.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
