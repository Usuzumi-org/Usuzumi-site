import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.tmp']);
const ignoredFiles = new Set();
const textExtensions = new Set(['.css', '.html', '.js', '.md', '.json']);
const issues = [];
const privateHighlighterPattern = new RegExp([
  '@' + 'lezer',
  'components/assets/' + 'code-highlight\\.js',
  'components/runtime/' + 'highlight-deps\\.js',
  'UsuzumiComponent' + 'CodeHighlight'
].join('|'), 'i');
const retiredSiteRuntimeFiles = [
  'components/assets/components-labels.js',
  'components/assets/components-doc-utils.js',
  'components/assets/components-tutorial.js',
  'components/assets/components-interface-descriptions.js',
  'components/assets/components-interface-examples.js',
  'components/assets/components-interface.js',
  'components/assets/components-demo.js',
  'components/assets/components.js',
  'components/assets/editor-loader.entry.js',
  'components/assets/editor-loader.js',
  'components/assets/markdown-editor.entry.js',
  'components/assets/markdown-editor.js',
  'components/runtime/markdown-editor-deps.js',
  'components/runtime/package.json',
  'components/package.json',
  'components/package-lock.json'
];
const retiredSiteRuntimePattern = new RegExp(retiredSiteRuntimeFiles.map((file) => escapeRegExp(file)).join('|'), 'i');
const retiredComponentPagePattern = /data-uzu-component(?:-docs|-nav)?|components\/assets\/components-(?:notes|interfaces)-[^"']+\.js|uzu-reference|uzu-token|uzu-type|uzu-download-actions|uzu-app-hero|uzu-product|uzu-screen|uzu-feature|initComponentDocs|component-docs/i;
const componentDocsQualityPatterns = [
  [/Start with/i, 'generated template copy should be replaced with concrete component guidance'],
  [/compose the public child structure/i, 'generated template copy should be replaced with concrete component guidance'],
  [/This component is mainly HTML and CSS/i, 'generated filler copy should be replaced with concrete component guidance'],
  [/public Usuzumi runtime initializes/i, 'docs should not claim a runtime initializes static-only components'],
  [/local wrapper/i, 'docs should not describe site-local wrappers as component API'],
  [/aria-current=&quot;(?:page|step)&quot;=&quot;true/i, 'docs contain an invalid aria-current example'],
  [/aria-busy on loading region/i, 'docs contain vague or invalid aria-busy guidance'],
  [/horizontal scroll in \.uzu-table-wrap/i, 'docs should avoid placeholder table-wrapper copy'],
  [/visible near its trigger/i, 'docs should avoid placeholder positioning copy'],
  [/data-uzu-dialog-target&gt;/i, 'docs contain an incomplete dialog trigger attribute'],
  [/\[aria-disabled=&quot;true&quot;\]/i, 'docs contain a selector fragment instead of a concrete disabled example'],
  [/\[aria-busy=&quot;true&quot;\]/i, 'docs contain a selector fragment instead of a concrete busy example'],
  [/aria-valuenow=&quot;true/i, 'docs contain an invalid aria-valuenow example'],
  [/aria-orientation=&quot;true/i, 'docs contain an invalid aria-orientation example']
];
const componentPanelDocsQualityPatterns = [
  [/Base Interface/i, 'cleaned component panels should use concrete API categories instead of Base Interface'],
  [/Data \/ ARIA/i, 'cleaned component panels should use concrete API categories instead of Data / ARIA'],
  [/Wrapper entry that defines layout and state scope\./i, 'cleaned component panels should not use generic wrapper copy'],
  [/Child structure for content, supporting copy, or actions\./i, 'cleaned component panels should not use generic child-structure copy'],
  [/Enables or configures the public Usuzumi runtime\./i, 'cleaned component panels should describe the concrete runtime behavior'],
  [/Listen to connect component changes to application state\./i, 'cleaned component panels should describe the concrete event payload or timing'],
  [/Expresses current state for styles, tests, and application code\./i, 'cleaned component panels should describe the concrete state contract'],
  [/aria-sort=&quot;true/i, 'data grid docs should use valid aria-sort values']
];
const maxInterfaceExampleLength = 170;
const maxComponentInterfaceRows = 18;
const retiredEditorCopyPattern = new RegExp([
  'T' + 'iptap mount',
  'Code' + 'Mirror 6 mount',
  '\\bdata-uzu-' + 'r' + 'ich-editor\\b',
  'R' + 'ich text',
  '富' + '文本'
].join('|'), 'i');
const ignoredClassPrefixes = ['is-', 'language-'];
const scrollbarSurfaces = [
  'html.uzu-root',
  'body.uzu-app',
  '.uzu-scroll',
  '.uzu-scroll-area',
  '.uzu-command-list',
  '.uzu-combobox-list',
  '.uzu-table-wrap',
  '.uzu-data-grid-wrap',
  '.uzu-json-viewer',
  '.uzu-diff-viewer',
  '.uzu-code-editor',
  '.uzu-plain-editor',
  '.uzu-markdown-source',
  '.uzu-markdown-preview',
  '.uzu-editor-surface'
];
const scrollbarButtonStates = [
  '',
  ':single-button',
  ':double-button',
  ':start:decrement',
  ':start:increment',
  ':end:decrement',
  ':end:increment',
  ':vertical:decrement',
  ':vertical:increment',
  ':vertical:start:decrement',
  ':vertical:start:increment',
  ':vertical:end:decrement',
  ':vertical:end:increment',
  ':horizontal:decrement',
  ':horizontal:increment',
  ':horizontal:start:decrement',
  ':horizontal:start:increment',
  ':horizontal:end:decrement',
  ':horizontal:end:increment'
];

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

function decodeHtmlEntities(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#10;', '\n')
    .replaceAll('&amp;', '&');
}

function stripInlineCode(value) {
  return value.replace(/<code class="uzu-code">[\s\S]*?<\/code>/g, '');
}

function stripHtmlTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function parseLanguageValues(value) {
  return String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function getComponentInterfaceTable(panelText) {
  const tables = [...panelText.matchAll(/<div class="uzu-table-wrap">\s*<table class="uzu-table">([\s\S]*?)<\/table>\s*<\/div>/g)];
  return tables.at(-1)?.[1] || '';
}

function hasComponentCatalogNotes(panelText) {
  return /<div class="uzu-card uzu-stack uzu-gap-4">\s*<div class="uzu-title-pair">\s*<h3><span data-lang="zh">(?:组件文档|接口)<\/span><span data-lang="en" data-uzu-language-hidden>(?:Component Docs|Interface)<\/span><\/h3>/i.test(panelText);
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

function checkInitialLanguageVisibility(filePath, text) {
  const htmlTag = text.match(/<html\b[^>]*>/i)?.[0] || '';
  const initialLanguage = htmlTag.match(/\bdata-language=["']([^"']+)["']/i)?.[1]
    || htmlTag.match(/\bdata-uzu-lang=["']([^"']+)["']/i)?.[1]
    || '';
  if (!initialLanguage) return;
  for (const match of text.matchAll(/<[^>]*\bdata-lang=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    const values = parseLanguageValues(match[1]);
    const hidden = /\bdata-uzu-language-hidden\b/i.test(tag);
    if (values.length > 0 && values.includes(initialLanguage) && hidden) {
      report(filePath, `initial ${initialLanguage} language fragment should not be statically hidden: ${tag.slice(0, 120)}`);
    }
    if (values.length > 0 && !values.includes(initialLanguage) && !hidden) {
      report(filePath, `non-initial language fragment needs data-uzu-language-hidden to avoid first-paint language flash: ${tag.slice(0, 120)}`);
    }
  }
}

function checkCssReferences(filePath, text) {
  for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    checkExistingReference(filePath, match[1], 'CSS');
  }
}

function checkPublicHtmlClasses(filePath, text) {
  const allowedClass = /^(?:uzu-|is-|language-)/;
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

function cssContainsSurfacePseudo(cssText, surface, pseudo) {
  if (cssText.includes(`${surface}${pseudo}`)) return true;
  if (!surface.startsWith('.')) return false;
  const className = surface.slice(1);
  return new RegExp(`:where\\([^)]*\\.${escapeRegExp(className)}(?:[^_a-zA-Z0-9-]|[^)]*)\\)${escapeRegExp(pseudo)}`).test(cssText);
}

function getFirstRuleBody(cssText, selectorPart) {
  const match = cssText.match(new RegExp(`${escapeRegExp(selectorPart)}[\\s\\S]*?\\{([\\s\\S]*?)\\}`));
  return match ? match[1] : '';
}

function vendorCssText() {
  const cssPath = path.join(root, 'assets', 'vendor', 'usuzumi', 'ui', 'usuzumi.css');
  return existsSync(cssPath) ? readText(cssPath) : '';
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
  if (path.basename(filePath) !== 'validate.mjs' && privateHighlighterPattern.test(text)) {
    report(filePath, 'syntax highlighting must come from the Usuzumi UI package, not a site-only highlighter bundle');
  }
  if (/(?:\.|^)uzu-(?:doc|guide)-/i.test(text)) {
    report(filePath, 'site code should not use legacy doc/guide private classes');
  }
  if (/components\/assets\/components\.css/i.test(text)) {
    report(filePath, 'site code should not reference the retired components.css file');
  }
  const retiredLanguageTogglePattern = new RegExp('data-uzu-language-' + 'toggle|uzu-language-' + 'toggle', 'i');
  if (retiredLanguageTogglePattern.test(text)) {
    report(filePath, 'site code should use the public language selector, not the retired language toggle');
  }
  if (relative.endsWith('.html') && /components\/node_modules\/usuzumi/i.test(text)) {
    report(filePath, 'HTML should load Usuzumi from assets/vendor/usuzumi, not ignored node_modules');
  }
  if (/\.uzu-(?:home|project|app-preview|app-window|window-|mock|today|timeline|task|metric|reference|token|type|app-hero|product|screen|feature|download-actions)\b/.test(text)) {
    report(filePath, 'site pages should rely on public Usuzumi classes instead of page-private shells');
  }
  if (!relative.startsWith('assets/vendor/') && /\.(?:html|css)$/.test(relative) && /::-webkit-scrollbar|\bscrollbar-(?:button|width|color)\b/i.test(text)) {
    report(filePath, 'site pages must not define local scrollbar styles; consume the public Usuzumi scrollbar contract');
  }
  if (['index.html', 'components.html', 'editor-integration.html'].includes(relative)) {
    const topbarMatch = text.match(/<header class="uzu-topbar"[\s\S]*?<\/header>/);
    if (/class="uzu-floating-controls"/.test(text)) {
      report(filePath, 'site page settings should live inside the public .uzu-topbar-actions slot instead of fixed floating controls');
    }
    if (!topbarMatch || !topbarMatch[0].includes('class="uzu-topbar-actions"')) {
      report(filePath, 'site topbar should expose page settings through the public .uzu-topbar-actions slot');
    }
    if (/class="uzu-flex uzu-gap-2"\s+aria-label="Page settings"/.test(text)) {
      report(filePath, 'site page settings should use .uzu-topbar-actions, not a generic flex row');
    }
    if (/components\.html#component-layout-primitives/i.test(topbarMatch?.[0] || '')) {
      report(filePath, 'site topbar should link to Components directly instead of a duplicate Docs entry');
    }
  }
  if (relative === 'components.html') {
    if (/\?{3,}/.test(text)) report(filePath, 'component page should not contain mojibake placeholder question marks');
    if (retiredComponentPagePattern.test(text)) report(filePath, 'component page should be static consumer markup and must not load component-docs hooks, data files, or page-only classes');
    if (retiredSiteRuntimePattern.test(text)) report(filePath, 'component page should not load site-owned UI runtime scripts');
    if (retiredEditorCopyPattern.test(text)) {
      report(filePath, 'component page should not include retired external editor copy');
    }
    for (const [pattern, message] of componentDocsQualityPatterns) {
      if (pattern.test(text)) report(filePath, message);
    }
  }
}

function checkVendorScrollbarContract() {
  const cssPath = path.join(root, 'assets', 'vendor', 'usuzumi', 'ui', 'usuzumi.css');
  if (!existsSync(cssPath)) return;
  const cssText = readText(cssPath);
  const buttonBody = getFirstRuleBody(cssText, '::-webkit-scrollbar-button');
  const thumbBody = getFirstRuleBody(cssText, '::-webkit-scrollbar-thumb');
  const thumbHoverBody = getFirstRuleBody(cssText, '::-webkit-scrollbar-thumb:hover');

  for (const surface of scrollbarSurfaces) {
    for (const pseudo of ['::-webkit-scrollbar', '::-webkit-scrollbar-track', '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-corner']) {
      if (!cssContainsSurfacePseudo(cssText, surface, pseudo)) {
        report(cssPath, `vendored Usuzumi scrollbar contract does not cover ${surface}${pseudo}`);
      }
    }
    for (const state of scrollbarButtonStates) {
      const pseudo = `::-webkit-scrollbar-button${state}`;
      if (!cssContainsSurfacePseudo(cssText, surface, pseudo)) {
        report(cssPath, `vendored Usuzumi scrollbar contract does not hide ${surface}${pseudo}`);
      }
    }
  }

  const requiredButtonDeclarations = [
    [/display\s*:\s*none\s*!important/i, 'display: none !important'],
    [/width\s*:\s*0(?:px)?\s*!important/i, 'width: 0 !important'],
    [/height\s*:\s*0(?:px)?\s*!important/i, 'height: 0 !important'],
    [/min-width\s*:\s*0(?:px)?\s*!important/i, 'min-width: 0 !important'],
    [/min-height\s*:\s*0(?:px)?\s*!important/i, 'min-height: 0 !important'],
    [/background-image\s*:\s*none\s*!important/i, 'background-image: none !important'],
    [/color\s*:\s*transparent\s*!important/i, 'color: transparent !important'],
    [/-webkit-appearance\s*:\s*none\s*!important/i, '-webkit-appearance: none !important'],
    [/(^|[;\s])appearance\s*:\s*none\s*!important/i, 'appearance: none !important']
  ];
  for (const [pattern, label] of requiredButtonDeclarations) {
    if (!pattern.test(buttonBody)) report(cssPath, `vendored Usuzumi scrollbar buttons must be fully hidden with ${label}`);
  }

  if (!/min-width\s*:\s*24px/i.test(thumbBody) || !/min-height\s*:\s*24px/i.test(thumbBody)) {
    report(cssPath, 'vendored Usuzumi scrollbar thumbs need a 24px minimum length so short thumbs do not read as triangular arrow buttons');
  }
  if (!/background\s*:\s*var\(--uzu-scrollbar-thumb-bg/i.test(thumbBody)) {
    report(cssPath, 'vendored Usuzumi scrollbar thumbs should use the visibility token for idle/focused local scroll surfaces');
  }
  if (!/background\s*:\s*var\(--uzu-scrollbar-thumb-hover-bg/i.test(thumbHoverBody)) {
    report(cssPath, 'vendored Usuzumi scrollbar thumb hover should use the hover visibility token');
  }
  if (!/--uzu-scrollbar-thumb-bg\s*:\s*transparent/i.test(cssText)) {
    report(cssPath, 'vendored Usuzumi local scroll surface thumbs should be hidden while idle');
  }
  if (!/--uzu-scrollbar-thumb-bg\s*:\s*var\(--uzu-border\)/i.test(cssText)) {
    report(cssPath, 'vendored Usuzumi local scroll surface thumbs should become visible on hover or focus');
  }
}

function checkVendorUsuzumiClassCoverage() {
  const cssPath = path.join(root, 'assets', 'vendor', 'usuzumi', 'ui', 'usuzumi.css');
  if (!existsSync(cssPath)) {
    report(cssPath, 'Usuzumi vendor CSS is missing; run npm run build to sync the sibling ../ui library or the installed package');
    return;
  }
  const cssText = vendorCssText();
  const htmlFiles = walk(root).filter((filePath) => path.extname(filePath) === '.html');
  const missing = new Set();

  for (const filePath of htmlFiles) {
    for (const className of collectHtmlClasses(filePath)) {
      if (ignoredClassPrefixes.some((prefix) => className.startsWith(prefix))) continue;
      if (!cssContainsClass(cssText, className)) missing.add(className);
    }
  }

  for (const className of [...missing].sort()) {
    report(cssPath, `vendor Usuzumi CSS does not define static HTML class: .${className}`);
  }
}

function checkSiteRuntimeBoundary() {
  for (const relative of retiredSiteRuntimeFiles) {
    const filePath = path.join(root, ...relative.split('/'));
    if (existsSync(filePath)) report(filePath, 'site-owned UI runtime should be removed; use the public Usuzumi UI runtime instead');
  }

  const assetsDir = path.join(root, 'components', 'assets');
  const retiredBundles = ['editor-engines.js', 'rich-editor.js', 'code-editor.js', 'code-highlight.js'];
  for (const bundle of retiredBundles) {
    const retiredBundle = path.join(assetsDir, bundle);
    if (existsSync(retiredBundle)) report(retiredBundle, 'retired editor bundle should be removed');
  }
}

function checkComponentPage() {
  const filePath = path.join(root, 'components.html');
  const text = readText(filePath);
  const panels = [...text.matchAll(/<section class="[^"]*\buzu-panel\b[^"]*" id="component-([^"]+)"[\s\S]*?(?=<section class="[^"]*\buzu-panel\b[^"]*" id="component-|<footer class="uzu-footer")/g)];
  const panelSet = new Set(panels.map((match) => match[1]));
  const navTargets = [...text.matchAll(/data-uzu-panel-target="#component-([^"]+)"/g)].map((match) => match[1]);
  const navTargetSet = new Set(navTargets);
  if (panelSet.size < 60) report(filePath, `component page exposes too few static component panels: ${panelSet.size}`);
  if (navTargetSet.size !== panelSet.size) report(filePath, `component nav targets ${navTargetSet.size} do not match component panels ${panelSet.size}`);
  const demoTabs = (text.match(/aria-label="Component demo view"/g) || []).length;
  const demoPreviewTargets = (text.match(/data-uzu-tab-target="#demo-[^"]+-preview"/g) || []).length;
  const demoCodeTargets = (text.match(/data-uzu-tab-target="#demo-[^"]+-code"/g) || []).length;
  const demoPreviewPanels = (text.match(/id="demo-[^"]+-preview"/g) || []).length;
  const demoCodePanels = (text.match(/id="demo-[^"]+-code"/g) || []).length;
  for (const [label, count] of [
    ['demo tab groups', demoTabs],
    ['demo preview tab targets', demoPreviewTargets],
    ['demo code tab targets', demoCodeTargets],
    ['demo preview panels', demoPreviewPanels],
    ['demo code panels', demoCodePanels]
  ]) {
    if (count !== panelSet.size) report(filePath, `component ${label} ${count} do not match component panels ${panelSet.size}`);
  }
  if (!text.includes('data-uzu-panel-nav')) report(filePath, 'component page should use the public panel navigation runtime');
  if (!text.includes('class="uzu-panel" id="component-colors"')) report(filePath, 'component page should expose an initial public .uzu-panel');
  const componentNav = text.match(/<nav class="uzu-panel-nav" aria-label="Component list"[\s\S]*?<\/nav>/)?.[0] || '';
  if (componentNav.includes('uzu-panel-nav-meta')) {
    report(filePath, 'component nav should not repeat item labels with .uzu-panel-nav-meta');
  }
  for (const [panelText, id] of panels) {
    for (const [pattern, message] of componentDocsQualityPatterns) {
      if (pattern.test(panelText)) report(filePath, `component panel ${id}: ${message}`);
    }
    for (const [pattern, message] of componentPanelDocsQualityPatterns) {
      if (pattern.test(panelText)) report(filePath, `component panel ${id}: ${message}`);
    }
    for (const paragraph of panelText.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
      const prose = stripHtmlTags(stripInlineCode(paragraph[1]));
      if (/(?:^|[\s\u3001\uff0c\uff1b\uff1a(])(?:\.uzu-[a-z0-9-]+|data-uzu-[a-z0-9-]+|aria-[a-z0-9-]+|role=|:root)\b/i.test(prose)) {
        report(filePath, `component panel ${id}: prose should wrap public interfaces in .uzu-code`);
      }
    }
    const componentInterfaceTable = getComponentInterfaceTable(panelText);
    const componentCodeBlocks = panelText.matchAll(/<pre class="uzu-code-block-body uzu-scroll"(?:\s[^>]*)?><code class="language-[^"]+">([\s\S]*?)<\/code><\/pre>/g);
    for (const codeBlock of componentCodeBlocks) {
      if (codeBlock[1].includes('...') || codeBlock[1].includes('&hellip;')) {
        report(filePath, `component panel ${id}: demo code should be copyable without ellipsis placeholders`);
      }
    }
    const interfaceCodeCells = componentInterfaceTable.matchAll(/<td><code class="uzu-code">([\s\S]*?)<\/code><\/td>/g);
    for (const codeCell of interfaceCodeCells) {
      if (codeCell[1].includes('...') || codeCell[1].includes('&hellip;')) {
        report(filePath, `component panel ${id}: interface examples should be concrete without ellipsis placeholders`);
      }
      const normalizedExample = decodeHtmlEntities(codeCell[1]).replace(/\s+/g, ' ').trim();
      if (normalizedExample.length > maxInterfaceExampleLength) {
        report(filePath, `component panel ${id}: interface example is too long for the API table (${normalizedExample.length} characters)`);
      }
    }
    if (id === 'topbar') {
      if (!panelText.includes('data-uzu-theme-toggle') || !panelText.includes('data-uzu-language-select')) {
        report(filePath, 'component panel topbar should include the public theme toggle and language selector controls');
      }
      for (const required of ['data-uzu-language-trigger', 'data-uzu-language-menu', 'data-uzu-language-option', 'data-uzu-language-value']) {
        if (!panelText.includes(required)) {
          report(filePath, `component panel topbar should document the public language selector interface: ${required}`);
        }
      }
      if (!panelText.includes('class="uzu-topbar-actions"') || !panelText.includes('&lt;div class=&quot;uzu-topbar-actions&quot;')) {
        report(filePath, 'component panel topbar should document and preview the public .uzu-topbar-actions slot');
      }
      if (/class="uzu-flex uzu-gap-2"\s+aria-label="(?:Example page settings|Page settings)"/.test(panelText)) {
        report(filePath, 'component panel topbar should not position page settings with a generic flex row');
      }
    }
    if (!panelText.includes('uzu-section-head')) report(filePath, `component panel is missing a public section head: ${id}`);
    if (!/<h2 class="uzu-section-title">/.test(panelText)) report(filePath, `component panel is missing a public section title: ${id}`);
    if (!/\buzu-(?:card|callout|popover|alert|dialog|drawer|sheet|hover-card|tooltip|editor|table|data-grid|tree|skeleton|progress|process|step-nav|toast|tag|empty-state|error-state)\b/.test(panelText)) {
      report(filePath, `component panel is missing a static public Usuzumi preview: ${id}`);
    }
    if (!/aria-label="Component demo view"/.test(panelText)) report(filePath, `component panel is missing public preview/code tabs: ${id}`);
    if (!/data-uzu-tab-target="#demo-[^"]+-preview"/.test(panelText)) report(filePath, `component panel is missing public preview tab target: ${id}`);
    if (!/data-uzu-tab-target="#demo-[^"]+-code"/.test(panelText)) report(filePath, `component panel is missing public code tab target: ${id}`);
    if (!/id="demo-[^"]+-preview"/.test(panelText)) report(filePath, `component panel is missing public preview panel: ${id}`);
    if (!/id="demo-[^"]+-code"/.test(panelText)) report(filePath, `component panel is missing public code panel: ${id}`);
    if (!hasComponentCatalogNotes(panelText)) report(filePath, `component catalog entry is missing a concrete notes heading: ${id}`);
    if (!/\buzu-callout\b/.test(panelText)) report(filePath, `component catalog entry is missing public guidance callouts: ${id}`);
    if (!componentInterfaceTable) report(filePath, `component catalog entry is missing a public interface table: ${id}`);
    else {
      const interfaceRowCount = (componentInterfaceTable.match(/<tr>/g) || []).length;
      if (interfaceRowCount > maxComponentInterfaceRows) {
        report(filePath, `component panel ${id}: interface table is too dense (${interfaceRowCount} rows)`);
      }
    }
    if (!/\buzu-code-block\b/.test(panelText)) report(filePath, `component catalog entry is missing a public code block: ${id}`);
    if (!/data-uzu-code-copy/.test(panelText)) report(filePath, `component catalog entry is missing the public code copy control: ${id}`);
  }
}

function checkPackageBoundary() {
  const filePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(readText(filePath));
  if (packageJson.dependencies?.usuzumi !== '1.2.0') {
    report(filePath, 'site package should directly depend on usuzumi@1.2.0');
  }
  if (packageJson.scripts?.bootstrap || packageJson.scripts?.postinstall) {
    report(filePath, 'site package should not bootstrap a nested components install');
  }
}

function checkVendorBoundary() {
  const vendorDir = path.join(root, 'assets', 'vendor', 'usuzumi', 'ui');
  if (!existsSync(vendorDir)) return;
  for (const filePath of walk(vendorDir)) {
    if (!textExtensions.has(path.extname(filePath))) continue;
    const text = readText(filePath);
    if (/component-docs|initComponentDocs|data-uzu-component|uzu-reference|uzu-token|uzu-type|uzu-download-actions|uzu-app-hero|uzu-product|uzu-screen|uzu-feature/i.test(text)) {
      report(filePath, 'vendored Usuzumi assets should not contain component-page-only runtime or selectors');
    }
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
    checkInitialLanguageVisibility(filePath, text);
    checkPublicHtmlClasses(filePath, text);
  }
  if (extension === '.css') checkCssReferences(filePath, text);
}
checkComponentPage();
checkPackageBoundary();
checkSiteRuntimeBoundary();
checkVendorBoundary();
checkVendorUsuzumiClassCoverage();
checkVendorScrollbarContract();

if (issues.length) {
  console.error(`Validation failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Site validation passed.');
