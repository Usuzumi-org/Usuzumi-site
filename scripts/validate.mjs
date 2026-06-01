import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.tmp']);
const ignoredFiles = new Set(['editor-engines.js', 'code-highlight.js']);
const textExtensions = new Set(['.css', '.html', '.js', '.md', '.json']);
const issues = [];

function toPosix(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return ignoredDirs.has(entry) ? [] : walk(fullPath);
    return [fullPath];
  });
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function report(filePath, message) {
  issues.push(`${toPosix(filePath)}: ${message}`);
}

function isExternalReference(value) {
  return /^(https?:|mailto:|tel:|data:)/i.test(value);
}

function splitReference(value) {
  const noQuery = value.trim().split('?')[0];
  const hashIndex = noQuery.indexOf('#');
  return {
    pathPart: hashIndex >= 0 ? noQuery.slice(0, hashIndex) : noQuery,
    hash: hashIndex >= 0 ? noQuery.slice(hashIndex + 1) : ''
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasHtmlHashTarget(filePath, hash) {
  if (!hash || hash.startsWith(':~:text=')) return true;
  const pattern = new RegExp(`\\b(?:id|name)=["']${escapeRegExp(decodeURIComponent(hash))}["']`, 'i');
  return pattern.test(readText(filePath));
}

function checkExistingReference(filePath, rawValue, label) {
  if (!rawValue || isExternalReference(rawValue)) return;
  const { pathPart, hash } = splitReference(rawValue);
  if (pathPart.startsWith('{') || pathPart.startsWith('var(') || pathPart.includes('${')) return;
  if (!pathPart && !hash) return;
  const resolved = pathPart ? path.resolve(path.dirname(filePath), pathPart) : filePath;
  if (!existsSync(resolved)) {
    report(filePath, `${label} reference does not exist: ${rawValue}`);
    return;
  }
  if (hash && path.extname(resolved).toLowerCase() === '.html' && !hasHtmlHashTarget(resolved, hash)) {
    report(filePath, `${label} hash target does not exist: ${rawValue}`);
  }
}

function checkHtmlReferences(filePath, text) {
  for (const match of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    checkExistingReference(filePath, match[1], 'HTML');
  }
}

function checkCssReferences(filePath, text) {
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    checkExistingReference(filePath, match[1], 'CSS');
  }
}

function checkGuardrails(filePath, text) {
  const relative = toPosix(filePath);
  if (/href=["']#["']/i.test(text)) report(filePath, 'placeholder href="#" is not allowed');
  if (/(?:href|src)\s*=\s*["']\s*javascript:/i.test(text)) report(filePath, 'javascript: URL is not allowed');
  if (/font-size\s*:[^;]*vw/i.test(text)) report(filePath, 'viewport-width font sizing is not allowed');
  if (/letter-spacing\s*:\s*-/i.test(text)) report(filePath, 'negative letter-spacing is not allowed');
  if (/--uzu-(?:text|text-muted|accent)\b/.test(text)) {
    report(filePath, 'site code should use public Usuzumi tokens such as --uzu-fg, --uzu-muted, and --uzu-fg-strong');
  }
  if (/uzu-shiki|shiki-pre|shiki-code|--uzu-shiki/i.test(text)) {
    report(filePath, 'syntax highlighting must use native .uzu-code-block interfaces, not site-only shiki classes');
  }
  if (relative === 'components/assets/components.css' && /\.(?:uzu-editor-mount|uzu-editor-toolbar-rich|uzu-toolbar-link-[A-Za-z0-9_-]+)\b/.test(text)) {
    report(filePath, 'component page CSS should not redefine native editor shell classes');
  }
  if (relative.startsWith('components/assets/components-notes-') && /"(?:usage|purpose)"\s*:/.test(text)) {
    report(filePath, 'component notes should use structure, behavior, and tutorialSections instead of usage/purpose fields');
  }
  if (relative === 'components.html') {
    if (!text.includes('components/assets/editor-engines.js')) report(filePath, 'component page should load the local external editor engine bundle');
    if (!text.includes('components/assets/code-highlight.js')) report(filePath, 'component page should load the local syntax highlighting bundle');
    if (/Tiptap mount|markdown-it preview mount|CodeMirror 6 mount/.test(text)) {
      report(filePath, 'component page editor demos should mount real editors instead of placeholder mount copy');
    }
  }
}

function loadComponentDocsData() {
  const assetsDir = path.join(root, 'components', 'assets');
  const docs = {};
  const context = { window: { UsuzumiComponentDocs: docs } };
  vm.createContext(context);
  const files = readdirSync(assetsDir).filter((entry) => /^components-(?:notes|interfaces)-.*\.js$/.test(entry)).sort();
  for (const file of files) {
    vm.runInContext(readText(path.join(assetsDir, file)), context, { filename: file });
  }
  return context.window.UsuzumiComponentDocs;
}

function hasList(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasAnyInterface(details = {}) {
  return Object.values(details).some(hasList);
}

function checkComponentDocsCompleteness() {
  const filePath = path.join(root, 'components.html');
  const text = readText(filePath);
  const docs = loadComponentDocsData();
  const panels = [...text.matchAll(/<section class="uzu-doc-panel" id="component-([^"]+)"[\s\S]*?(?=<section class="uzu-doc-panel"|<footer class="uzu-footer")/g)];
  const panelSet = new Set(panels.map((match) => match[1]));
  if (panelSet.size < 60) report(filePath, `component page exposes too few component panels: ${panelSet.size}`);
  for (const [panelText, id] of panels) {
    const note = docs.componentNotes?.[id];
    const details = docs.componentInterfaces?.[id];
    if (!note) report(filePath, `component panel is missing notes data: ${id}`);
    if (!details || !hasAnyInterface(details)) report(filePath, `component panel is missing interface data: ${id}`);
    if (note && !hasList(note.classes)) report(filePath, `component notes are missing public classes: ${id}`);
    if (!/(uzu-doc-example|uzu-callout|uzu-popover|uzu-type-list)/.test(panelText)) {
      report(filePath, `component panel is missing a preview example: ${id}`);
    }
  }
  for (const key of Object.keys(docs.componentNotes || {})) {
    if (!panelSet.has(key)) report(path.join(root, 'components', 'assets'), `component notes have no matching panel: ${key}`);
  }
  for (const key of Object.keys(docs.componentInterfaces || {})) {
    if (!panelSet.has(key)) report(path.join(root, 'components', 'assets'), `component interface has no matching panel: ${key}`);
  }
}

for (const filePath of walk(root)) {
  if (ignoredFiles.has(path.basename(filePath))) continue;
  const extension = path.extname(filePath);
  if (!textExtensions.has(extension)) continue;
  const text = readText(filePath);
  checkGuardrails(filePath, text);
  if (extension === '.html') checkHtmlReferences(filePath, text);
  if (extension === '.css') checkCssReferences(filePath, text);
}
checkComponentDocsCompleteness();

if (issues.length) {
  console.error(`Validation failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Site validation passed.');
