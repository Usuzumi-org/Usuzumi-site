import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.tmp']);
const generatedBundles = new Set([
  'code-editor.js',
  'code-highlight.js',
  'editor-loader.js',
  'markdown-editor.js',
  'rich-editor.js'
]);
const ignoredFiles = new Set(generatedBundles);
const textExtensions = new Set(['.css', '.html', '.js', '.md', '.json']);
const issues = [];
const editorEngineLeakPattern = /\bEditorView\b|ProseMirror|@tiptap|MarkdownIt|markdown-it|\btiptap\b|shiki|createHighlighterCore|@codemirror/i;

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

function checkPublicHtmlClasses(filePath, text) {
  const allowedClass = /^(?:uzu-|is-|language-|cm-|ProseMirror\b)/;
  for (const match of text.matchAll(/\bclass=["']([^"']+)["']/gi)) {
    for (const className of match[1].split(/\s+/).filter(Boolean)) {
      if (!allowedClass.test(className)) {
        report(filePath, `HTML class should come from public Usuzumi UI or an embedded editor engine: ${className}`);
      }
    }
  }
}

function collectHtmlClasses(filePath) {
  const text = readText(filePath);
  const classes = new Set();
  for (const match of text.matchAll(/\bclass=["']([^"']+)["']/gi)) {
    for (const className of match[1].split(/\s+/).filter(Boolean)) {
      classes.add(className);
    }
  }
  return classes;
}

function cssContainsClass(cssText, className) {
  return new RegExp(`\\.${escapeRegExp(className)}(?:[^_a-zA-Z0-9-]|$)`).test(cssText);
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
  if (/(?:\.|^)uzu-(?:doc|guide)-/i.test(text)) {
    report(filePath, 'site code should not use legacy doc/guide private classes');
  }
  if (/components\/assets\/components\.css/i.test(text)) {
    report(filePath, 'site code should not reference the retired components.css file');
  }
  if (relative.endsWith('.html') && /components\/node_modules\/usuzumi/i.test(text)) {
    report(filePath, 'HTML should load Usuzumi from assets/vendor/usuzumi, not ignored node_modules');
  }
  if (/\.uzu-(?:home|project|app-preview|app-window|window-|mock|today|timeline|task|metric)\b/.test(text)) {
    report(filePath, 'site pages should rely on public Usuzumi classes instead of page-private shells');
  }
  if (relative.startsWith('components/assets/components-notes-') && /"(?:usage|purpose)"\s*:/.test(text)) {
    report(filePath, 'component notes should use structure, behavior, and tutorialSections instead of usage/purpose fields');
  }
  if (relative === 'components.html') {
    if (text.includes('components/assets/editor-engines.js')) report(filePath, 'component page should load split editor bundles through editor-loader.js');
    if (!text.includes('components/assets/editor-loader.js')) report(filePath, 'component page should load the local editor loader bundle');
    if (!text.includes('components/assets/code-highlight.js')) report(filePath, 'component page should load the local syntax highlighting bundle');
    if (/Tiptap mount|markdown-it preview mount|CodeMirror 6 mount/.test(text)) {
      report(filePath, 'component page editor demos should mount real editors instead of placeholder mount copy');
    }
  }
}

function checkVendorUsuzumiClassCoverage() {
  const cssPath = path.join(root, 'assets', 'vendor', 'usuzumi', 'ui', 'usuzumi.css');
  if (!existsSync(cssPath)) {
    report(cssPath, 'Usuzumi vendor CSS is missing; run npm install');
    return;
  }
  const cssText = readText(cssPath);
  const htmlFiles = walk(root).filter((filePath) => path.extname(filePath) === '.html');
  const ignoredPrefixes = ['cm-', 'is-', 'language-', 'ProseMirror'];
  const missing = new Set();

  for (const filePath of htmlFiles) {
    for (const className of collectHtmlClasses(filePath)) {
      if (ignoredPrefixes.some((prefix) => className.startsWith(prefix))) continue;
      if (!className.startsWith('uzu-')) continue;
      if (!cssContainsClass(cssText, className)) missing.add(className);
    }
  }

  for (const className of [...missing].sort()) {
    report(cssPath, `vendor Usuzumi CSS does not define static HTML class: .${className}`);
  }
}

function checkGeneratedBundles() {
  const assetsDir = path.join(root, 'components', 'assets');
  const expectedBundles = [
    'code-editor.js',
    'code-highlight.js',
    'editor-loader.js',
    'markdown-editor.js',
    'rich-editor.js'
  ];
  for (const bundle of expectedBundles) {
    const filePath = path.join(assetsDir, bundle);
    if (!existsSync(filePath)) {
      report(filePath, 'generated bundle is missing; run npm run build');
    }
  }

  const retiredBundle = path.join(assetsDir, 'editor-engines.js');
  if (existsSync(retiredBundle)) {
    report(retiredBundle, 'retired combined editor bundle should be removed');
  }

  const highlightBundle = path.join(assetsDir, 'code-highlight.js');
  if (existsSync(highlightBundle) && editorEngineLeakPattern.test(readText(highlightBundle))) {
    report(highlightBundle, 'code highlighting bundle should not include editor engines or Shiki');
  }

  const loaderBundle = path.join(assetsDir, 'editor-loader.js');
  if (existsSync(loaderBundle) && editorEngineLeakPattern.test(readText(loaderBundle))) {
    report(loaderBundle, 'editor loader should stay small and not bundle editor engines');
  }

  const richBundle = path.join(assetsDir, 'rich-editor.js');
  if (existsSync(richBundle) && /MarkdownIt|markdown-it|@codemirror|\bcodemirror\b/.test(readText(richBundle))) {
    report(richBundle, 'rich editor bundle should only include Tiptap-related dependencies');
  }

  const markdownBundle = path.join(assetsDir, 'markdown-editor.js');
  if (existsSync(markdownBundle) && /ProseMirror|@tiptap|\btiptap\b|@codemirror|\bcodemirror\b|\bEditorView\b/.test(readText(markdownBundle))) {
    report(markdownBundle, 'markdown editor bundle should only include markdown-it');
  }

  const codeBundle = path.join(assetsDir, 'code-editor.js');
  if (existsSync(codeBundle) && /@tiptap|MarkdownIt|markdown-it/i.test(readText(codeBundle))) {
    report(codeBundle, 'code editor bundle should not include Tiptap or markdown-it');
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
  const panels = [...text.matchAll(/<section class="uzu-reference-panel" id="component-([^"]+)"[\s\S]*?(?=<section class="uzu-reference-panel"|<footer class="uzu-footer")/g)];
  const panelSet = new Set(panels.map((match) => match[1]));
  if (panelSet.size < 60) report(filePath, `component page exposes too few component panels: ${panelSet.size}`);
  for (const [panelText, id] of panels) {
    const note = docs.componentNotes?.[id];
    const details = docs.componentInterfaces?.[id];
    if (!note) report(filePath, `component panel is missing notes data: ${id}`);
    if (!details || !hasAnyInterface(details)) report(filePath, `component panel is missing interface data: ${id}`);
    if (note && !hasList(note.classes)) report(filePath, `component notes are missing public classes: ${id}`);
    if (!/(uzu-reference-example|uzu-callout|uzu-popover|uzu-type-list|uzu-reference-demo)/.test(panelText)) {
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
  if (extension === '.html') {
    checkHtmlReferences(filePath, text);
    checkPublicHtmlClasses(filePath, text);
  }
  if (extension === '.css') checkCssReferences(filePath, text);
}
checkComponentDocsCompleteness();
checkGeneratedBundles();
checkVendorUsuzumiClassCoverage();

if (issues.length) {
  console.error(`Validation failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Site validation passed.');
