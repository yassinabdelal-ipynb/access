// Design tokens: the generated CSS matches design/tokens.json, and every pair of colours that is used together
// is readable (WCAG 2.2 contrast: 4.5:1 for text, 3:1 for focus rings and borders that carry meaning).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyExport } from '../scripts/sync-from-figma.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts/build-tokens.mjs'), '--check'], { stdio: 'pipe' });

const tokens = JSON.parse(readFileSync(path.join(root, 'design/tokens.json'), 'utf8').replace(/^\uFEFF/, ''));
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const pairs = [
  ['text', 'bg', 4.5], ['text', 'panel', 4.5], ['muted', 'bg', 4.5], ['muted', 'panel', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'panel', 4.5], ['accentInk', 'accent', 4.5],
  ['danger', 'panel', 4.5], ['danger', 'bg', 4.5], ['ok', 'panel', 4.5],
  ['focus', 'bg', 3], ['focus', 'panel', 3], ['line', 'bg', 1.1],
];
const rows = [];
for (const mode of ['light', 'dark']) {
  for (const [fg, bg, min] of pairs) {
    const value = ratio(tokens.color[mode][fg], tokens.color[mode][bg]);
    rows.push(`${mode} ${fg} on ${bg}: ${value.toFixed(2)}`);
    assert.ok(value >= min, `${mode}: ${fg} on ${bg} is ${value.toFixed(2)}, needs ${min}`);
  }
}
assert.deepEqual(Object.keys(tokens.color.light).sort(), Object.keys(tokens.color.dark).sort(), 'light and dark define the same tokens');
assert.match(tokens.source.figmaFileKey, /^[0-9a-zA-Z]{22,}$/, 'tokens name the Figma file they sync with');
// What Figma holds (read back through the Figma MCP) is exactly what the code uses, and bad Figma data is refused.
const exported = JSON.parse(readFileSync(path.join(root, 'design/figma-export.json'), 'utf8').replace(/^\uFEFF/, ''));
const synced = applyExport(tokens, exported, { now: new Date(0) });
assert.deepEqual(synced.color, tokens.color, 'the Figma colours equal tokens.json');
assert.deepEqual(synced.radius, tokens.radius, 'the Figma radii equal tokens.json');
const bad = (edit) => { const copy = JSON.parse(JSON.stringify(exported)); edit(copy); return () => applyExport(tokens, copy); };
assert.throws(bad((e) => { e.color.light.bg = 'red'; }), /not a #rrggbb/);
assert.throws(bad((e) => { e.color.dark['sparkle'] = '#ffffff'; }), /Unknown colour/);
assert.throws(bad((e) => { delete e.color.dark.ok; }), /no dark value/);
assert.throws(bad((e) => { e.radius.sm = -4; }), /sensible/);
console.log(`Tokens passed: CSS generated from design/tokens.json is in sync, ${rows.length} colour pairs meet WCAG contrast, and the Figma export matches (bad Figma data is refused).`);
