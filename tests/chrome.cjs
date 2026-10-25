// Extension chrome: no Site look button, Light/Dark change the page itself, motor toolbar keeps Head control and
// Mouse / trackpad in view with the rest under Advanced, and a schematic face mask follows landmark numbers.
const assert = require('node:assert/strict');
let pw; pw = require('playwright');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/app/demo-rich.html');
    for (const file of ['engine.js', 'reader.js', 'motor.js', 'ui.js']) await page.addScriptTag({ url: `/extension/${file}` });
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'chrome'; host.dataset.accessRoot = 'true';
      host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:1000'; document.documentElement.append(host);
      document.body.dataset.accessInert = ''; document.body.inert = true;
      // A made-up face: 138 landmark points on rings, shifted sideways by window.shift.
      const sizes = [36, 16, 16, 10, 10, 10, 20, 20]; const radii = [.16, .035, .035, .05, .05, .06, .06, .04]; const centers = [[.5, .5], [.44, .46], [.56, .46], [.44, .4], [.56, .4], [.5, .52], [.5, .62], [.5, .62]];
      window.shift = 0; window.hold = 0; window.faceOn = true;
      const facePoints = () => sizes.flatMap((n, g) => Array.from({ length: n }, (_, i) => [centers[g][0] + window.shift + radii[g] * Math.cos(2 * Math.PI * i / n), centers[g][1] + radii[g] * 1.2 * Math.sin(2 * Math.PI * i / n)])).flat().map((v) => Math.round(v * 1000) / 1000);
      window.ui = AccessUI.mount(host.attachShadow({ mode: 'open' }), AccessEngine.create(document), {
        mode: 'overlay', cssUrl: '/extension/access.css', preferences: { purpose: 'focus' },
        onMotorControl: async (p) => ({ owned: true, enabled: true, pending: false, message: 'ON', hold_seconds: window.hold, wink_armed: true, clicks_enabled: true, face: p.face && window.faceOn ? { pts: facePoints(), b: [0, 0, 0, 0, 0, 0] } : null }),
      });
    });
    const view = page.locator('#chrome');
    await view.getByRole('heading', { name: 'The numbers' }).waitFor();

    // ---- No Site look button; the page always keeps the site's look ----
    await view.getByRole('button', { name: 'Access settings', exact: true }).click();
    assert.equal(await view.getByRole('button', { name: /site look/i }).count(), 0, 'no Site look button');

    // ---- Light and Dark change the page itself ----
    const pageBg = () => view.locator('.site').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const light = await pageBg();
    await view.getByRole('button', { name: 'Dark theme', exact: true }).click();
    const dark = await pageBg();
    assert.notEqual(dark, light, 'dark changes the page background');
    assert.match(dark, /rgb\(20, 23, 28\)/);
    const ink = await view.locator('.pd-sec p').first().evaluate((el) => getComputedStyle(el).color);
    assert.match(ink, /rgb\((2[0-9]{2}|1[5-9][0-9]),/, `text is light on the dark page: ${ink}`);
    await view.getByRole('button', { name: 'Light theme', exact: true }).click();
    assert.equal(await pageBg(), light, 'light keeps an already-light site as it is');
    await view.getByRole('button', { name: 'Site default colours', exact: true }).click();
    assert.equal(await pageBg(), light, 'auto returns to the site\'s own colours');
    await page.screenshot({ path: 'test-results/chrome-dock.png' });
    await view.getByRole('button', { name: 'Dark theme', exact: true }).click();
    await page.screenshot({ path: 'test-results/chrome-dark.png' });
    await view.getByRole('button', { name: 'Site default colours', exact: true }).click();

    // ---- Motor toolbar: Advanced holds Recenter, Dwell and Rest ----
    await view.getByRole('button', { name: 'Motor impairment', exact: true }).click();
    const bar = view.locator('.motor-toolbar'); await bar.waitFor();
    for (const name of ['Head control', 'Mouse / trackpad', 'Advanced']) await bar.getByRole('button', { name, exact: true }).waitFor();
    assert.equal(await bar.getByRole('button', { name: 'Rest', exact: true }).isVisible(), false, 'Rest is hidden until Advanced is opened');
    assert.equal(await bar.getByRole('button', { name: 'Recenter head', exact: true }).isVisible(), false);
    await page.screenshot({ path: 'test-results/chrome-bar.png' });
    const barHeight = (await bar.boundingBox()).height; assert.ok(barHeight <= 96, `toolbar is slim: ${barHeight}`);
    await bar.getByRole('button', { name: 'Advanced', exact: true }).click();
    for (const name of ['Recenter head', 'Rest']) assert.equal(await bar.getByRole('button', { name, exact: true }).isVisible(), true);
    assert.equal(await bar.getByRole('button', { name: /^Dwell/ }).isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await bar.getByRole('button', { name: 'Rest', exact: true }).isVisible(), false, 'Escape closes Advanced');
    assert.equal(await bar.getByRole('button', { name: 'Head control', exact: true }).getAttribute('aria-pressed') !== null, true, 'Escape on Advanced does not stop head control first');

    // ---- One toolbar button switches between the whole page and the big tiles; no status line, no in-page copies ----
    const state = await bar.locator('.motor-state').boundingBox();
    assert.ok(!state || state.width <= 2, 'the status text is not drawn in the toolbar');
    assert.equal(await bar.locator('.motor-state').getAttribute('role'), 'status', 'but it stays for screen readers');
    const toggle = bar.locator('.motor-view');
    assert.equal(await toggle.innerText(), 'Big tiles');
    assert.equal(await view.getByRole('button', { name: 'Big tiles', exact: true }).count(), 1, 'only the toolbar has it');
    await toggle.click();
    await view.locator('.tile').first().waitFor();
    assert.equal(await toggle.innerText(), 'Whole page', 'the same button now says Whole page');
    assert.equal(await view.getByRole('button', { name: 'Whole page', exact: true }).count(), 1, 'and there is no second copy on the page');
    await toggle.click();
    await view.locator('.pd-top').waitFor();
    assert.equal(await view.locator('.tile').count(), 0);
    assert.equal(await toggle.innerText(), 'Big tiles');
    await page.screenshot({ path: 'test-results/chrome-toolbar.png', clip: { x: 0, y: 0, width: 1366, height: 260 } });
    // ---- The face mask follows the landmarks and the right-eye wink ----
    await bar.getByRole('button', { name: 'Head control', exact: true }).click();
    const mask = view.locator('.motor-face'); await mask.waitFor();
    await page.waitForFunction(() => document.querySelector('#chrome').shadowRoot.querySelector('.motor-face').dataset.state === 'live');
    const outline = () => mask.locator('.m-oval').getAttribute('d');
    const first = await outline();
    assert.ok(first && first.startsWith('M') && first.endsWith('Z'), 'the face outline is drawn');
    assert.equal((await mask.locator('.m-dots').getAttribute('d')).split('M').length - 1, 138, 'all 138 landmarks are drawn as dots');
    await page.evaluate(() => { window.shift = 0.08; });
    await page.waitForFunction((was) => document.querySelector('#chrome').shadowRoot.querySelector('.m-oval').getAttribute('d') !== was, first);
    await page.waitForTimeout(700); // the mask glides to the new position
    const moved = await outline();
    const x = (d) => Number(d.slice(1).split('L')[0].split(' ')[0]);
    assert.ok(Math.abs(x(first) - x(moved)) > 0.05, `the mask moves with the head (${x(first)} -> ${x(moved)})`);
    assert.equal(await mask.getAttribute('data-wink'), 'false');
    await page.evaluate(() => { window.hold = 1.2; });
    await page.waitForFunction(() => document.querySelector('#chrome').shadowRoot.querySelector('.motor-face').dataset.wink === 'true');
    await page.screenshot({ path: 'test-results/chrome-motor.png' });
    await page.evaluate(() => { window.faceOn = false; window.hold = 0; });
    await page.waitForFunction(() => document.querySelector('#chrome').shadowRoot.querySelector('.motor-face').dataset.state === 'lost');
    assert.equal(await view.locator('.motor-face img, .motor-face canvas, .motor-face video').count(), 0, 'no camera picture anywhere in the mask');
    await bar.getByRole('button', { name: 'Mouse / trackpad', exact: true }).click();
    assert.equal(await mask.isVisible(), false, 'the mask is hidden when head control is off');

    await page.evaluate(() => window.ui.destroy());
    assert.deepEqual(errors, []);
    console.log('Chrome passed: no Site look button, Light/Dark change the page, slim motor toolbar with Advanced, live face mask.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
