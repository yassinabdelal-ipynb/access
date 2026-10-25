// Motor board: giant tiles, one step at a time, dwell click with a ring, safe-first confirmation, rest. The head controller is mocked.
const assert = require('node:assert/strict');
let pw; pw = require('playwright');
const out = (n) => `test-results/motor-board-${n}.png`;
(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/app/demo.html', { waitUntil: 'domcontentloaded' });
    for (const file of ['engine.js', 'reader.js', 'motor.js', 'ui.js']) await page.addScriptTag({ url: `/extension/${file}` });
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'motor-test'; host.dataset.accessRoot = 'true';
      host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:1000'; document.documentElement.append(host);
      document.body.dataset.accessInert = ''; document.body.inert = true;
      window.testUI = AccessUI.mount(host.attachShadow({ mode: 'open' }), AccessEngine.create(document), {
        mode: 'overlay', cssUrl: '/extension/access.css', fontsUrl: '/extension/fonts/', preferences: { purpose: 'motor', look: 'site' },
        onMotorControl: async () => ({ owned: true, enabled: true, pending: false, message: 'Head ON', hold_seconds: 0, wink_armed: true, clicks_enabled: true }),
      });
    });
    const v = page.locator('#motor-test');
    // Whole page is the default; the board is opt-in through "Big tiles".
    await v.getByRole('button', { name: 'Big tiles', exact: true }).waitFor();
    assert.equal(await v.locator('.tile').count(), 0, 'whole page is the default');
    await v.getByRole('button', { name: 'Big tiles', exact: true }).click();
    await v.locator('.tile').first().waitFor();
    const center = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const dwellOn = async (loc, ms = 1500) => { await page.mouse.move(...(await center(loc))); await page.waitForTimeout(ms); };
    const park = async () => { await page.mouse.move(40, 740); await page.waitForTimeout(150); };
    const title = async () => v.locator('.board-where').first().innerText();

    // 1. Hover alone never acts: wait less than the dwell time, then leave.
    await page.mouse.move(...(await center(v.locator('.tile').nth(3)))); await page.waitForTimeout(500); await park();
    assert.equal(await v.locator('.tile').count(), 4, 'a short hover opens nothing');

    // 2. Dwell opens the tile
    await dwellOn(v.locator('.tile').nth(3));
    await v.locator('.board-step').waitFor();
    assert.match(await title(), /Step 1 of/);

    // 3. Dwell a field -> keyboard, type with dwell on keys is slow, so click keys
    await park();
    const name = v.getByLabel('Full name (required)', { exact: true });
    await dwellOn(name, 1100);
    await v.locator('.motor-keyboard').waitFor();
    await page.screenshot({ path: out('1-keyboard') });
    for (const k of ['Shift', 'a', 'Shift', 'l', 'e', 'x']) await v.getByRole('button', { name: `Key ${k}`, exact: true }).click();
    assert.equal(await name.inputValue(), 'Alex');
    await v.getByRole('button', { name: 'Done typing', exact: true }).click();
    await park();

    // 4. Dwell on Next, then keep the pointer still: it must NOT run on through the next steps
    const next = v.getByRole('button', { name: 'Next step', exact: true });
    await dwellOn(next, 1500);
    assert.match(await title(), /Step 2 of/);
    await page.waitForTimeout(2200);
    assert.match(await title(), /Step 2 of/, 'a still pointer does not chain through steps');
    await page.screenshot({ path: out('2-step2') });
    

    // 5. Go on until the select shows up, dwell it, pick an option by dwell
    await park();
    for (let i = 0; i < 4 && !(await v.getByLabel('Workshop', { exact: true }).count()); i++) { await dwellOn(v.getByRole('button', { name: 'Next step', exact: true }), 1500); await park(); }
    const select = v.getByLabel('Workshop', { exact: true });
    await dwellOn(select, 1500);
    const picker = v.getByRole('dialog', { name: 'Choose: Workshop' }); await picker.waitFor();
    await page.screenshot({ path: out('3-picker') });
    await dwellOn(picker.getByRole('radio', { name: 'Build your first website' }), 1500);
    await picker.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#workshop').inputValue(), 'web');
    await park();

    // 6. Register -> confirmation, safe choice first; go back sends nothing
    for (let i = 0; i < 4 && !(await v.getByRole('button', { name: 'Register for workshop', exact: true }).count()); i++) { await dwellOn(v.getByRole('button', { name: 'Next step', exact: true }), 1500); await park(); }
    await page.screenshot({ path: out('4-register') });
    await dwellOn(v.getByRole('button', { name: 'Register for workshop', exact: true }), 1500);
    const confirm = v.getByRole('alertdialog'); await confirm.waitFor();
    assert.deepEqual(await confirm.getByRole('button').allInnerTexts(), ['No, go back', 'Yes, do it']);
    await page.screenshot({ path: out('5-confirm') });
    await park();
    await dwellOn(confirm.getByRole('button', { name: 'Cancel' }), 1500);
    await confirm.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#feedback').textContent(), '', 'going back sends nothing');

    // 6b. Say yes: the board takes you to the result instead of leaving you on a screen where nothing seems to have happened
    await page.evaluate(() => { document.querySelector('#email').value = 'alex@example.com'; });
    await park();
    await dwellOn(v.getByRole('button', { name: 'Register for workshop', exact: true }), 1500);
    const confirm2 = v.getByRole('alertdialog'); await confirm2.waitFor();
    await park();
    await dwellOn(confirm2.getByRole('button', { name: 'Confirm action' }), 1500);
    await v.locator('.board-step').filter({ hasText: 'Registration complete' }).waitFor();
    assert.match(await page.locator('#feedback').textContent(), /Registration complete/);

    // 7. Rest
    await park();
    await v.getByRole('button', { name: 'Advanced', exact: true }).click();
    await v.getByRole('button', { name: /^Dwell/ }).click();
    await v.getByRole('button', { name: 'Rest', exact: true }).click();
    await page.screenshot({ path: out('6-rest') });
    await dwellOn(v.getByRole('button', { name: 'Resume', exact: true }), 1700);
    await v.locator('.motor-rest').waitFor({ state: 'hidden' });
    
    await page.screenshot({ path: out('7-after-rest') });
    assert.deepEqual(errors, []);
    console.log('Motor board passed: hover alone does nothing, dwell opens tiles and fields, no chained dwell, option picker, safe-first confirmation, rest and resume.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
