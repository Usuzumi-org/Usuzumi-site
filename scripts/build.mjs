import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildSync } = require(path.join(root, 'components/node_modules/esbuild'));
const vendorAssets = [
  {
    name: 'Usuzumi UI library assets',
    sourcePath: path.join(root, 'components/node_modules/usuzumi/ui'),
    outputPath: path.join(root, 'assets/vendor/usuzumi/ui')
  }
];
const bundles = [
  {
    name: 'component page editor loader',
    banner: '/* Usuzumi component page editor loader. Edit components/assets/editor-loader.entry.js, then run npm run build. */',
    entryPath: path.join(root, 'components/assets/editor-loader.entry.js'),
    outputPath: path.join(root, 'components/assets/editor-loader.js'),
    globalName: 'UsuzumiComponentEditorLoader'
  },
  {
    name: 'component page rich text editor',
    banner: '/* Usuzumi component page rich text editor. Edit components/assets/rich-editor.entry.js, then run npm run build. */',
    entryPath: path.join(root, 'components/assets/rich-editor.entry.js'),
    outputPath: path.join(root, 'components/assets/rich-editor.js'),
    globalName: 'UsuzumiComponentRichEditor'
  },
  {
    name: 'component page markdown editor',
    banner: '/* Usuzumi component page markdown editor. Edit components/assets/markdown-editor.entry.js, then run npm run build. */',
    entryPath: path.join(root, 'components/assets/markdown-editor.entry.js'),
    outputPath: path.join(root, 'components/assets/markdown-editor.js'),
    globalName: 'UsuzumiComponentMarkdownEditor'
  },
  {
    name: 'component page code editor',
    banner: '/* Usuzumi component page code editor. Edit components/assets/code-editor.entry.js, then run npm run build. */',
    entryPath: path.join(root, 'components/assets/code-editor.entry.js'),
    outputPath: path.join(root, 'components/assets/code-editor.js'),
    globalName: 'UsuzumiComponentCodeEditor'
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

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return listFiles(fullPath).map((file) => path.join(entry, file));
    }
    return [entry];
  });
}

function assertVendorSource(asset) {
  if (!existsSync(asset.sourcePath)) {
    throw new Error(`Missing ${asset.name}. Run npm install before building the site.`);
  }
}

function vendorAssetHasDrift(asset) {
  assertVendorSource(asset);
  const sourceFiles = listFiles(asset.sourcePath).sort();
  const outputFiles = listFiles(asset.outputPath).sort();
  if (sourceFiles.length !== outputFiles.length) return true;
  for (let index = 0; index < sourceFiles.length; index += 1) {
    if (sourceFiles[index] !== outputFiles[index]) return true;
    const source = readFileSync(path.join(asset.sourcePath, sourceFiles[index]));
    const output = readFileSync(path.join(asset.outputPath, outputFiles[index]));
    if (!source.equals(output)) return true;
  }
  return false;
}

function syncVendorAsset(asset) {
  assertVendorSource(asset);
  rmSync(asset.outputPath, { recursive: true, force: true });
  mkdirSync(path.dirname(asset.outputPath), { recursive: true });
  cpSync(asset.sourcePath, asset.outputPath, { recursive: true });
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
  for (const asset of vendorAssets) {
    if (vendorAssetHasDrift(asset)) {
      console.error(`${toRelative(asset.outputPath)} out of date. Run npm run build.`);
      hasDrift = true;
    }
  }
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

for (const asset of vendorAssets) {
  syncVendorAsset(asset);
  console.log(`Synced ${toRelative(asset.outputPath)}`);
}

for (const asset of bundledAssets) {
  writeFileSync(asset.outputPath, asset.output, 'utf8');
  console.log(`Built ${toRelative(asset.outputPath)}`);
}
