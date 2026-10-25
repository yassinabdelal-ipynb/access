// Gives a screen reader user what a page forgot: text for images and names for icon buttons.
// Claude looks at the pictures; the policy is server/policies/screenreader.md. Images are fetched by this
// server (never by Claude) through a connection that refuses private network addresses, so a web page
// cannot use Access to reach the user's own network.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-opus-5-5';
const POLICY = readFileSync(fileURLToPath(new URL('./policies/screenreader.md', import.meta.url)), 'utf8');
export const LIMITS = { images: 12, controls: 24, bytes: 4_000_000, redirects: 3, timeoutMs: 8000 };

const Description = z.object({
  summary: z.string(),
  images: z.array(z.object({
    id: z.string(),
    role: z.enum(['photo', 'logo', 'icon', 'chart', 'diagram', 'screenshot', 'illustration', 'other']),
    decorative: z.boolean(),
    alt: z.string(),
    long: z.string(),
    text: z.string(),
  })),
  controls: z.array(z.object({ id: z.string(), label: z.string() })),
});

// ---------- Safe image download ----------
export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
  }
  return true;
}

function safeLookup(allowPrivate) {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error);
      const allowed = addresses.filter((a) => allowPrivate || !isPrivateAddress(a.address));
      if (!allowed.length) return callback(Object.assign(new Error('Blocked address.'), { code: 'EBLOCKED' }));
      if (options?.all) return callback(null, allowed);
      return callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

const MEDIA = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
];
// Claude reads PNG, JPEG, GIF and WebP. Decide from the file's own bytes, not from what the server claims.
export function sniff(buffer) {
  for (const [type, magic] of MEDIA) if (magic.every((byte, i) => buffer[i] === byte)) return type;
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function readDataUrl(url) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > LIMITS.bytes) return null;
  const type = sniff(buffer);
  return type ? { type, buffer } : null;
}

export function fetchImage(url, { referer, allowPrivate = false, redirects = LIMITS.redirects } = {}) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { return resolve(null); }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return resolve(null);
    if (net.isIP(target.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate && isPrivateAddress(target.hostname.replace(/^\[|\]$/g, ''))) return resolve(null);

    const client = target.protocol === 'https:' ? https : http;
    const request = client.request(target, {
      method: 'GET', lookup: safeLookup(allowPrivate), timeout: LIMITS.timeoutMs,
      headers: { 'User-Agent': 'AccessImageReader/1.0', Accept: 'image/png,image/jpeg,image/gif,image/webp', ...(referer ? { Referer: referer } : {}) },
    }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects <= 0) return resolve(null);
        return resolve(fetchImage(new URL(response.headers.location, target).href, { referer, allowPrivate, redirects: redirects - 1 }));
      }
      if (status !== 200) { response.resume(); return resolve(null); }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > LIMITS.bytes) { request.destroy(); return resolve(null); }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const type = sniff(buffer);
        resolve(type ? { type, buffer } : null);
      });
      response.on('error', () => resolve(null));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
    request.end();
  });
}

// ---------- Description ----------
const cache = new Map(); // image hash -> description, so a page is never paid for twice
const clean = (text, max) => String(text || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export async function describe(request, client = new Anthropic(), options = {}) {
  const lang = clean(request.lang, 12) || 'the page language';
  const images = (Array.isArray(request.images) ? request.images : []).slice(0, LIMITS.images);
  const controls = (Array.isArray(request.controls) ? request.controls : []).slice(0, LIMITS.controls);
  if (!images.length && !controls.length) throw Object.assign(new Error('Nothing to describe on this page.'), { status: 400 });

  const referer = typeof request.referer === 'string' && /^https?:\/\//.test(request.referer) ? request.referer.slice(0, 300) : undefined;
  const loaded = [];
  const cached = [];
  await Promise.all(images.map(async (item) => {
    const url = String(item.url || '');
    const file = url.startsWith('data:') ? readDataUrl(url) : await fetchImage(url, { referer, allowPrivate: options.allowPrivate });
    if (!file) return;
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    if (cache.has(hash)) { cached.push({ ...cache.get(hash), id: String(item.id) }); return; }
    loaded.push({ item, file, hash });
  }));

  const content = [{
    type: 'text',
    text: `Page: ${clean(request.title, 160)} (${clean(request.host, 80)}). Write in ${lang}.\n`
      + (controls.length ? `\nUnnamed controls (id | hints):\n${controls.map((c) => `${clean(c.id, 40)} | ${clean(c.hint, 160)}`).join('\n')}\n` : '')
      + (loaded.length ? '\nImages follow, each preceded by its id and nearby text.' : ''),
  }];
  for (const { item, file } of loaded) {
    content.push({ type: 'text', text: `Image id=${clean(item.id, 40)}; existing alt: "${clean(item.alt, 100)}"; nearby text: "${clean(item.context, 240)}"; ${item.linked ? `inside a link to: "${clean(item.linked, 120)}"` : 'not a link'}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: file.buffer.toString('base64') } });
  }

  let out = { summary: '', images: [], controls: [] };
  if (loaded.length || controls.length) {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 6000,
      system: POLICY,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low', format: zodOutputFormat(Description) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      throw Object.assign(new Error('Claude could not describe this page. The page still works without descriptions.'), { status: 502 });
    }
    out = response.parsed_output;
  }

  // Keep only what was asked for, trimmed and as plain text.
  const askedImages = new Set(images.map((i) => String(i.id)));
  const askedControls = new Set(controls.map((c) => String(c.id)));
  const byHash = new Map(loaded.map((l) => [String(l.item.id), l.hash]));
  const described = out.images.filter((d) => askedImages.has(d.id)).map((d) => {
    const entry = {
      id: d.id, role: d.role, decorative: d.decorative,
      alt: d.decorative ? '' : clean(d.alt, 125), long: clean(d.long, 500), text: clean(d.text, 300),
    };
    if (byHash.has(d.id) && (entry.alt || entry.decorative)) cache.set(byHash.get(d.id), { ...entry, id: undefined });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return entry;
  });
  return {
    summary: clean(out.summary, 200),
    images: [...described, ...cached.filter((c) => askedImages.has(c.id))],
    controls: out.controls.filter((c) => askedControls.has(c.id) && clean(c.label, 40)).map((c) => ({ id: c.id, label: clean(c.label, 40) })),
  };
}
