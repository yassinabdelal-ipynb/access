// Loads the real unpacked extension in a browser and redesigns the practice page in place.
// The copy under test gets host permission for 127.0.0.1 only, because a script cannot
// grant "activeTab" (that needs a human click on the toolbar icon).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let playwright;
playwright = require('playwright');

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'access-ext-'));
  const copy = path.join(work, 'extension');
  fs.cpSync(path.resolve('extension'), copy, { recursive: true });
  const manifestPath = path.join(copy, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const channel = process.env.ACCESS_BROWSER || 'msedge';
  const context = await playwright.chromium.launchPersistentContext(path.join(work, 'profile'), {
    channel, headless: false, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/app/demo.html');
    await page.bringToFront();
    const url = page.url();
    const opened = await worker.evaluate(() => openAccess());
    assert.equal(opened.ok, true);

    // Same tab, same URL: the page itself is replaced, with no Access frame around it.
    const view = page.locator('[data-access-root]');
    await view.getByLabel('Full name (required)', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => document.body.inert), true);
    assert.equal(await view.locator('.hero').count() + await view.locator('.bar').count() + await view.locator('.outline').count(), 0);
    assert.equal(await view.locator('.access').getAttribute('data-mode'), 'overlay');
    const look = await view.locator('.sbtn').first().evaluate((b) => getComputedStyle(b).backgroundColor);
    assert.equal(look, 'rgb(48, 84, 65)', 'buttons keep the site colour');

    // Edits in the redesigned page reach the original underneath.
    await view.getByLabel('Full name (required)', { exact: true }).fill('Alex Example');
    await view.getByLabel('Full name (required)', { exact: true }).press('Tab');
    assert.equal(await page.locator('#name').inputValue(), 'Alex Example');
    await view.getByLabel('Email address (required)', { exact: true }).fill('alex@example.com');
    await view.getByLabel('Email address (required)', { exact: true }).press('Tab');
    await view.getByRole('button', { name: 'Register for workshop', exact: true }).click();
    assert.equal(await page.locator('#feedback').textContent(), '');
    await view.getByRole('button', { name: 'Confirm action', exact: true }).click();
    await view.getByText('Registration complete, Alex Example.', { exact: false }).waitFor();

    // Dock: theme setting persists, settings open and close.
    await view.getByRole('button', { name: 'Access settings', exact: true }).click();
    await view.getByRole('button', { name: 'Dark theme', exact: true }).click();
    assert.equal(await view.locator('.access').getAttribute('data-resolved'), 'dark');
    await view.getByRole('button', { name: 'Light theme', exact: true }).click();
    await page.screenshot({ path: 'test-results/extension-overlay.png' });

    // AI redesign: the button is visible in the dock and asks for consent before anything is sent.
    await view.getByRole('button', { name: 'AI redesign with Claude', exact: true }).click();
    await view.getByRole('dialog').or(view.getByRole('alertdialog')).getByText(/Let Claude help you focus on this page\?|Let Apify and Claude redesign this website\?/).waitFor();
    await view.getByRole('button', { name: 'Not now', exact: true }).click();
    // Popup renders.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole('button', { name: 'Redesign page', exact: true }).waitFor();
    assert.equal(await popup.locator('header img[src="icons/icon.svg"]').count(), 1, 'the popup shows the Access icon');
    const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
    assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128'], 'the extension has its icons');
    await popup.close();

    // Running it again closes the overlay and restores the original page.
    await page.bringToFront();
    await worker.evaluate(() => openAccess());
    await page.locator('[data-access-root]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.body.inert), false);
    console.log('PASS: real extension loaded; page redesigned in place (same tab, same URL, no frame); site colours kept; edits and confirmation reach the original; dock theme; toggle closes.');
  } finally {
    await context.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
