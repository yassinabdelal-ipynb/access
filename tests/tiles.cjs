// Big tiles: reasonable size, the extension's own palette, merged small sections, no lone giant buttons,
// content-based titles, and AI titles (mocked here) that are asked for once, only with consent, with no field values.
const assert = require('node:assert/strict');
let pw; pw = require('playwright');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const consent of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:4173/app/demo-tiles.html');
      for (const file of ['engine.js', 'reader.js', 'motor.js', 'ui.js']) await page.addScriptTag({ url: `/extension/${file}` });
      await page.evaluate(() => { window.asked = []; });
      await page.exposeFunction('askAi', async (payload) => {
        await page.evaluate((p) => window.asked.push(p), payload);
        return { tiles: payload.tiles.map((t) => ({ n: t.n, title: `Written ${t.n}`, subtitle: `About ${t.heading || t.sample[0] || 'this'}` })) };
      });
      await page.evaluate((consent) => {
        const host = document.createElement('div'); host.id = 't'; host.dataset.accessRoot = 'true';
        host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:1000'; document.documentElement.append(host);
        document.body.dataset.accessInert = ''; document.body.inert = true;
        window.ui = AccessUI.mount(host.attachShadow({ mode: 'open' }), AccessEngine.create(document), {
          mode: 'overlay', cssUrl: '/extension/access.css', preferences: { purpose: 'motor', aiConsent: consent },
          onRedesign: (p) => window.askAi(p),
          onMotorControl: async () => ({ owned: true, enabled: true, pending: false, message: 'ON', hold_seconds: 0, wink_armed: true, clicks_enabled: true }),
        });
      }, consent);
      const v = page.locator('#t');
      await v.getByRole('button', { name: 'Big tiles', exact: true }).click();
      await v.locator('.tile').first().waitFor();
      if (consent) await page.waitForFunction(() => window.asked.length >= 1);
      await page.waitForTimeout(600);

      // ---- Size: large enough to hit, not huge ----
      const boxes = await v.locator('.tile').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      for (const [w, h] of boxes) { assert.ok(w >= 300 && w <= 420, `tile width ${w}`); assert.ok(h >= 150 && h <= 210, `tile height ${h}`); }

      // ---- The extension's own palette, not the site's orange ----
      const look = await v.evaluate((host) => {
        const r = host.shadowRoot; const tile = r.querySelector('.tile'); const panel = r.querySelector('.access');
        return { tileBg: getComputedStyle(tile).backgroundColor, panelVar: getComputedStyle(panel).getPropertyValue('--panel').trim(), pageBg: getComputedStyle(r.querySelector('.board')).backgroundColor, text: getComputedStyle(tile).color };
      }, await v.elementHandle());
      assert.equal(look.tileBg, 'rgb(255, 255, 255)', `tile uses the extension panel colour (${look.panelVar})`);
      assert.doesNotMatch(look.text + look.pageBg, /180, 83, 9|59, 42, 20|255, 244, 229/, 'no site colours on the board');

      // ---- Merged and useful tiles: the two single-button sections and the one-line hours share a tile ----
      const names = await v.locator('.tile-name').allInnerTexts();
      const subs = await v.locator('.tile-sub').allInnerTexts();
      const chips = await v.locator('.tile').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.chip')].map((c) => c.textContent).join(' / ')));
      const tileCount = names.length;
      if (!consent) {
        assert.ok(tileCount <= 5, `small sections are merged, got ${tileCount} tiles: ${names.join(' | ')}`);
        assert.ok(names.includes('Quick actions'), `a Quick actions tile exists: ${names.join(' | ')}`);
        assert.ok(!names.some((n) => /^(Top of the page|More on this page|Section)$/i.test(n)), `no vague titles: ${names.join(' | ')}`);
        assert.ok(subs.every((s) => s.length > 0), `every tile has a subtitle: ${subs.join(' | ')}`);
        const quickIndex = names.indexOf('Quick actions');
        assert.match(subs[quickIndex], /Renew all|Report/, 'the quick tile says what is in it');
        assert.ok(chips[quickIndex].includes('2 buttons'));
        const formIndex = names.findIndex((n) => /join the library/i.test(n));
        assert.ok(formIndex >= 0 && /full name/i.test(subs[formIndex]) && /3 fields/.test(chips[formIndex]), `the form tile names its fields: ${names[formIndex]} | ${subs[formIndex]} | ${chips[formIndex]}`);

        // ---- The quick tile shows both buttons on one step (no giant lone button) ----
        await v.locator('.tile').nth(quickIndex).click();
        await v.locator('.board-step').waitFor();
        let buttons = 0;
        for (let guard = 0; guard < 6; guard++) {
          const onScreen = await v.locator('.board-step').evaluate((el) => ({ buttons: el.querySelectorAll('.btn.action').length, words: el.querySelectorAll('h3, h4, p').length }));
          assert.ok(onScreen.words > 0, 'a step never holds only a button');
          buttons += onScreen.buttons;
          const next = v.getByRole('button', { name: 'Next step', exact: true });
          if (!(await next.count()) || await next.isDisabled()) break;
          await next.click();
        }
        assert.equal(buttons, 2, 'both buttons are reachable');
        await v.getByRole('button', { name: 'Previous step', exact: true }).click().catch(() => {});
        const bw = await v.locator('.board-step .btn.action').first().evaluate((el) => el.getBoundingClientRect().width);
        assert.ok(bw <= 640, `buttons are not stretched across the screen (${bw})`);
        await page.screenshot({ path: 'test-results/tiles-quick.png' });
        await v.getByRole('button', { name: 'Back to all tiles', exact: true }).click();
        await v.locator('.tile').first().waitFor();
        // No AI without consent: nothing was asked
        assert.equal(await page.evaluate(() => window.asked.length), 0, 'no AI request without consent');
        await v.getByRole('button', { name: 'Write clearer tile titles with AI', exact: true }).waitFor();
        await page.screenshot({ path: 'test-results/tiles-local.png' });
      } else {
        // ---- AI titles: one request, tiles only, no field values, the written titles are shown ----
        assert.equal(await page.evaluate(() => window.asked.length), 1, 'asked exactly once');
        const sent = await page.evaluate(() => window.asked[0]);
        assert.equal(sent.tilesOnly, true); assert.equal(sent.purpose, 'motor');
        assert.ok(sent.tiles.length === tileCount && sent.tiles.every((t) => Array.isArray(t.sample) && t.sample.length <= 5 && t.counts), 'a compact description of every tile');
        assert.equal(JSON.stringify(sent).includes('"value"'), false, 'no field values are sent');
        assert.deepEqual(names, names.map((_, i) => `Written ${i}`), 'the written titles replace the built-in ones');
        assert.ok(subs.every((s) => s.startsWith('About ')), 'and the written subtitles');
        await v.getByRole('button', { name: 'Whole page', exact: true }).click();
        await v.getByRole('button', { name: 'Big tiles', exact: true }).click();
        await v.locator('.tile').first().waitFor();
        await page.waitForTimeout(500);
        assert.equal(await page.evaluate(() => window.asked.length), 1, 'coming back to the tiles does not ask again');
        await page.screenshot({ path: 'test-results/tiles-ai.png' });
      }
      await page.evaluate(() => window.ui.destroy());
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Tiles passed: sized for pointing, extension palette, merged small sections, no lone giant buttons, content-based titles, AI titles asked once with consent and no field values.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
