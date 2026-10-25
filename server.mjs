import http from 'node:http';
import { createMotorBridge } from './server/motor.mjs';
const motor = createMotorBridge();
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { aiConfigured, redesign } from './server/redesign.mjs';
import { describe } from './server/describe.mjs';
import { apifyConfigured, scrapeSite } from './server/apify.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const served = ['/app/', '/extension/'];
const PORT = Number(process.env.ACCESS_PORT) || 4173; // another port lets tests run beside a live session
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MAX_BODY = 600_000;

// Keys live in .env (git-ignored) or the environment; they are never sent to the extension.
try {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file */ }

// Only this app and the Access extension may use the API, never another website.
const allowedOrigin = (origin) => !origin || origin === ORIGIN || origin.startsWith('chrome-extension://');
const recent = [];
const recentDescribe = [];
const recentSite = [];
const busy = new Set();

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Page is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
}

export const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain') =>
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(body);
  const json = (status, value) => send(status, JSON.stringify(value), 'application/json');
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      if (!allowedOrigin(req.headers.origin) || req.headers['x-access'] !== '1') return json(403, { error: 'Forbidden' });
      if (url.pathname === '/api/motor' && req.method === 'POST') return json(200, motor.command(await readJson(req)));
      if (url.pathname === '/api/status' && req.method === 'GET') return json(200, { ai: aiConfigured(), site: apifyConfigured() });
      if (url.pathname === '/api/redesign' && req.method === 'POST') {
        if (!aiConfigured()) return json(503, { error: 'AI is not set up. Add ANTHROPIC_API_KEY to the .env file in the Access folder and restart the server.' });
        const now = Date.now();
        while (recent.length && now - recent[0] > 3600_000) recent.shift();
        if (recent.length >= 40) return json(429, { error: 'Too many AI redesigns this hour. Try again later.' });
        const who = req.headers.origin || 'local';
        if (busy.has(who)) return json(429, { error: 'A redesign is already running.' });
        busy.add(who);
        try {
          recent.push(now);
          return json(200, await redesign(await readJson(req)));
        } finally { busy.delete(who); }
      }
      if (url.pathname === '/api/describe' && req.method === 'POST') {
        if (!aiConfigured()) return json(503, { error: 'AI is not set up. Add ANTHROPIC_API_KEY to the .env file in the Access folder and restart the server.' });
        const now = Date.now();
        while (recentDescribe.length && now - recentDescribe[0] > 3600_000) recentDescribe.shift();
        if (recentDescribe.length >= 40) return json(429, { error: 'Too many image descriptions this hour. Try again later.' });
        const who = `describe:${req.headers.origin || 'local'}`;
        if (busy.has(who)) return json(429, { error: 'Image descriptions are already running.' });
        busy.add(who);
        try {
          recentDescribe.push(now);
          // Private-network image addresses are refused unless this is a deliberate local test run.
          return json(200, await describe(await readJson(req), undefined, { allowPrivate: process.env.ACCESS_ALLOW_LOCAL_IMAGES === '1' }));
        } finally { busy.delete(who); }
      }
      // The Apify agent: reads a public website (this page and the pages its menu links to) for the redesign.
      if (url.pathname === '/api/site' && req.method === 'POST') {
        const now = Date.now();
        while (recentSite.length && now - recentSite[0] > 3600_000) recentSite.shift();
        if (recentSite.length >= 12) return json(429, { error: 'Too many site reads this hour. Try again later.' });
        const who = `site:${req.headers.origin || 'local'}`;
        if (busy.has(who)) return json(429, { error: 'A site read is already running.' });
        busy.add(who);
        try {
          const body = await readJson(req);
          const site = await scrapeSite(body);
          if (!site.cached) recentSite.push(now);
          return json(200, { site });
        } catch (error) {
          // Apify errors are described to the person; the token and Apify's raw replies never leave the server.
          const status = Number.isInteger(error.status) && error.status >= 400 ? error.status : 502;
          return json(status, { error: status >= 500 && !error.message ? 'The site read failed.' : error.message });
        } finally { busy.delete(who); }
      }      return json(404, { error: 'Not found' });
    }

    const route =url.pathname === '/' ? '/app/index.html' : url.pathname;
    if (!served.some((prefix) => route.startsWith(prefix))) return send(404, 'Not found');
    const file = path.resolve(root, '.' + decodeURIComponent(route));
    if (!file.startsWith(root)) return send(403, 'Forbidden');
    // Read first so a missing file is a 404, never a 200 with an empty body.
    const body = await readFile(file);
    send(200, body, mime[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    if (req.url?.startsWith('/api/')) {
      const status = Number.isInteger(error.status) && error.status >= 400 ? error.status : 502;
      console.error('AI request failed:', error.message);
      return json(status === 401 ? 503 : status, { error: status === 401 ? 'The Anthropic key was rejected. Check ANTHROPIC_API_KEY in .env.' : error.status && error.status < 500 ? error.message : 'The AI redesign failed. Try again, or use the standard redesign.' });
    }
    send(404, 'Not found');
  }
});

server.on('close', () => motor.close());
process.once('exit', () => motor.close());

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Access: ${ORIGIN}` + (aiConfigured() ? ' (AI ready)' : ' (AI not configured)') + (apifyConfigured() ? ', site reader ready' : '')));
}
