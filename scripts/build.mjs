import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentEditorBanner = '/* Usuzumi component page editor engines. Edit components/assets/editor-engines.entry.js, then run npm run build. */';
const componentEditorEntryPath = path.join(root, 'components/assets/editor-engines.entry.js');
const componentEditorPath = path.join(root, 'components/assets/editor-engines.js');

function bundleComponentEditorEngines() {
  if (!existsSync(componentEditorEntryPath)) {
    throw new Error('Missing components/assets/editor-engines.entry.js');
  }
  const result = buildSync({
    entryPoints: [componentEditorEntryPath],
    bundle: true,
    format: 'iife',
    globalName: 'UsuzumiComponentEditorEngines',
    minify: true,
    legalComments: 'none',
    target: 'es2020',
    write: false
  });
  const output = result.outputFiles[0].text.trim();
  return `${componentEditorBanner}\n${output}\n`;
}

const bundledEditorEngines = bundleComponentEditorEngines();

if (process.argv.includes('--check')) {
  if (readFileSync(componentEditorPath, 'utf8') !== bundledEditorEngines) {
    console.error('components/assets/editor-engines.js out of date. Run npm run build.');
    process.exit(1);
  }
  console.log('Site generated assets are in sync.');
  process.exit(0);
}

writeFileSync(componentEditorPath, bundledEditorEngines, 'utf8');
console.log('Built components/assets/editor-engines.js');
