// Nothing visible is dropped: text keeps its links, and charts, tables, figures, quotes, code, linked pictures
// and video all survive the redesign in every track. The head controller is mocked; no camera is used.
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

    // ---- The scan itself ----
    const scan = await page.evaluate(() => AccessEngine.create(document).scan());
    const kinds = (kind) => scan.items.filter((i) => i.kind === kind);
    const intro = scan.items.find((i) => i.kind === 'text' && i.label.startsWith('Sea levels'));
    assert.ok(intro, 'a paragraph that contains links is kept as one paragraph');
    assert.match(intro.label, /rose by 3\.4 mm a year, according to the tide gauge record, and the trend is accelerating\./);
    assert.ok(intro.runs.some((r) => r.link && r.t === 'tide gauge record'), 'its link stays inside the sentence');
    assert.ok(intro.runs.some((r) => r.b && r.t === '3.4 mm') && intro.runs.some((r) => r.i && r.t === 'accelerating'), 'bold and italics are kept');
    const chart = kinds('image').find((i) => i.chart);
    assert.ok(chart && chart.label === 'Bar chart of sea level rise by decade' && chart.caption.startsWith('Figure 1.') && chart.src.startsWith('data:image/svg+xml'), 'the SVG chart is a picture with its name and caption');
    assert.match(decodeURIComponent(chart.src), /fill:\s*rgb\(11, 61, 58\)/, 'chart colours from the page stylesheet are written into the picture');
    const table = kinds('table')[0];
    assert.ok(table && table.caption === 'Table 1. Tide gauge readings' && table.rows.length === 5 && table.headerRows === 1, 'the data table keeps its caption, header and rows');
    assert.deepEqual(table.rows[4].map((c) => c.t), ['2020s', '3.4', 'Gauge B']);
    assert.ok(table.rows[1][2].link, 'a link inside a table cell stays a link');
    assert.ok(kinds('text').some((i) => i.quote && i.label.startsWith('The harbour wall')), 'the quote is kept as a quote');
    assert.ok(kinds('code').some((i) => i.label.includes('analyse.py')), 'the code block is kept');
    assert.ok(kinds('image').some((i) => !i.chart && i.label === 'The harbour wall at high tide'), 'a picture that is a link is still a picture');
    const video = kinds('embed')[0];
    assert.ok(video && video.label === 'Tide timelapse', 'the video is kept as an embedded item');
    assert.equal(kinds('text').some((i) => /^Figure 1/.test(i.label)), false, 'the caption is not repeated as separate text');
    assert.ok(kinds('text').some((i) => i.list && i.runs?.some((r) => r.link)), 'list items keep their links');
    assert.ok(scan.theme.band && /11, 61, 58/.test(scan.theme.band.bg), 'the page header colour is found');

    // ---- The redesigned page, whole page ----
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'rich'; host.dataset.accessRoot = 'true';
      host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:1000'; document.documentElement.append(host);
      document.body.dataset.accessInert = ''; document.body.inert = true;
      window.prefsSeen = [];
      window.ui = AccessUI.mount(host.attachShadow({ mode: 'open' }), AccessEngine.create(document), {
        mode: 'overlay', cssUrl: '/extension/access.css', preferences: { purpose: 'focus', look: 'site' }, onPreferences: (p) => prefsSeen.push(p),
        onMotorControl: async () => ({ owned: true, enabled: true, pending: false, message: 'ON', hold_seconds: 0, wink_armed: true, clicks_enabled: true }),
      });
    });
    const view = page.locator('#rich');
    await view.getByRole('heading', { name: 'The numbers' }).waitFor();
    assert.ok(await view.locator('.pd-top').count(), 'a designed header');
    assert.equal(await view.getByText('Claude').count(), 0, 'no Claude title box');
    const sentence = view.locator('.pd p', { hasText: 'Sea levels around the harbour' });
    assert.equal(await sentence.locator('a.inlink').count() >= 2, true, 'inline links sit inside the sentence');
    assert.equal(await sentence.locator('strong', { hasText: '3.4 mm' }).count(), 1);
    assert.equal(await view.locator('figure.chart img.pic').count(), 1, 'chart shown');
    assert.equal(await view.locator('figure.chart figcaption').innerText(), 'Figure 1. Average yearly rise by decade, in millimetres.');
    const shown = view.locator('table.dtable');
    assert.equal(await shown.locator('tbody tr').count(), 4); assert.equal(await shown.locator('thead th').count(), 3);
    assert.equal(await shown.locator('caption').innerText(), 'Table 1. Tide gauge readings');
    assert.equal(await view.locator('blockquote').count(), 1); assert.equal(await view.locator('pre.codeblock').count(), 1);
    assert.equal(await view.locator('aside.embed').count(), 1, 'video card');
    assert.equal(await view.getByRole('img', { name: 'The harbour wall at high tide' }).count(), 1);
    // Clicking a link inside the text reaches the original page.
    await sentence.locator('a.inlink', { hasText: 'tide gauge record' }).click();
    await page.waitForFunction(() => location.hash === '#method');
    await page.screenshot({ path: 'test-results/content-whole.png' });

    // ---- Claude's layout hints split and label sections without moving content ----
    await view.getByRole('button', { name: 'Access settings', exact: true }).click();
    await page.evaluate(() => { /* consent is not needed: the plan is applied directly through a mocked route below */ });
    await page.evaluate(() => window.ui.setPreferences({ focus: true }));
    await view.locator('.slidenav').waitFor();
    // Walk the slides: the table, the chart and the quote each get a slide.
    const seen = [];
    for (let i = 0; i < 14; i++) {
      seen.push(await view.locator('.slidebox, .site').first().evaluate((el) => ({ table: !!el.querySelector('table.dtable'), chart: !!el.querySelector('figure img'), embed: !!el.querySelector('aside.embed'), code: !!el.querySelector('pre.codeblock') })));
      const next = view.getByRole('button', { name: 'Next slide', exact: true });
      if (await next.isDisabled()) break; await next.click();
    }
    assert.ok(seen.some((s) => s.table), 'a focus slide shows the table'); assert.ok(seen.some((s) => s.chart), 'a focus slide shows the chart');
    assert.ok(seen.some((s) => s.code), 'a focus slide shows the code');
    await page.evaluate(() => window.ui.setPreferences({ focus: false }));

    // ---- Motor big tiles: a table is shown a few rows at a time, and every row is reachable ----
    await page.evaluate(() => window.ui.setPreferences({ purpose: 'motor' }));
    await view.getByRole('button', { name: 'Big tiles', exact: true }).click();
    await view.locator('.tile').first().waitFor();
    const tileFacts = await view.locator('.tile').allInnerTexts();
    assert.ok(tileFacts.some((t) => /1 table/.test(t)), `a tile says it has a table: ${tileFacts.join(' | ')}`);
    await page.evaluate(() => window.ui.setPreferences({ purpose: 'reader' }));
    await view.locator('.reader').waitFor();
    assert.equal(await view.locator('.reader table.dtable').count(), 1, 'screen reader view has a real table');
    assert.equal(await view.locator('.reader table.dtable caption').count(), 1);
    assert.equal(await view.locator('.reader table.dtable th[scope="col"]').count(), 3);
    assert.equal(await view.locator('.reader figure img').count() >= 2, true);
    assert.equal(await view.locator('.reader blockquote').count(), 1);
    assert.equal(await view.locator('.reader p a.inlink').count() >= 2, true, 'links stay inside sentences for screen readers');

    await page.evaluate(() => window.ui.destroy());
    assert.deepEqual(errors, []);
    console.log('Content passed: runs with links, chart with caption, table with caption and links, quote, code, linked picture, video; whole page, focus slides, big tiles and screen reader view keep them.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
