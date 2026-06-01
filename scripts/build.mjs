import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundles = [
  {
    name: 'component page editor engines',
    banner: '/* Usuzumi component page editor engines. Edit components/assets/editor-engines.entry.js, then run npm run build. */',
    entryPath: path.join(root, 'components/assets/editor-engines.entry.js'),
    outputPath: path.join(root, 'components/assets/editor-engines.js'),
    globalName: 'UsuzumiComponentEditorEngines'
  },
  {
    name: 'component page code highlighting',
    banner: '/* Usuzumi component page code highlighting. Edit components/assets/code-highlight.entry.js, then run npm run build. */',
    entryPath: path.join(root, 'components/assets/code-highlight.entry.js'),
    outputPath: path.join(root, 'components/assets/code-highlight.js'),
    globalName: 'UsuzumiComponentCodeHighlight'
  }
];

function toRelative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function bundleAsset(bundle) {
  if (!existsSync(bundle.entryPath)) {
    throw new Error(`Missing ${toRelative(bundle.entryPath)}`);
  }
  const result = buildSync({
    entryPoints: [bundle.entryPath],
    bundle: true,
    format: 'iife',
    globalName: bundle.globalName,
    minify: true,
    legalComments: 'none',
    target: 'es2020',
    write: false
  });
  const output = result.outputFiles[0].text.trim();
  return `${bundle.banner}\n${output}\n`;
}

const bundledAssets = bundles.map((bundle) => ({
  ...bundle,
  output: bundleAsset(bundle)
}));

if (process.argv.includes('--check')) {
  let hasDrift = false;
  for (const asset of bundledAssets) {
    if (readFileSync(asset.outputPath, 'utf8') !== asset.output) {
      console.error(`${toRelative(asset.outputPath)} out of date. Run npm run build.`);
      hasDrift = true;
    }
  }
  if (hasDrift) process.exit(1);
  console.log('Site generated assets are in sync.');
  process.exit(0);
}

for (const asset of bundledAssets) {
  writeFileSync(asset.outputPath, asset.output, 'utf8');
  console.log(`Built ${toRelative(asset.outputPath)}`);
}
