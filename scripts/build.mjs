import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localUsuzumiUi = path.resolve(root, '..', 'ui');
const installedUsuzumiUi = path.join(root, 'node_modules/usuzumi/ui');
const usuzumiUiSource = existsSync(path.join(localUsuzumiUi, 'usuzumi.css'))
  ? localUsuzumiUi
  : installedUsuzumiUi;
const vendorAssets = [
  {
    name: 'Usuzumi UI library assets',
    sourcePath: usuzumiUiSource,
    outputPath: path.join(root, 'assets/vendor/usuzumi/ui')
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
    throw new Error(
      `Missing ${asset.name}. Keep the sibling ../ui library available for local development, or run npm install to use the package dependency.`
    );
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

if (process.argv.includes('--check')) {
  let hasDrift = false;
  for (const asset of vendorAssets) {
    if (vendorAssetHasDrift(asset)) {
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
