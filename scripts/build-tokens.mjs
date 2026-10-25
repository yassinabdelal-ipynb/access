// Generates the colour variables in the CSS files from design/tokens.json.
//   node scripts/build-tokens.mjs           write the generated blocks
//   node scripts/build-tokens.mjs --check   fail if any file differs from what tokens.json produces
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(path.join(root, 'design/tokens.json'), 'utf8'));
const HEX = /^#[0-9a-f]{6}$/i;
for (const mode of ['light', 'dark']) {
  for (const [name, value] of Object.entries(tokens.color[mode] || {})) {
    if (!HEX.test(value)) throw new Error(`tokens.json: color.${mode}.${name} must be a #rrggbb colour, got "${value}"`);
  }
}
const NAMES = { bg: 'bg', panel: 'panel', line: 'line', text: 'text', muted: 'muted', accent: 'accent', 'accent-2': 'accent', 'accent-ink': 'accentInk', focus: 'focus', danger: 'danger', ok: 'ok' };
const vars = (mode, names, indent = '  ') => names.map((css) => `${indent}--${css}: ${tokens.color[mode][NAMES[css]]};`).join('\n');

const targets = [
  {
    file: 'extension/access.css',
    build: () => {
      const all = ['bg', 'panel', 'line', 'text', 'muted', 'accent', 'accent-2', 'accent-ink', 'focus', 'danger', 'ok'];
      return `.access {\n${vars('light', all)}\n}\n.access[data-resolved="dark"] {\n${vars('dark', all)}\n}`;
    },
  },
  {
    file: 'extension/popup.css',
    build: () => {
      const names = ['bg', 'panel', 'line', 'text', 'muted', 'danger', 'focus'];
      return `:root {\n  color-scheme: light dark;\n${vars('light', names)}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${vars('dark', names, '    ')}\n  }\n}`;
    },
  },
  {
    file: 'app/style.css',
    build: () => {
      const names = ['bg', 'panel', 'line', 'text', 'muted', 'accent', 'focus'];
      return `:root {\n  color-scheme: light;\n${vars('light', names)}\n}\n:root[data-theme="dark"] {\n  color-scheme: dark;\n${vars('dark', names)}\n}\n@media (prefers-color-scheme: dark) {\n  :root[data-theme="auto"] {\n    color-scheme: dark;\n${vars('dark', names, '    ')}\n  }\n}`;
    },
  },
];

const BEGIN = '/* tokens:begin (generated from design/tokens.json by scripts/build-tokens.mjs; do not edit by hand) */';
const END = '/* tokens:end */';
const check = process.argv.includes('--check');
let drift = 0;
for (const target of targets) {
  const file = path.join(root, target.file);
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const a = text.indexOf('/* tokens:begin');
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${target.file}: tokens:begin / tokens:end markers are missing`);
  const next = `${text.slice(0, a)}${BEGIN}\n${target.build()}\n${text.slice(b)}`;
  if (next !== text) {
    drift++;
    if (!check) writeFileSync(file, next, 'utf8');
  }
}
if (check && drift) { console.error(`${drift} generated CSS block(s) differ from design/tokens.json. Run: npm run tokens`); process.exit(1); }
console.log(check ? 'Tokens in sync: CSS matches design/tokens.json.' : `Tokens written to ${targets.length} files (${drift} changed).`);
