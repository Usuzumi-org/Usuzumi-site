import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { connectCdp, requestJson } from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorCssPath = path.join(root, 'assets', 'vendor', 'usuzumi', 'ui', 'usuzumi.css');
const vendorCss = existsSync(vendorCssPath) ? readFileSync(vendorCssPath, 'utf8') : '';

function browserCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome'
  ].filter(Boolean);
}

function findBrowserExecutable() {
  for (const candidate of [...new Set(browserCandidates())]) {
    if (existsSync(candidate)) return candidate;
  }

  const playwrightRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(playwrightRoot)) return '';
  const matches = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name === 'chrome.exe') matches.push(fullPath);
    }
  };
  walk(playwrightRoot);
  return matches.sort().at(-1) || '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exceptionDetailsToText(details) {
  if (!details) return '';
  const frames = details.stackTrace?.callFrames
    ?.map((frame) => `${frame.functionName || '<anonymous>'}@${frame.url}:${frame.lineNumber}:${frame.columnNumber}`)
    .join('\n') || '';
  return [
    details.text,
    details.exception?.description || details.exception?.value,
    frames
  ].filter(Boolean).join('\n');
}

async function evaluate(cdp, label, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(`${label} failed:\n${exceptionDetailsToText(result.exceptionDetails)}`);
  }
  return result.result.value;
}

function assertNoOverflow(result) {
  assert(result.horizontalOverflow <= 1, `component page has horizontal overflow: ${result.horizontalOverflow}px`);
}

function assertVendorScrollbarStyle() {
  assert(
    vendorCss.includes('.uzu-scroll::-webkit-scrollbar') || (vendorCss.includes('.uzu-scroll') && vendorCss.includes('scrollbar-width')),
    'vendor Usuzumi CSS does not expose the public .uzu-scroll scrollbar style'
  );
}

function assertPanelState(id, result) {
  assert(result.visiblePanel === id, `expected visible panel ${id}, got ${result.visiblePanel}`);
  assertNoOverflow(result);
}

async function openPanel(cdp, id) {
  await evaluate(cdp, `open ${id}`, `(() => {
    const button = document.querySelector('[data-uzu-panel-target="#${id}"]');
    if (!button) throw new Error('Missing panel nav button: ${id}');
    button.click();
    return true;
  })()`);
}

async function panelState(cdp, id) {
  return evaluate(cdp, `state ${id}`, `(() => ({
    visiblePanel: document.querySelector('.uzu-reference-panel:not([hidden])')?.id || '',
    editorReady: document.querySelector('#${id} [data-uzu-rich-editor], #${id} [data-uzu-markdown-editor], #${id} [data-code-editor-shell]')?.dataset.editorReady || '',
    codeMirrorMounted: Boolean(document.querySelector('#${id} .cm-editor')),
    tiptapMounted: Boolean(document.querySelector('#${id} .ProseMirror')),
    markdownRendered: Boolean(document.querySelector('#${id} [data-uzu-markdown-preview] h1, #${id} [data-uzu-markdown-preview] ul')),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }))()`);
}

async function waitForPanel(cdp, id, predicate) {
  for (let index = 0; index < 40; index += 1) {
    const state = await panelState(cdp, id);
    if (predicate(state)) return state;
    await delay(150);
  }
  return panelState(cdp, id);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function browserDiagnostics(browser, launchArgs, childExit, stderrChunks) {
  const lines = [`Browser executable: ${browser}`, `Browser args: ${launchArgs.join(' ')}`];
  if (childExit) lines.push(`Browser exit: code=${childExit.code ?? 'null'} signal=${childExit.signal ?? 'null'}`);
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  if (stderr) lines.push(`Browser stderr:\n${stderr.slice(-4000)}`);
  return lines.join('\n');
}

async function waitForBrowser(activePortFile, childExitRef, diagnostics) {
  const readPort = () => {
    if (!existsSync(activePortFile)) return 0;
    const [portText] = readFileSync(activePortFile, 'utf8').split(/\r?\n/);
    return Number.parseInt(portText, 10) || 0;
  };
  for (let index = 0; index < 150; index += 1) {
    if (childExitRef.current) break;
    const port = readPort();
    if (!port) {
      await delay(100);
      continue;
    }
    try {
      return await requestJson(port, '/json/version');
    } catch (_) {
      await delay(100);
    }
  }
  throw new Error(`Browser did not expose a DevTools endpoint.\n${diagnostics()}`);
}

async function runBrowserSmoke() {
  assertVendorScrollbarStyle();
  const browser = findBrowserExecutable();
  if (!browser) {
    console.log('Site browser smoke skipped: no Chromium/Chrome/Edge executable found.');
    return;
  }

  const profile = path.join(root, '.tmp', 'browser-smoke-profile');
  const activePortFile = path.join(profile, 'DevToolsActivePort');
  const targetUrl = pathToFileURL(path.join(root, 'components.html')).href;

  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });

  const launchArgs = [
    '--headless=new',
    ...(process.platform === 'linux' ? [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ] : []),
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];
  const child = spawn(browser, launchArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  const stderrChunks = [];
  const childExitRef = { current: null };
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(Buffer.from(chunk));
    if (stderrChunks.length > 20) stderrChunks.shift();
  });
  child.on('exit', (code, signal) => {
    childExitRef.current = { code, signal };
  });

  const diagnostics = () => browserDiagnostics(browser, launchArgs, childExitRef.current, stderrChunks);
  try {
    const browserInfo = await waitForBrowser(activePortFile, childExitRef, diagnostics);
    const port = Number.parseInt(new URL(browserInfo.webSocketDebuggerUrl).port, 10)
      || Number.parseInt(readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0], 10);
    const target = await requestJson(port, `/json/new?${encodeURIComponent(targetUrl)}`, 'PUT');
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await delay(1800);

    const initial = await evaluate(cdp, 'initial page state', `(() => ({
      title: document.title,
      navCount: document.querySelectorAll('[data-uzu-panel-target^="#component-"]').length,
      panelCount: document.querySelectorAll('.uzu-reference-panel').length,
      visiblePanel: document.querySelector('.uzu-reference-panel:not([hidden])')?.id || '',
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tokenCount: document.querySelectorAll('.uzu-code-token').length,
      copyButtons: document.querySelectorAll('[data-uzu-code-copy]').length,
      codeBlocks: document.querySelectorAll('.uzu-code-block').length,
      tutorialCount: document.querySelectorAll('.uzu-reference-panel .uzu-reference-tutorial').length,
      interfaceCount: document.querySelectorAll('.uzu-reference-panel .uzu-reference-interface').length,
      demoCount: document.querySelectorAll('.uzu-reference-panel .uzu-reference-demo').length,
      previewTabs: document.querySelectorAll('.uzu-reference-panel .uzu-tab[data-uzu-tab-value="preview"]').length,
      codeTabs: document.querySelectorAll('.uzu-reference-panel .uzu-tab[data-uzu-tab-value="code"]').length,
      interfaceTables: document.querySelectorAll('.uzu-reference-panel .uzu-reference-table').length,
      interfaceRows: document.querySelectorAll('.uzu-reference-panel .uzu-reference-table tbody tr').length,
      emptyPurposeCells: [...document.querySelectorAll('.uzu-reference-table tbody td:nth-child(2)')]
        .filter((cell) => cell.textContent.trim().length < 12).length,
      emptyExampleCells: [...document.querySelectorAll('.uzu-reference-table tbody td:nth-child(3)')]
        .filter((cell) => cell.textContent.trim().length < 4).length,
      malformedCodeBlocks: [...document.querySelectorAll('.uzu-code-block')].filter((block) => (
        !block.querySelector('.uzu-code-block-body')
        || !block.querySelector('[data-uzu-code-copy]')
        || block.querySelector('code')?.textContent.trim().length < 3
      )).length,
      oversizedCopyButtons: [...document.querySelectorAll('.uzu-code-block-copy')].filter((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.position !== 'absolute' || rect.width > 40 || rect.height > 40;
      }).length,
      sideBarUsesPublicScroll: Boolean(document.querySelector('.uzu-reference-sidebar.uzu-scroll')),
      highlightApi: Boolean(window.UsuzumiComponentCodeHighlight?.highlightAll),
      loaderApi: Boolean(window.UsuzumiComponentEditorLoader?.loadVisibleEditors),
      editorEnginesOnBoot: Boolean(window.UsuzumiComponentRichEditor || window.UsuzumiComponentMarkdownEditor || window.UsuzumiComponentCodeEditor)
    }))()`);
    assert(initial.title === 'Usuzumi Components', `unexpected component page title: ${initial.title}`);
    assert(initial.panelCount >= 60, `too few component panels: ${initial.panelCount}`);
    assert(initial.navCount === initial.panelCount, `nav count ${initial.navCount} does not match panel count ${initial.panelCount}`);
    assert(initial.visiblePanel === 'component-colors', `unexpected initial panel: ${initial.visiblePanel}`);
    assert(initial.tokenCount > 0, 'syntax highlighting did not generate code tokens');
    assert(initial.copyButtons === initial.codeBlocks, `copy buttons ${initial.copyButtons} do not match code blocks ${initial.codeBlocks}`);
    assert(initial.tutorialCount === initial.panelCount, `tutorial count ${initial.tutorialCount} does not match panel count ${initial.panelCount}`);
    assert(initial.interfaceCount === initial.panelCount, `interface count ${initial.interfaceCount} does not match panel count ${initial.panelCount}`);
    assert(initial.demoCount === initial.panelCount, `demo count ${initial.demoCount} does not match panel count ${initial.panelCount}`);
    assert(initial.previewTabs === initial.panelCount && initial.codeTabs === initial.panelCount, `preview/code tabs are incomplete: ${initial.previewTabs}/${initial.codeTabs}`);
    assert(initial.interfaceTables >= initial.panelCount, `too few interface tables: ${initial.interfaceTables}`);
    assert(initial.interfaceRows >= initial.panelCount * 2, `too few interface rows: ${initial.interfaceRows}`);
    assert(initial.emptyPurposeCells === 0, `${initial.emptyPurposeCells} configurable rows have weak purpose copy`);
    assert(initial.emptyExampleCells === 0, `${initial.emptyExampleCells} configurable rows are missing example values`);
    assert(initial.malformedCodeBlocks === 0, `${initial.malformedCodeBlocks} code blocks are missing body, copy button, or content`);
    assert(initial.oversizedCopyButtons === 0, `${initial.oversizedCopyButtons} copy buttons are not small absolute icon buttons`);
    assert(initial.sideBarUsesPublicScroll, 'reference sidebar does not use the public .uzu-scroll class');
    assert(initial.highlightApi, 'code highlighting API is not exposed');
    assert(initial.loaderApi, 'editor loader API is not exposed');
    assert(!initial.editorEnginesOnBoot, 'editor engine bundles loaded before an editor panel was visible');
    assertNoOverflow(initial);

    await openPanel(cdp, 'component-rich-editor');
    const rich = await waitForPanel(cdp, 'component-rich-editor', (state) => state.editorReady === 'tiptap');
    assertPanelState('component-rich-editor', rich);
    assert(rich.editorReady === 'tiptap' && rich.tiptapMounted, 'Tiptap editor did not mount');

    await openPanel(cdp, 'component-markdown-editor');
    const markdown = await waitForPanel(cdp, 'component-markdown-editor', (state) => state.editorReady === 'markdown-it');
    assertPanelState('component-markdown-editor', markdown);
    assert(markdown.editorReady === 'markdown-it' && markdown.markdownRendered, 'markdown-it preview did not render');

    await openPanel(cdp, 'component-code-editor');
    const code = await waitForPanel(cdp, 'component-code-editor', (state) => state.editorReady === 'codemirror');
    assertPanelState('component-code-editor', code);
    assert(code.editorReady === 'codemirror' && code.codeMirrorMounted, 'CodeMirror editor did not mount');

    await openPanel(cdp, 'component-data-grid');
    await evaluate(cdp, 'data grid interaction', `(() => {
      const header = document.querySelector('#component-data-grid [data-uzu-grid-sort]');
      const row = document.querySelector('#component-data-grid tbody tr');
      if (!header || !row) throw new Error('Missing data grid controls');
      header.click();
      row.click();
      return true;
    })()`);
    const dataGrid = await panelState(cdp, 'component-data-grid');
    assertPanelState('component-data-grid', dataGrid);
    const dataGridResult = await evaluate(cdp, 'data grid result', `(() => ({
      sort: document.querySelector('#component-data-grid [aria-sort]')?.getAttribute('aria-sort') || '',
      selected: document.querySelectorAll('#component-data-grid tbody tr[aria-selected="true"]').length
    }))()`);
    assert(dataGridResult.sort === 'ascending', `data grid sort did not update: ${dataGridResult.sort}`);
    assert(dataGridResult.selected === 1, `data grid selection did not update: ${dataGridResult.selected}`);

    await openPanel(cdp, 'component-tree');
    await evaluate(cdp, 'tree interaction', `(() => {
      const tree = document.querySelector('#component-tree [data-uzu-tree]');
      const toggle = tree?.querySelector('[data-uzu-tree-value="ui"] [data-uzu-tree-toggle]');
      const target = tree?.querySelector('[data-uzu-tree-value="tokens"]');
      if (!tree || !toggle || !target) throw new Error('Missing tree controls');
      toggle.click();
      target.click();
      return true;
    })()`);
    const treeResult = await evaluate(cdp, 'tree result', `(() => ({
      open: document.querySelector('#component-tree [data-uzu-tree-value="ui"]')?.classList.contains('is-open') || false,
      selected: document.querySelector('#component-tree [data-uzu-tree]')?.dataset.uzuTreeValue || ''
    }))()`);
    assert(treeResult.open, 'tree toggle did not open the ui branch');
    assert(treeResult.selected === 'tokens', `tree selection did not update: ${treeResult.selected}`);

    await openPanel(cdp, 'component-split-pane');
    const splitResult = await evaluate(cdp, 'split pane interaction', `(() => {
      const split = document.querySelector('#component-split-pane [data-uzu-split-pane]');
      const resizer = split?.querySelector('[data-uzu-split-resizer]');
      if (!split || !resizer) throw new Error('Missing split pane controls');
      const before = Number(split.dataset.uzuSplitSize || 0);
      resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return { before, after: Number(split.dataset.uzuSplitSize || 0) };
    })()`);
    assert(splitResult.after > splitResult.before, `split pane did not resize: ${JSON.stringify(splitResult)}`);

    await openPanel(cdp, 'component-resizable');
    const resizableResult = await evaluate(cdp, 'resizable interaction', `(() => {
      const panel = document.querySelector('#component-resizable [data-uzu-resizable]');
      const handle = panel?.querySelector('[data-uzu-resizable-handle]');
      if (!panel || !handle) throw new Error('Missing resizable controls');
      const before = Number(panel.dataset.uzuResizableWidth || 0);
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return { before, after: Number(panel.dataset.uzuResizableWidth || 0) };
    })()`);
    assert(resizableResult.after > resizableResult.before, `resizable panel did not resize: ${JSON.stringify(resizableResult)}`);

    cdp.close();
    console.log('Site browser smoke passed.');
  } finally {
    child.kill();
    await delay(250);
    rmSync(profile, { recursive: true, force: true });
  }
}

await runBrowserSmoke();
