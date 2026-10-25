// Applies a read of the Figma "Access Tokens" collection (design/figma-export.json) to design/tokens.json.
//   node scripts/sync-from-figma.mjs [export.json]    then: npm run tokens
// The export is what Claude reads with the Figma MCP (see design/FIGMA.md). Only #rrggbb colours and numbers are accepted.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensFile = path.join(root, 'design/tokens.json');
const read = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

export function applyExport(tokens, exported, { fileKey, now = new Date() } = {}) {
  const next = JSON.parse(JSON.stringify(tokens));
  const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const mode of ['light', 'dark']) {
    const source = exported?.color?.[mode];
    if (!source) throw new Error(`The export has no ${mode} colours.`);
    for (const [name, value] of Object.entries(source)) {
      const key = camel(name);
      if (!(key in next.color[mode])) throw new Error(`Unknown colour "${name}" in Figma. Add it to tokens.json and the generator first.`);
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`color/${name} (${mode}) is "${value}", not a #rrggbb colour.`);
      next.color[mode][key] = value.toLowerCase();
    }
    for (const key of Object.keys(next.color[mode])) if (!(Object.keys(source).map(camel)).includes(key)) throw new Error(`Figma has no ${mode} value for "${key}".`);
  }
  for (const [name, value] of Object.entries(exported.radius || {})) {
    if (!(name in next.radius)) throw new Error(`Unknown radius "${name}" in Figma.`);
    if (!Number.isFinite(value) || value < 0 || value > 999) throw new Error(`radius/${name} is not a sensible number.`);
    next.radius[name] = value;
  }
  if (fileKey) next.source.figmaFileKey = fileKey;
  next.source.syncedFromFigmaAt = now.toISOString();
  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'design/figma-export.json');
  const next = applyExport(read(tokensFile), read(file), { fileKey: process.env.FIGMA_FILE_KEY });
  writeFileSync(tokensFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log('design/tokens.json updated from Figma. Now run: npm run tokens');
}
