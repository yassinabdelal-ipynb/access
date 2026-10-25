// The Apify agent inside the page (the agent itself is mocked): a consent step, hidden menu items recovered into the
// navigation, the site's other pages as a related section, the same data in the big tiles and the screen reader view,
// the site context handed to Claude, a clear message when it fails, and recovered links that really open.
const assert = require('node:assert/strict');
let pw; pw = require('playwright');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/app/demo-menu.html');
    for (const file of ['engine.js', 'reader.js', 'motor.js', 'ui.js']) await page.addScriptTag({ url: `/extension/${file}` });
    await page.evaluate(() => { window.siteCalls = []; window.aiCalls = []; window.failNext = true; });
    await page.exposeFunction('readSite', async (payload) => {
      await page.evaluate((p) => window.siteCalls.push(p), payload);
      if (await page.evaluate(() => { const f = window.failNext; window.failNext = false; return f; })) throw new Error('Apify rejected the token. Check APIFY_TOKEN in .env.');
      const o = 'http://127.0.0.1:4173';
      return {
        origin: o, title: 'Greenfield Community Centre', description: 'Classes, clubs and a community garden.', lang: 'en', type: '', headings: [],
        menu: [{ label: 'Home', href: `${o}/app/demo.html` }, { label: 'Classes', href: `${o}/app/demo-menu.html#classes` }, { label: 'Gardening club', href: `${o}/app/demo-tiles.html` }, { label: 'Art class', href: `${o}/app/demo-rich.html` }],
        pages: [{ url: `${o}/app/demo-rich.html`, title: 'Harbour report', description: 'Sea level data.' }, { url: `${o}/app/demo.html`, title: 'Home page', description: 'Already in the menu.' }],
      };
    });
    await page.exposeFunction('askClaude', async (payload) => {
      await page.evaluate((p) => window.aiCalls.push(p), payload);
      if (!payload.tilesOnly) return { main: [], hide: [], collapse: [], chunks: [], gists: [], layout: [] };
      return { tiles: payload.tiles.map((t) => ({ n: t.n, title: `T${t.n}`, subtitle: `S${t.n}` })) };
    });
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 's'; host.dataset.accessRoot = 'true';
      host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:1000'; document.documentElement.append(host);
      document.body.dataset.accessInert = ''; document.body.inert = true;
      window.prefsSeen = [];
      window.ui = AccessUI.mount(host.attachShadow({ mode: 'open' }), AccessEngine.create(document), {
        mode: 'overlay', cssUrl: '/extension/access.css', preferences: { purpose: 'focus' }, onPreferences: (p) => prefsSeen.push(p),
        onSiteStatus: async () => true, onSite: (p) => window.readSite(p), onRedesign: (p) => window.askClaude(p),
        onMotorControl: async () => ({ owned: true, enabled: true, pending: false, message: 'ON', hold_seconds: 0, wink_armed: true, clicks_enabled: true }),
      });
    });
    const view = page.locator('#s');
    await view.getByRole('heading', { name: 'Classes', exact: true }).waitFor();
    const top = view.locator('.pd-top');
    assert.equal(await top.getByText('Gardening club').count(), 0, 'the page hides its drop-down items');

    // ---- One AI button does both: it asks once, a site failure is explained and Claude still plans the page ----
    await view.getByRole('button', { name: 'Access settings', exact: true }).click();
    assert.equal(await view.getByRole('button', { name: 'Read this whole site with Apify' }).count(), 0, 'there is no separate site map button any more');
    const aiBtn = view.getByRole('button', { name: 'AI redesign with Claude', exact: true });
    await page.waitForTimeout(300);
    await aiBtn.click();
    const dialog = view.getByRole('alertdialog'); await dialog.getByText('Let Apify and Claude redesign this website?').waitFor();
    assert.match(await dialog.innerText(), /without anything after a \? or #/);
    assert.match(await dialog.innerText(), /Claude \(Anthropic\)/);
    await dialog.getByRole('button', { name: 'Not now', exact: true }).click();
    assert.equal(await page.evaluate(() => siteCalls.length + aiCalls.length), 0, 'declining sends nothing to Apify or Claude');
    await aiBtn.click(); await dialog.getByRole('button', { name: 'Send and redesign', exact: true }).click();
    await view.locator('.status', { hasText: 'Apify rejected the token' }).waitFor();
    await page.waitForFunction(() => window.aiCalls.length === 1);
    assert.equal(await page.evaluate(() => aiCalls[0].site), undefined, 'a failed site read leaves Claude with the page only');
    assert.equal(await top.getByText('Gardening club').count(), 0, 'a failure adds nothing to the page');
    assert.equal(await page.evaluate(() => prefsSeen.at(-1).siteConsent && prefsSeen.at(-1).aiConsent), true, 'consent is remembered for both');

    // ---- It works: no second question, Apify reads first, hidden menu items join the navigation, Claude gets the context ----
    await aiBtn.click();
    await view.locator('.status', { hasText: 'standard redesign' }).waitFor();
    await aiBtn.click();
    assert.equal(await view.getByRole('alertdialog').count(), 0, 'consent is not asked again');
    await page.waitForFunction(() => window.aiCalls.length === 2);
    const plan = await page.evaluate(() => aiCalls[1]);
    assert.equal(plan.site.description, 'Classes, clubs and a community garden.');
    assert.ok(plan.site.menu.includes('Gardening club') && plan.site.pages.includes('Harbour report'), 'Claude plans with the site map');
    assert.equal(JSON.stringify(plan.site).includes('http'), false, 'only labels, never addresses, go to Claude');
    assert.ok(plan.items.some((i) => String(i.id).startsWith('site-menu-')), 'the recovered menu items are part of the plan');
    await view.locator('.status', { hasText: 'Claude organized this page' }).waitFor();
    assert.match(await view.locator('.status').innerText(), /2 menu links/);
    await aiBtn.click();
    await view.locator('.status', { hasText: 'standard redesign' }).waitFor();
    const sent = await page.evaluate(() => siteCalls.at(-1));
    assert.deepEqual(sent, { url: 'http://127.0.0.1:4173/app/demo-menu.html', consent: true }, 'only the address and the consent flag are sent');
    assert.equal(await top.getByText('Gardening club').count(), 1, 'a hidden menu item is in the navigation');
    assert.equal(await top.getByText('Art class').count(), 1);
    assert.equal(await top.getByText('Home').count(), 1, 'items the page already shows are not repeated');
    assert.equal(await view.getByRole('heading', { name: 'Elsewhere on this site', exact: true }).count(), 1);
    assert.equal(await view.getByText('Harbour report').count(), 1); assert.equal(await view.getByText('Sea level data.').count(), 1);
    assert.equal(await view.getByText('Already in the menu.').count(), 0, 'a page that is already in the menu is not listed twice');
    await page.screenshot({ path: 'test-results/site-agent-page.png' });

    // ---- The same data in the big tiles (with the site context handed to Claude) and the screen reader view ----
    await view.getByRole('button', { name: 'Motor impairment', exact: true }).click();
    await view.getByRole('button', { name: 'Big tiles', exact: true }).click();
    await view.locator('.tile').first().waitFor();
    await page.waitForFunction(() => window.aiCalls.some((c) => c.tilesOnly));
    const ask = await page.evaluate(() => window.aiCalls.find((c) => c.tilesOnly));
    assert.equal(ask.tilesOnly, true);
    assert.equal(ask.site.description, 'Classes, clubs and a community garden.');
    assert.ok(ask.site.menu.includes('Gardening club') && ask.site.pages.includes('Harbour report'), 'Claude is told about the site');
    assert.equal(JSON.stringify(ask.site).includes('http'), false, 'only labels, never addresses, go to Claude');
    const chips = await view.locator('.tile').evaluateAll((els) => els.map((e) => e.innerText));
    assert.ok(chips.some((t) => /5 links/.test(t)), `the menu tile holds the recovered links: ${chips.join(' | ')}`);
    await view.getByRole('button', { name: 'Whole page', exact: true }).click();
    await page.evaluate(() => window.ui.setPreferences({ purpose: 'reader' }));
    await view.locator('.reader').waitFor();
    assert.ok(await view.locator('.reader nav').getByRole('link', { name: 'Gardening club' }).count() >= 1, 'a screen reader finds it in the navigation landmark');
    assert.equal(await view.locator('.reader aside, .reader [aria-label="Elsewhere on this site"]').count() >= 1, true, 'and the related pages in their own region');
    await page.evaluate(() => window.ui.setPreferences({ purpose: 'focus' }));
    await view.locator('.pd-top').waitFor();

    // ---- A recovered link really opens ----
    await view.locator('.pd-top').getByRole('button', { name: 'Art class', exact: true }).click();
    await page.waitForURL('**/app/demo-rich.html');
    assert.deepEqual(errors, []);
    console.log('Site agent passed: consent first, failures explained, hidden menu items recovered, related pages listed, tiles and screen reader view include them, Claude gets context without addresses, links open.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
