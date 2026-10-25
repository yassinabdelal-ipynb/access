// The Apify agent, tested without the network: a fake Apify answers. Covers what is sent (address only, no query,
// no credentials, token only in a header), what is refused (local, private, numeric, sign-in addresses), how replies are
// cleaned (hostile text, javascript: links), caching, error messages, and the /api/site route's consent and rate limits.
import assert from 'node:assert/strict';
import { apifyConfigured, buildInput, cleanTarget, clearSiteCache, normalize, scrapeSite } from '../server/apify.mjs';

const TOKEN = 'apify_api_SECRET_TOKEN_123';
const env = { APIFY_TOKEN: TOKEN };

const page = (url, extra = {}) => ({ url, title: 'Title of ' + url, description: 'About ' + url, lang: 'en', headings: ['Heading'], links: [], jsonld: [{ type: 'Organization' }], ...extra });
const reply = (items, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => items });

// ---- configuration and addresses ----
assert.equal(apifyConfigured({}), false); assert.equal(apifyConfigured({ APIFY_TOKEN: '  ' }), false); assert.equal(apifyConfigured(env), true);
assert.deepEqual(cleanTarget('https://Shop.Example-Store.com/a//b?session=abc&token=1#top'), { url: 'https://shop.example-store.com/a/b', origin: 'https://shop.example-store.com' }, 'query, fragment and double slashes are dropped');
for (const bad of ['http://localhost/', 'https://127.0.0.1/', 'https://192.168.1.4/', 'https://[::1]/', 'https://intranet/', 'https://printer.local/', 'https://wiki.corp/', 'https://user:pw@site.com/', 'https://site.com:8443/', 'ftp://site.com/', 'javascript:alert(1)', 'not a url', '']) {
  assert.throws(() => cleanTarget(bad), (e) => e.status === 400 && !e.message.includes('pw'), `refuses ${bad}`);
}

// ---- the request that goes to Apify ----
const input = buildInput(cleanTarget('https://nasa.gov/missions'));
assert.equal(input.maxCrawlingDepth, 1); assert.ok(input.maxPagesPerCrawl <= 8);
assert.equal(input.pseudoUrls[0].purl, 'https://nasa.gov/[.*]', 'only the same site is followed');
assert.doesNotThrow(() => new Function(`return (${input.pageFunction})`), 'the page function is valid JavaScript');
assert.ok(!input.pageFunction.includes('${'), 'the page function is fixed text, not built from page content');

clearSiteCache();
let calls = [];
const good = [
  page('https://nasa.gov/missions', { links: [
    { label: 'Missions', href: 'https://nasa.gov/missions', nav: true },
    { label: 'Hidden drop-down: Moon', href: 'https://nasa.gov/moon#x', nav: true },
    { label: 'Hidden drop-down: Mars', href: 'https://nasa.gov/mars', nav: true },
    { label: 'Mars again', href: 'https://nasa.gov/mars/', nav: true },
    { label: 'Footer link', href: 'https://nasa.gov/privacy', nav: false },
    { label: 'Evil', href: 'javascript:alert(1)', nav: true },
    { label: '', href: 'https://nasa.gov/empty', nav: true },
    { label: 'With login', href: 'https://u:p@nasa.gov/x', nav: true },
  ] }),
  page('https://nasa.gov/moon', { title: 'The Moon‮ evil\u0000', description: 'x'.repeat(2000) }),
  page('https://other.com/off-site', { title: 'Off site' }),
];
const fetchImpl = async (url, options) => { calls.push({ url, options }); return reply(good); };
const site = await scrapeSite({ url: 'https://nasa.gov/missions?utm=1#top', consent: true }, { env, fetchImpl });
assert.equal(calls.length, 1);
assert.ok(calls[0].url.startsWith('https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items'), 'the official Cheerio Scraper actor');
assert.ok(!calls[0].url.includes(TOKEN) && !calls[0].url.includes('utm'), 'no token and no query in the URL');
assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`, 'the token travels only in the Authorization header');
const sent = JSON.parse(calls[0].options.body);
assert.equal(sent.startUrls[0].url, 'https://nasa.gov/missions', 'only the cleaned address is sent');
assert.ok(!JSON.stringify(sent).includes('utm') && !JSON.stringify(sent).includes(TOKEN));

// ---- what comes back ----
assert.deepEqual(site.menu.map((m) => m.label), ['Hidden drop-down: Moon', 'Hidden drop-down: Mars'], 'hidden menu items, de-duplicated, no javascript:, no empty labels, no credentials, no footer links');
assert.equal(site.menu[0].href, 'https://nasa.gov/moon', 'fragments are removed');
assert.equal(site.title, 'Title of https://nasa.gov/missions'); assert.equal(site.type, 'Organization'); assert.equal(site.lang, 'en');
assert.deepEqual(site.pages.map((p) => p.url), ['https://nasa.gov/moon'], 'only pages of the same site are listed');
assert.equal(site.pages[0].title, 'The Moon evil', 'control and direction-override characters are removed');
assert.ok(site.pages[0].description.length <= 240, 'long text is cut');
assert.ok(!JSON.stringify(site).includes(TOKEN));

// ---- cache: the same page is not read twice ----
const again = await scrapeSite({ url: 'https://nasa.gov/missions', consent: true }, { env, fetchImpl });
assert.equal(calls.length, 1); assert.equal(again.cached, true);

// ---- refusals and errors (the token never appears) ----
await assert.rejects(scrapeSite({ url: 'https://nasa.gov/', consent: true }, { env: {}, fetchImpl }), (e) => e.status === 503 && /not set up/.test(e.message));
await assert.rejects(scrapeSite({ url: 'https://nasa.gov/other', consent: false }, { env, fetchImpl }), (e) => e.status === 400 && /agree/i.test(e.message), 'no consent, no request');
await assert.rejects(scrapeSite({ url: 'http://localhost:4173/', consent: true }, { env, fetchImpl }), (e) => e.status === 400);
assert.equal(calls.length, 1, 'refused addresses never reach Apify');
for (const [status, pattern] of [[401, /rejected the token/], [402, /out of credits/], [408, /too long/], [429, /busy/], [500, /could not read/]]) {
  clearSiteCache();
  await assert.rejects(scrapeSite({ url: `https://site${status}.com/`, consent: true }, { env, fetchImpl: async () => reply({ error: TOKEN }, status) }), (e) => pattern.test(e.message) && !e.message.includes(TOKEN), `status ${status}`);
}
clearSiteCache();
await assert.rejects(scrapeSite({ url: 'https://down.com/', consent: true }, { env, fetchImpl: async () => { throw new Error(`connect failed ${TOKEN}`); } }), (e) => /Could not reach Apify/.test(e.message) && !e.message.includes(TOKEN));
await assert.rejects(scrapeSite({ url: 'https://empty.com/', consent: true }, { env, fetchImpl: async () => reply([]) }), (e) => e.status === 502);
assert.throws(() => normalize('nonsense', cleanTarget('https://x.com/')), (e) => e.status === 502);

// ---- the server route: consent flag, status flag, and no token in any reply ----
const { server } = await import('../server.mjs');
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { 'Content-Type': 'application/json', 'X-Access': '1' };
const status = await (await fetch(`${base}/api/status`, { headers })).json();
assert.equal(typeof status.site, 'boolean');
assert.equal((await fetch(`${base}/api/site`, { method: 'POST', body: '{}' })).status, 403, 'needs the Access header');
assert.equal((await fetch(`${base}/api/site`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403, 'other websites cannot use it');
// Only when no token is configured: with a real token this request would spend Apify credits.
if (!status.site) {
  const noToken = await fetch(`${base}/api/site`, { method: 'POST', headers, body: JSON.stringify({ url: 'https://nasa.gov/', consent: true }) });
  assert.equal(noToken.status, 503); assert.match((await noToken.json()).error, /not set up/);
}
// Refused addresses never reach Apify, with or without a token.
const refused = await fetch(`${base}/api/site`, { method: 'POST', headers, body: JSON.stringify({ url: 'http://localhost:4173/', consent: true }) });
assert.ok([400, 503].includes(refused.status));
await new Promise((resolve) => server.close(resolve));
console.log('Apify passed: address-only requests, refusals, token handling, cleaning, cache, errors, and the route.');
process.exit(0);
