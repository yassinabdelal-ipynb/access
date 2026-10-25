// The Apify agent: asks an Apify actor (Cheerio Scraper) to read a PUBLIC website, the page being redesigned and the
// pages its main menu links to (one level deep), and returns plain, cleaned site data: the menu (including items a
// page hides in drop-downs), the site's title, description and language, and a short list of its other pages.
//
// Privacy and safety, enforced here and covered by tests/apify.mjs:
//  * Only the address without anything after "?" or "#" and without credentials is sent to Apify.
//  * Local, private, intranet and IP-address sites are refused: Apify could not reach them and they must not be shared.
//  * The token is only sent in an Authorization header and never appears in a URL, a log line or an error message.
//  * Everything that comes back is untrusted: it is reduced to short plain strings and http(s) links.
//  * Results are cached for 15 minutes and the crawl is capped (8 pages, one level) to keep credits low.
const ACTOR = 'apify~cheerio-scraper';
const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;
const MAX_PAGES = 8;
const CACHE_MS = 15 * 60_000;
const cache = new Map();

export function apifyConfigured(env = process.env) {
  return Boolean(env.APIFY_TOKEN && String(env.APIFY_TOKEN).trim());
}

const refuse = (message, status = 400) => Object.assign(new Error(message), { status });

// The address that may be shared with Apify, or an error saying why not.
export function cleanTarget(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw refuse('That is not a web address.'); }
  if (String(value).length > 600) throw refuse('That web address is too long.');
  if (!['http:', 'https:'].includes(url.protocol)) throw refuse('Only web pages (http or https) can be read.');
  if (url.username || url.password) throw refuse('Addresses with a sign-in inside are never shared.');
  if (url.port) throw refuse('Only sites on the normal web ports can be read.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || /^[\d.]+$/.test(host) || /^[0-9a-f:]+$/.test(host)) throw refuse('Use the name of the site, not a numeric address.');
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|invalid|example)$/.test(host) || host.endsWith('.home.arpa')) {
    throw refuse('Only public websites can be read. Local and private sites stay on this computer.');
  }
  const pathname = url.pathname.replace(/\/{2,}/g, '/');
  return { url: `${url.protocol}//${host}${pathname}`, origin: `${url.protocol}//${host}` };
}

// Runs inside Apify's Cheerio Scraper (a fixed script of ours, never built from page text).
const PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request } = context;
  const text = (el) => $(el).text().replace(/\\s+/g, ' ').trim();
  const here = request.loadedUrl || request.url;
  const abs = (href) => { try { return new URL(href, here).href; } catch (e) { return ''; } };
  const meta = (name) => $('meta[name="' + name + '"], meta[property="' + name + '"]').attr('content') || '';
  const links = [];
  const seen = new Set();
  $('a[href]').each((i, a) => {
    const href = abs($(a).attr('href'));
    const label = text(a) || $(a).attr('aria-label') || $(a).attr('title') || '';
    if (!/^https?:/i.test(href) || !label) return;
    const key = href + '|' + label;
    if (seen.has(key)) return;
    seen.add(key);
    const nav = $(a).closest('nav, header, [role="navigation"], [role="banner"], .menu, .nav, .navbar, .navigation').length > 0;
    links.push({ label: label.slice(0, 120), href: href, nav: nav });
  });
  const jsonld = [];
  $('script[type="application/ld+json"]').each((i, s) => {
    try {
      const data = JSON.parse($(s).html());
      (Array.isArray(data) ? data : [data]).slice(0, 3).forEach((x) => jsonld.push({ type: String(x['@type'] || ''), name: String(x.name || ''), description: String(x.description || '').slice(0, 300) }));
    } catch (e) { /* not JSON */ }
  });
  const headings = [];
  $('h1, h2').each((i, h) => { const t = text(h); if (t && headings.length < 12) headings.push(t.slice(0, 120)); });
  return {
    url: here,
    title: text($('title').first()).slice(0, 200),
    description: (meta('description') || meta('og:description')).slice(0, 300),
    lang: ($('html').attr('lang') || '').slice(0, 20),
    headings: headings,
    links: links.slice(0, 250),
    jsonld: jsonld.slice(0, 5)
  };
}`;

export function buildInput(target) {
  return {
    startUrls: [{ url: target.url }],
    pseudoUrls: [{ purl: `${target.origin}/[.*]` }], // the same site only
    linkSelector: 'header a[href], nav a[href], [role="navigation"] a[href]', // the main menu, not every link
    maxCrawlingDepth: 1,
    maxPagesPerCrawl: MAX_PAGES,
    maxConcurrency: 4,
    pageLoadTimeoutSecs: 20,
    respectRobotsTxtFile: true,
    keepUrlFragments: false,
    pageFunction: PAGE_FUNCTION,
  };
}

// ----- cleaning what comes back -----
const plain = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const httpLink = (value) => {
  try {
    const u = new URL(String(value));
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return '';
    u.hash = '';
    return u.href.slice(0, 600);
  } catch { return ''; }
};
const sameKey = (href) => { try { const u = new URL(href); return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`; } catch { return href; } };

export function normalize(items, target, now = Date.now()) {
  const rows = (Array.isArray(items) ? items : []).filter((x) => x && typeof x === 'object').slice(0, MAX_PAGES);
  const pages = rows.map((row) => ({
    url: httpLink(row.url),
    title: plain(row.title, 160),
    description: plain(row.description, 240),
    lang: plain(row.lang, 20),
    headings: (Array.isArray(row.headings) ? row.headings : []).slice(0, 12).map((h) => plain(h, 120)).filter(Boolean),
    links: (Array.isArray(row.links) ? row.links : []).slice(0, 250).map((l) => ({ label: plain(l?.label, 80), href: httpLink(l?.href), nav: l?.nav === true })).filter((l) => l.label && l.href),
    type: plain(Array.isArray(row.jsonld) ? row.jsonld[0]?.type : '', 60),
  })).filter((p) => p.url);
  if (!pages.length) throw refuse('Apify did not return any pages for this site.', 502);
  const home = pages.find((p) => sameKey(p.url) === sameKey(target.url)) || pages[0];
  const menu = [];
  const seen = new Set();
  for (const link of home.links) {
    if (!link.nav) continue;
    const key = sameKey(link.href);
    if (seen.has(key) || key === sameKey(target.url)) continue;
    seen.add(key);
    menu.push({ label: link.label, href: link.href });
    if (menu.length >= 60) break;
  }
  const others = pages.filter((p) => p !== home && p.title && new URL(p.url).origin === target.origin).slice(0, 7)
    .map((p) => ({ url: p.url, title: p.title, description: p.description }));
  return { origin: target.origin, title: home.title, description: home.description, lang: home.lang, type: home.type, headings: home.headings.slice(0, 8), menu, pages: others, fetchedAt: now };
}

// ----- the call -----
export async function scrapeSite(request, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  if (!apifyConfigured(env)) throw refuse('The Apify agent is not set up. Add APIFY_TOKEN to .env and restart the server.', 503);
  if (request?.consent !== true) throw refuse('Agree to share the web address with Apify first.', 400);
  const target = cleanTarget(request.url);
  const hit = cache.get(target.url);
  if (hit && now() - hit.at < CACHE_MS) return { ...hit.site, cached: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 80_000);
  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}?timeout=60&limit=${MAX_PAGES}&clean=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(env.APIFY_TOKEN).trim()}` },
      body: JSON.stringify(buildInput(target)),
      signal: controller.signal,
    });
  } catch (error) {
    throw refuse(error?.name === 'AbortError' ? 'Apify took too long to read this site.' : 'Could not reach Apify. Check the internet connection.', 504);
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const status = response.status;
    throw refuse(
      status === 401 ? 'Apify rejected the token. Check APIFY_TOKEN in .env.'
        : status === 403 ? 'Apify will not run the Cheerio Scraper yet. Open apify.com/apify/cheerio-scraper in Apify Console, approve its permissions once, then try again.'
        : status === 402 ? 'The Apify account is out of credits.'
          : status === 408 ? 'Apify took too long to read this site.'
            : status === 429 ? 'Apify is busy. Try again in a minute.'
              : 'Apify could not read this site.', status === 401 || status === 403 ? 503 : 502);
  }
  let items;
  try { items = await response.json(); } catch { throw refuse('Apify sent something unexpected.', 502); }
  const site = normalize(items, target, now());
  cache.set(target.url, { at: now(), site });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return site;
}

export function clearSiteCache() { cache.clear(); }
