// Asks Claude for a small set of targeted changes that make a page easier to focus on.
// What Claude may do is written in server/policies/<purpose>.md and enforced again here:
// it can only name ids it was given, and it can never touch fields or submit buttons.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-opus-5-5';
const MAX_ITEMS = 300;
const MAX_LABEL = 120;
const PURPOSES = ['focus', 'motor'];
const policies = Object.fromEntries(PURPOSES.map((name) => [
  name, readFileSync(fileURLToPath(new URL(`./policies/${name}.md`, import.meta.url)), 'utf8'),
]));
const tilePolicy = readFileSync(fileURLToPath(new URL('./policies/tiles.md', import.meta.url)), 'utf8');

const TileTitles = z.object({ tiles: z.array(z.object({ n: z.number(), title: z.string(), subtitle: z.string() })) });

const Plan = z.object({
  summary: z.string(),
  main: z.array(z.object({ from: z.string(), to: z.string() })),
  hide: z.array(z.object({ id: z.string(), reason: z.enum(['ad', 'cookie-banner', 'popup', 'tracking', 'autoplay', 'filler', 'other']) })),
  collapse: z.array(z.object({ label: z.string(), ids: z.array(z.string()) })),
  chunks: z.array(z.object({ startId: z.string(), title: z.string() })),
  gists: z.array(z.object({ id: z.string(), text: z.string() })),
  layout: z.array(z.object({ startId: z.string(), role: z.enum(['hero', 'article', 'cards', 'gallery', 'steps', 'data', 'callout', 'cta']), title: z.string() })),
});

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// "id | kind | detail | label". Text shows its length so Claude can judge what is long.
function line(item) {
  const detail = item.kind === 'heading' ? `h${item.level ?? ''}`
    : item.kind === 'field' ? `${item.type || 'text'}${item.required ? ',required' : ''}`
    : item.kind === 'action' ? (item.link ? 'link' : 'button')
    : item.kind === 'text' ? `${item.words ?? ''}w`
    : item.kind === 'image' ? (item.chart ? 'chart' : 'picture') : item.kind === 'table' ? 'table' : '';
  return `${item.id} | ${item.kind}${item.region ? `/${item.region}` : ''} | ${detail} |${String(item.label || '').replace(/\s+/g, ' ').slice(0, MAX_LABEL)}`;
}

// Short titles and subtitles for the big tiles. Small prompt, no page items: just a few snippets per tile.
const clipText = (value, n) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// What the Apify agent learned about the site as a whole (short, plain and untrusted: used only as context).
function siteLine(request) {
  const s = request?.site;
  if (!s || typeof s !== 'object') return '';
  const list = (v, n, each) => (Array.isArray(v) ? v.slice(0, n).map((x) => clipText(x, each)).filter(Boolean).join(', ') : '');
  const parts = [clipText(s.description, 200) && `about: ${clipText(s.description, 200)}`, list(s.menu, 12, 40) && `menu: ${list(s.menu, 12, 40)}`, list(s.pages, 8, 50) && `other pages: ${list(s.pages, 8, 50)}`].filter(Boolean);
  return parts.length ? `Site (untrusted context): ${parts.join(' | ')}\n` : '';
}

export async function tileTitles(request, client = new Anthropic()) {
  const tiles = (Array.isArray(request.tiles) ? request.tiles : []).slice(0, 40).map((t, index) => ({
    n: Number.isInteger(t?.n) ? t.n : index,
    heading: clipText(t?.heading, 80),
    counts: Object.fromEntries(['fields', 'buttons', 'links', 'paragraphs', 'tables', 'pictures'].map((k) => [k, Math.max(0, Math.min(999, Number(t?.counts?.[k]) || 0))])),
    sample: (Array.isArray(t?.sample) ? t.sample : []).slice(0, 5).map((s) => clipText(s, 90)).filter(Boolean),
  }));
  if (!tiles.length) throw Object.assign(new Error('No tiles to name.'), { status: 400 });
  const known = new Set(tiles.map((t) => t.n));
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: tilePolicy,
    messages: [{
      role: 'user',
      content: `Page: ${clipText(request.title, 160)} (${clipText(request.host, 80)})\n${siteLine(request)}\nTiles:\n${tiles.map((t) => `${t.n} | heading: ${t.heading || '-'} | ${Object.entries(t.counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'} | ${t.sample.join(' / ')}`).join('\n')}`,
    }],
    output_config: { effort: 'low', format: zodOutputFormat(TileTitles) },
  });
  const out = response.parsed_output;
  if (response.stop_reason === 'refusal' || !out) throw Object.assign(new Error('Claude could not name the tiles.'), { status: 502 });
  const seen = new Set();
  return {
    tiles: out.tiles
      .filter((t) => known.has(t.n) && !seen.has(t.n) && seen.add(t.n) && clipText(t.title, 50))
      .map((t) => ({ n: t.n, title: clipText(t.title, 50), subtitle: clipText(t.subtitle, 90) })),
  };
}
export async function redesign(request, client = new Anthropic()) {
  if (request.tilesOnly === true) return tileTitles(request, client);
  const purpose = PURPOSES.includes(request.purpose) ? request.purpose : 'focus';
  const items = (request.items || []).slice(0, MAX_ITEMS);
  if (!items.length) throw Object.assign(new Error('Nothing on this page to work with.'), { status: 400 });
  const byId = new Map(items.map((i) => [i.id, i]));
  // Fields and buttons (submit, buy, ...) can never be hidden or folded away. Neither can charts, tables and code: they are content.
  const locked = (id) => {
    const item = byId.get(id);
    return item?.kind === 'field' || (item?.kind === 'action' && !item.link) || item?.kind === 'table' || item?.kind === 'code' || (item?.kind === 'image' && item.chart);
  };

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: policies[purpose],
    messages: [{
      role: 'user',
      content: `Page: ${String(request.title || '').slice(0, 160)} (${String(request.host || '').slice(0, 80)})\n`
        + siteLine(request)
        + (request.note ? `${String(request.note).slice(0, 200)}\n` : '')
        + `\nItems:\n${items.map(line).join('\n')}`,
    }],
    output_config: { effort: 'low', format: zodOutputFormat(Plan) },
  });

  const out = response.parsed_output;
  if (response.stop_reason === 'refusal' || !out) {
    throw Object.assign(new Error('Claude could not plan this page. Focus mode still works without AI.'), { status: 502 });
  }

  // Enforce the policy again: unknown ids, locked controls and duplicate use are dropped.
  const used = new Set();
  const take = (id) => byId.has(id) && !used.has(id) && used.add(id);
  // Main-content ranges: both ends must exist and be in page order. Items inside stay where they are.
  const order = items.map((i) => i.id);
  const main = out.main
    .filter((r) => byId.has(r.from) && byId.has(r.to) && order.indexOf(r.from) <= order.indexOf(r.to))
    .slice(0, 3);
  const hide = out.hide.filter((h) => !locked(h.id) && take(h.id)).slice(0, 60);
  const collapse = out.collapse
    .map((c) => ({ label: c.label.slice(0, 60), ids: c.ids.filter((id) => !locked(id) && take(id)) }))
    .filter((c) => c.ids.length).slice(0, 12);
  const chunks = out.chunks.filter((c) => byId.has(c.startId) && c.title.trim()).map((c) => ({ startId: c.startId, title: c.title.slice(0, 60) })).slice(0, 12);
  const gists = out.gists
    .filter((g) => byId.get(g.id)?.kind === 'text' && (byId.get(g.id).words ?? 0) >= 80 && g.text.trim())
    .map((g) => ({ id: g.id, text: g.text.slice(0, 220) })).slice(0, 8);
  // What each stretch of the page is for. The renderer owns the look; this only picks among its fixed designs.
  const ROLES = new Set(['hero', 'article', 'cards', 'gallery', 'steps', 'data', 'callout', 'cta']);
  const layout = (out.layout || []).filter((l) => byId.has(l.startId) && ROLES.has(l.role))
    .map((l) => ({ startId: l.startId, role: l.role, title: String(l.title || '').slice(0, 60) })).slice(0, 24);
  // Motor mode preserves all content/actions and page order, including legal notices.
  // The renderer owns input/scroll/keyboard behavior; Claude only supplies section headings and layout roles.
  if (purpose === 'motor') return { summary: out.summary.slice(0, 200), main: [], hide: [], collapse: [], chunks, gists: [], layout };
  return { summary: out.summary.slice(0, 200), main, hide, collapse, chunks, gists, layout };
}
