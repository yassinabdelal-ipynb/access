const assert = require('node:assert/strict');
let pw; pw = require('playwright');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/app/demo.html');
    for (const file of ['engine.js', 'motor.js', 'ui.js']) await page.addScriptTag({ url: `/extension/${file}` });
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'motor-test'; host.dataset.accessRoot = 'true';
      host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:1000'; document.documentElement.append(host);
      document.body.dataset.accessInert = ''; document.body.inert = true;
      window.motorCommands = []; window.mockEnabled = false;
      window.testUI = AccessUI.mount(host.attachShadow({ mode: 'open' }), AccessEngine.create(document), {
        mode: 'overlay', cssUrl: '/extension/access.css',
        onMotorControl: async (p) => {
          motorCommands.push(p);
          if (p.command === 'head') mockEnabled = true;
          if (p.command === 'manual') mockEnabled = false;
          return { owned: mockEnabled, enabled: mockEnabled, pending: false, message: mockEnabled ? 'Head ON' : 'Manual' };
        },
      });
    });
    const view = page.locator('#motor-test');
    await view.getByLabel('Full name (required)', { exact: true }).waitFor();
    await view.getByRole('button', { name: 'Access settings', exact: true }).click();
    await view.getByRole('button', { name: 'Motor impairment', exact: true }).click();
    await page.waitForFunction(() => motorCommands.some(c => c.command === 'head'));
    assert.equal(await view.locator('.access').getAttribute('data-focus'), 'false');
    // The whole page is the default motor layout (the big-tile board is optional, see motor-board.cjs).
    await view.getByLabel('Full name (required)', { exact: true }).waitFor();
    assert.equal(await view.locator('.tile').count(), 0, 'no tiles by default');
    await view.getByRole('button', { name: 'Access settings', exact: true }).click();
    await view.getByRole('button', { name: 'Mouse / trackpad', exact: true }).click();
    assert.equal(await page.evaluate(() => motorCommands.at(-1).command), 'manual');
    const name = view.getByLabel('Full name (required)', { exact: true });
    await name.hover(); await view.getByRole('region', { name: 'On-screen keyboard' }).waitFor();
    await view.getByRole('button', { name: 'Key a', exact: true }).hover();
    await page.waitForTimeout(600); assert.equal(await name.inputValue(), '', 'hovering a key must not type');
    for (const key of ['Shift', 'a', 'Shift', 'l', 'e', 'x']) await view.getByRole('button', { name: `Key ${key}`, exact: true }).click();
    assert.equal(await name.inputValue(), 'Alex'); assert.equal(await page.locator('#name').inputValue(), 'Alex');
    await page.screenshot({ path: 'test-results/motor-keyboard.png' });
    await name.evaluate(el => el.setSelectionRange(1, 3));
    await view.getByRole('button', { name: 'Key o', exact: true }).click();
    assert.equal(await name.inputValue(), 'Aox', 'replace selected text');
    await view.getByRole('button', { name: 'Key Backspace', exact: true }).click();
    assert.equal(await name.inputValue(), 'Ax');
    await view.getByRole('button', { name: 'Key Symbols', exact: true }).click();
    await view.getByRole('button', { name: 'Key !', exact: true }).click();
    assert.equal(await name.inputValue(), 'A!x');
    await view.getByRole('button', { name: 'Key Symbols', exact: true }).click();
    await view.locator('.motor-keyboard').evaluate(el => el.style.width = '500px');
    await view.getByRole('button', { name: 'Key q', exact: true }).hover();
    await view.getByRole('button', { name: 'Scroll right', exact: true }).waitFor();
    await view.getByRole('button', { name: 'Scroll right', exact: true }).hover();
    await page.waitForTimeout(800);
    assert(await view.locator('.motor-keyboard').evaluate(el => el.scrollLeft > 20), 'horizontal overflow scrolls');
    await page.mouse.move(20, 180);
    await view.locator('.motor-keyboard').evaluate(el => { el.style.width = ''; el.scrollLeft = 0; });
    await view.getByRole('button', { name: 'Done typing', exact: true }).click();
    assert.equal(await view.locator('.motor-keyboard').isVisible(), false);
    const email = view.getByLabel('Email address (required)', { exact: true });
    await email.hover(); await view.locator('.motor-keyboard').waitFor();
    await view.getByRole('button', { name: 'Key a', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#motor-test').shadowRoot.querySelector('input[type=email]').getAttribute('aria-invalid') === 'true');
    await view.getByRole('button', { name: 'Done typing', exact: true }).click();
    await view.getByRole('button', { name: 'Register for workshop', exact: true }).click();
    await view.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.locator('#feedback').textContent(), '', 'no unintended submit');
    // Hover scrolling starts after delay, then stops on leaving.
    await view.evaluate(el => el.scrollTop = 0);
    await page.mouse.move(320, 400);
    const before = await view.evaluate(el => el.scrollTop);
    await view.getByRole('button', { name: 'Scroll down', exact: true }).hover();
    await page.waitForTimeout(950);
    const after = await view.evaluate(el => el.scrollTop); assert(after > before + 30, `scroll: ${before} -> ${after}`);
    await page.mouse.move(20, 180); await page.waitForTimeout(80);
    const stopped = await view.evaluate(el => el.scrollTop); await page.waitForTimeout(500);
    assert.equal(await view.evaluate(el => el.scrollTop), stopped, 'scroll stops on leave');
    assert.equal(await view.getByRole('button', { name: 'Scroll left', exact: true }).isVisible(), false);
    // Scroll zones are tall, and scrolling gets faster the farther toward the end of the zone the pointer is.
    const down = view.getByRole('button', { name: 'Scroll down', exact: true });
    const zone = await down.boundingBox(); assert.ok(zone.height >= 200 && zone.width >= 110, `scroll zone is big: ${zone.width}x${zone.height}`);
    const travelled = async (fraction) => {
      await view.evaluate(el => el.scrollTop = 0); await page.mouse.move(20, 180); await page.waitForTimeout(120);
      await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height * fraction); await page.waitForTimeout(550);
      const start = await view.evaluate(el => el.scrollTop); await page.waitForTimeout(200);
      const moved = (await view.evaluate(el => el.scrollTop)) - start; await page.mouse.move(20, 180); await page.waitForTimeout(100); return moved;
    };
    const room = await view.evaluate(el => el.scrollHeight - el.clientHeight); assert.ok(room > 500, `page has room to scroll (${room})`);
    const slow = await travelled(0.1), fast = await travelled(0.95);
    assert.ok(fast > slow * 3 && fast > 120, `farther is faster: near the middle ${slow}px, near the edge ${fast}px per 200 ms`);
    await view.evaluate(el => el.scrollTop = 600);
    await view.getByRole('button', { name: 'Back to top', exact: true }).click(); await page.waitForTimeout(1200);
    assert.equal(await view.evaluate(el => el.scrollTop), 0, 'Back to top returns to the start');
    // A paused controller (e.g. Escape) updates the selected mode; it is not restarted by polling.
    await view.getByRole('button', { name: 'Head control', exact: true }).click();
    await page.evaluate(() => mockEnabled = false); await page.waitForTimeout(1800);
    assert.equal(await view.getByRole('button', { name: 'Mouse / trackpad', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: 'test-results/motor-desktop.png' });
    await view.getByRole('button', { name: 'Head control', exact: true }).click();
    await page.evaluate(() => testUI.destroy());
    assert.equal(await page.evaluate(() => motorCommands.at(-1).command), 'manual');
    assert.deepEqual(errors, []);
    console.log('Motor UI passed: auto request, switch, hover keyboard, explicit typing, caret/selection, original field sync, validation, confirmation, hover scrolling/stop, Escape state, teardown.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
