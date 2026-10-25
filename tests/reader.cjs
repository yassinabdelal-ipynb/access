// Browser checks for screen reader mode. Uses its own server on port 4174 so a live head-control session on 4173 is untouched.
// Part A (always): the rebuilt page's accessibility tree, with a stand-in for Claude's image descriptions.
// Part B (only with ACCESS_LIVE_AI=1): the real extension and a real Claude vision call (costs a few cents).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
let playwright;
playwright = require('playwright');

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer() {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve('.'), env: { ...process.env, ACCESS_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout.on('data', (d) => { if (String(d).includes('Access:')) { clearTimeout(timer); resolve(); } });
    child.on('exit', () => reject(new Error('server exited')));
  });
  return child;
}

const levelsOf = (html) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

(async () => {
  const server = await startServer();
  try {
    // ---------- Part A ----------
    const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE);
    await page.evaluate(() => { document.querySelector('#demo').src = '/app/demo-blind.html'; });
    await page.waitForFunction(() => document.querySelector('#demo').contentDocument?.title === 'Common Ground community news');
    const view = page.locator('#preview');
    await view.getByRole('button', { name: 'Screen reader mode', exact: true }).click();
    const reader = view.locator('.reader');
    await reader.waitFor();

    const tree = await reader.ariaSnapshot();
    for (const expected of ['- banner', '- navigation "Main navigation"', '- search', '- main', '- contentinfo', '- heading "Common Ground community news" [level=1]']) {
      assert.ok(tree.includes(expected), `missing in accessibility tree: ${expected}\n${tree}`);
    }
    assert.equal((tree.match(/^\s*- main\b/gm) || []).length, 1, 'exactly one main landmark');
    assert.match(tree, /link "Read more: Practical accessible design/, 'a vague link says what it opens');
    assert.match(tree, /button "Open menu"/, 'an icon button gets a name');
    assert.match(tree, /button "Search"/);
    assert.match(tree, /img "Image without a description"/, 'a missing alt is flagged, never silent');
    assert.doesNotMatch(tree, /IMG_20261004/, 'a filename is not announced as a description');
    const html = await reader.evaluate((el) => el.innerHTML);
    const levels = levelsOf(html);
    assert.equal(levels.filter((l) => l === 1).length, 1, 'one h1');
    levels.reduce((prev, level) => { assert.ok(level <= prev + 1, `heading level jumped from ${prev} to ${level}`); return level; }, 0);
    assert.equal(await reader.getAttribute('lang'), 'en', 'language is declared');
    assert.equal(await view.locator('.page').getAttribute('role'), 'none', 'the wrapper is not a second main landmark');
    assert.equal(await reader.evaluate((el) => el.querySelectorAll('main').length), 1);
    assert.equal(await reader.evaluate((el) => !!el.querySelector('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])')), false, 'no positive tabindex');
    // Skip links are the first focusable things.
    await page.keyboard.press('Tab');
    const skipLinks = await reader.locator('.skip').allTextContents();
    assert.deepEqual(skipLinks, ['Skip to main content', 'Skip to search', 'Skip to navigation']);

    // A stand-in for Claude: the request must carry pictures and icon hints, never field values.
    let sent;
    await page.route('**/api/describe', async (route) => {
      sent = JSON.parse(route.request().postData());
      const [logo, chart, filename] = sent.images;
      await route.fulfill({ json: {
        summary: 'A community news page about workshop signups.',
        images: [
          { id: logo.id, role: 'logo', decorative: false, alt: 'Common Ground logo', long: '', text: 'Common Ground' },
          { id: chart.id, role: 'chart', decorative: false, alt: 'Bar chart: signups rose every quarter, from 40 to 120.', long: 'Four bars for Q1 to Q4 showing 40, 65, 90 and 120 signups.', text: 'Workshop signups per quarter' },
          { id: filename.id, role: 'chart', decorative: false, alt: 'Smaller copy of the signups chart.', long: '', text: '' },
        ],
        controls: sent.controls.map((c) => ({ id: c.id, label: /search/.test(c.hint) ? 'Search site' : 'Menu' })),
      } });
    });
    await view.getByRole('button', { name: 'Describe images with Claude', exact: true }).click();
    await view.getByRole('button', { name: 'Send and describe', exact: true }).click();
    await view.getByRole('img', { name: 'Bar chart: signups rose every quarter, from 40 to 120.' }).waitFor();
    assert.equal(sent.images.length, 3);
    assert.equal(sent.referer.startsWith(BASE), true);
    assert.ok(sent.images.every((i) => i.url.startsWith('data:image/png') || i.url.startsWith('http')));
    const described = await reader.ariaSnapshot();
    assert.match(described, /link "Common Ground logo"/, 'a logo link is named from the picture');
    assert.match(described, /img "Smaller copy of the signups chart\."/);
    assert.match(described, /region "About this page"/);
    const chart = reader.getByRole('img', { name: /Bar chart/ });
    const describedBy = await chart.getAttribute('aria-describedby');
    assert.match(await reader.locator(`#${describedBy}`).textContent(), /40, 65, 90 and 120/, 'the long description is attached to the chart');
    // Everything already has text now: a second press says so and sends nothing new.
    sent = null;
    await view.getByRole('button', { name: 'Describe images with Claude', exact: true }).click();
    await view.getByText(/already has a description/).waitFor();
    assert.equal(sent, null);
    await page.screenshot({ path: 'test-results/reader-view.png', fullPage: false });
    assert.deepEqual(errors, []);
    await browser.close();
    console.log('PASS (A): landmarks, one main, one h1, no skipped levels, skip links, language, link purpose, named icon buttons, flagged missing alt, described pictures with long description.');

    // ---------- Part B ----------
    if (process.env.ACCESS_LIVE_AI === '1') {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'access-reader-'));
      const copy = path.join(work, 'extension');
      fs.cpSync(path.resolve('extension'), copy, { recursive: true });
      const manifestPath = path.join(copy, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.host_permissions = ['http://127.0.0.1/*'];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const background = path.join(copy, 'background.js');
      fs.writeFileSync(background, fs.readFileSync(background, 'utf8').replace('http://127.0.0.1:4173', BASE));
      const context = await playwright.chromium.launchPersistentContext(path.join(work, 'profile'), {
        channel: 'msedge', headless: false, viewport: { width: 1280, height: 900 },
        args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`],
      });
      try {
        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
        const live = await context.newPage();
        await live.goto(`${BASE}/app/demo-blind.html`);
        await live.bringToFront();
        assert.equal((await worker.evaluate(() => openAccess())).ok, true);
        const overlay = live.locator('[data-access-root]');
        await overlay.locator('.dock-toggle').waitFor();
        await overlay.locator('.dock-toggle').click();
        await overlay.getByRole('button', { name: 'Screen reader mode', exact: true }).click();
        await overlay.locator('.reader').waitFor();
        await overlay.getByRole('button', { name: 'Describe images with Claude', exact: true }).click();
        await overlay.getByRole('button', { name: 'Send and describe', exact: true }).click();
        await overlay.locator('.status', { hasText: /Claude described|failed|not set up|not running/ }).waitFor({ timeout: 120000 });
        console.log('status:', await overlay.locator('.status').innerText());
        const liveTree = await overlay.locator('.reader').ariaSnapshot();
        console.log(liveTree.split('\n').filter((l) => /img|link "|button "|region/.test(l)).slice(0, 24).join('\n'));
        assert.match(liveTree, /img "[^"]*(chart|bar|graph)[^"]*"/i, 'Claude described the chart');
        assert.match(liveTree, /Common Ground/i);
        assert.doesNotMatch(liveTree, /Image without a description/, 'every picture now has text');
        await live.screenshot({ path: 'test-results/reader-live.png' });
        console.log('PASS (B): the real extension and a real Claude vision call described the pictures.');
      } finally {
        await context.close();
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
  } finally {
    server.kill();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
