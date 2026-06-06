import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Could not allocate a browser debugging port'));
      });
    });
    server.on('error', reject);
  });
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
  const requiredSnippets = [
    'html.uzu-root::-webkit-scrollbar-button',
    'body.uzu-app::-webkit-scrollbar-button',
    '.uzu-scroll::-webkit-scrollbar-button',
    '.uzu-scroll-area',
    '.uzu-table-wrap',
    '.uzu-data-grid-wrap',
    'display: none !important',
    'width: 0 !important',
    'height: 0 !important',
    'min-width: 0 !important',
    'min-height: 0 !important',
    'background-image: none !important',
    'color: transparent !important',
    '-webkit-appearance: none !important',
    'appearance: none !important',
    'min-width: 24px',
    'min-height: 24px',
    '--uzu-scrollbar-thumb-bg: transparent',
    '--uzu-scrollbar-thumb-bg: var(--uzu-border)',
    '::-webkit-scrollbar-corner'
  ];
  for (const snippet of requiredSnippets) {
    assert(vendorCss.includes(snippet), `vendor Usuzumi CSS is missing scrollbar contract snippet: ${snippet}`);
  }
}

function assertPanelState(id, result) {
  assert(result.visiblePanel === id, `expected visible panel ${id}, got ${result.visiblePanel}`);
  assertNoOverflow(result);
}

function visibleComponentPanelExpression() {
  return `document.querySelector('.uzu-panel[id^="component-"]:not([hidden])')?.id || ''`;
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
    visiblePanel: ${visibleComponentPanelExpression()},
    markdownValue: document.querySelector('#${id} [data-uzu-markdown-editor]')?.dataset.uzuMarkdownValue || '',
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

function waitForChildExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', resolve);
  });
}

async function removeWithRetry(directory) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await delay(180);
    }
  }
}

function browserDiagnostics(browser, launchArgs, childExit, stderrChunks) {
  const lines = [`Browser executable: ${browser}`, `Browser args: ${launchArgs.join(' ')}`];
  if (childExit) lines.push(`Browser exit: code=${childExit.code ?? 'null'} signal=${childExit.signal ?? 'null'}`);
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  if (stderr) lines.push(`Browser stderr:\n${stderr.slice(-4000)}`);
  return lines.join('\n');
}

async function waitForBrowser(activePortFile, debugPort, childExitRef, diagnostics) {
  const readPort = () => {
    if (!existsSync(activePortFile)) return 0;
    const [portText] = readFileSync(activePortFile, 'utf8').split(/\r?\n/);
    return Number.parseInt(portText, 10) || 0;
  };
  const getPortCandidates = () => [...new Set([debugPort, readPort()].filter(Boolean))];
  for (let index = 0; index < 150; index += 1) {
    if (childExitRef.current) break;
    for (const port of getPortCandidates()) {
      try {
        return await requestJson(port, '/json/version');
      } catch (_) {
        /* Keep polling while Chrome starts. */
      }
    }
    await delay(100);
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
  const debugPort = Number.parseInt(process.env.USUZUMI_SITE_BROWSER_DEBUG_PORT || '', 10) || await getFreePort();

  await removeWithRetry(profile);
  mkdirSync(profile, { recursive: true });

  const launchArgs = [
    '--headless=new',
    ...(process.platform === 'linux' ? [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ] : []),
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
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
    const browserInfo = await waitForBrowser(activePortFile, debugPort, childExitRef, diagnostics);
    const port = Number.parseInt(new URL(browserInfo.webSocketDebuggerUrl).port, 10)
      || debugPort
      || Number.parseInt(readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0], 10);
    const target = await requestJson(port, `/json/new?${encodeURIComponent(targetUrl)}`, 'PUT');
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await delay(1800);

    const initial = await evaluate(cdp, 'initial page state', `(() => ({
      title: document.title,
      navCount: document.querySelectorAll('[data-uzu-panel-target^="#component-"]').length,
      panelCount: document.querySelectorAll('.uzu-panel[id^="component-"]').length,
      visiblePanel: ${visibleComponentPanelExpression()},
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      highlightTokenCount: window.Usuzumi?.highlightCode?.("const label = 'Usuzumi';", 'javascript')?.fragment?.querySelectorAll?.('.uzu-code-token')?.length || 0,
      sideBarUsesPublicScroll: Boolean(document.querySelector('.uzu-sidebar.uzu-scroll')),
      documentedPanelCount: Array.from(document.querySelectorAll('.uzu-panel[id^="component-"]')).filter((panel) =>
        panel.textContent.includes('Component Docs')
        && panel.querySelector('.uzu-callout')
        && panel.querySelector('.uzu-table')
        && panel.querySelector('.uzu-code-block')
        && panel.querySelector('[data-uzu-code-copy]')
      ).length,
      demoTabPanelCount: Array.from(document.querySelectorAll('.uzu-panel[id^="component-"]')).filter((panel) =>
        panel.querySelector('[aria-label="Component demo view"][data-uzu-tabs]')
        && panel.querySelector('[data-uzu-tab-target^="#demo-"][data-uzu-tab-target$="-preview"]')
        && panel.querySelector('[data-uzu-tab-target^="#demo-"][data-uzu-tab-target$="-code"]')
        && panel.querySelector('[id^="demo-"][id$="-preview"]')
        && panel.querySelector('[id^="demo-"][id$="-code"] .uzu-code-block')
      ).length,
      highlightApi: Boolean(window.Usuzumi?.highlightCodeBlocks),
      componentDocsApi: Boolean(window.Usuzumi?.initComponentDocs),
      retiredSiteRuntimeApis: Boolean(window.UsuzumiComponentEditorLoader || window.UsuzumiComponentMarkdownEditor),
      scrollbarButtonProbe: [document.documentElement, document.body, document.querySelector('.uzu-sidebar.uzu-scroll-area')].filter(Boolean).map((element) => {
        const button = getComputedStyle(element, '::-webkit-scrollbar-button');
        const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
        return {
          selector: element === document.documentElement ? 'html' : element === document.body ? 'body' : '.uzu-sidebar.uzu-scroll-area',
          standardScrollbarWidth: getComputedStyle(element).scrollbarWidth || '',
          buttonDisplay: button.display,
          buttonWidth: button.width,
          buttonHeight: button.height,
          buttonBackgroundImage: button.backgroundImage,
          buttonColor: button.color,
          thumbMinWidth: thumb.minWidth,
          thumbMinHeight: thumb.minHeight
        };
      })
    }))()`);
    assert(initial.title === 'Usuzumi Components', `unexpected component page title: ${initial.title}`);
    assert(initial.panelCount >= 60, `too few component panels: ${initial.panelCount}`);
    assert(initial.navCount === initial.panelCount, `nav count ${initial.navCount} does not match panel count ${initial.panelCount}`);
    assert(initial.visiblePanel === 'component-colors', `unexpected initial panel: ${initial.visiblePanel}`);
    assert(initial.highlightTokenCount > 0, 'syntax highlighting API did not generate code tokens');
    assert(initial.sideBarUsesPublicScroll, 'component sidebar does not use the public .uzu-scroll class');
    assert(initial.documentedPanelCount === initial.panelCount, `documented panel count ${initial.documentedPanelCount} does not match panel count ${initial.panelCount}`);
    assert(initial.demoTabPanelCount === initial.panelCount, `component preview/code tabs ${initial.demoTabPanelCount} do not match panel count ${initial.panelCount}`);
    assert(initial.highlightApi, 'code highlighting API is not exposed');
    assert(!initial.componentDocsApi, 'component docs API should not be exposed');
    assert(!initial.retiredSiteRuntimeApis, 'retired site-owned UI runtime APIs are still exposed');
    assert(initial.scrollbarButtonProbe.length === 3, `component page scrollbar probe did not inspect all key scroll surfaces: ${JSON.stringify(initial.scrollbarButtonProbe)}`);
    for (const probe of initial.scrollbarButtonProbe) {
      assert(
        probe.standardScrollbarWidth !== 'thin',
        `component page Chromium scroll surface should use WebKit scrollbar styling instead of standard thin scrollbars: ${JSON.stringify(probe)}`
      );
      assert(
        probe.buttonDisplay === 'none'
        && probe.buttonWidth === '0px'
        && probe.buttonHeight === '0px'
        && (probe.buttonBackgroundImage === 'none' || probe.buttonBackgroundImage === '')
        && (probe.buttonColor === 'rgba(0, 0, 0, 0)' || probe.buttonColor === 'transparent'),
        `component page WebKit scrollbar arrow button is not fully hidden: ${JSON.stringify(probe)}`
      );
      assert(
        Number.parseFloat(probe.thumbMinWidth) >= 24
        && Number.parseFloat(probe.thumbMinHeight) >= 24,
        `component page scrollbar thumb can collapse into a triangular arrow-like shape: ${JSON.stringify(probe)}`
      );
    }
    assertNoOverflow(initial);

    const demoTabs = await evaluate(cdp, 'component preview/code tabs interaction', `(() => {
      const panel = document.querySelector('#component-colors');
      const previewTab = panel.querySelector('[data-uzu-tab-target="#demo-colors-preview"]');
      const codeTab = panel.querySelector('[data-uzu-tab-target="#demo-colors-code"]');
      const preview = panel.querySelector('#demo-colors-preview');
      const code = panel.querySelector('#demo-colors-code');
      const before = {
        previewHidden: preview.hidden,
        codeHidden: code.hidden,
        previewSelected: previewTab.getAttribute('aria-selected'),
        codeSelected: codeTab.getAttribute('aria-selected')
      };
      codeTab.click();
      const afterCode = {
        previewHidden: preview.hidden,
        codeHidden: code.hidden,
        previewSelected: previewTab.getAttribute('aria-selected'),
        codeSelected: codeTab.getAttribute('aria-selected')
      };
      previewTab.click();
      const afterPreview = {
        previewHidden: preview.hidden,
        codeHidden: code.hidden,
        previewSelected: previewTab.getAttribute('aria-selected'),
        codeSelected: codeTab.getAttribute('aria-selected')
      };
      return { before, afterCode, afterPreview };
    })()`);
    assert(
      !demoTabs.before.previewHidden
      && demoTabs.before.codeHidden
      && demoTabs.before.previewSelected === 'true'
      && demoTabs.before.codeSelected === 'false',
      `component demo tabs should start on preview: ${JSON.stringify(demoTabs)}`
    );
    assert(
      demoTabs.afterCode.previewHidden
      && !demoTabs.afterCode.codeHidden
      && demoTabs.afterCode.previewSelected === 'false'
      && demoTabs.afterCode.codeSelected === 'true',
      `component demo tabs did not switch to code: ${JSON.stringify(demoTabs)}`
    );
    assert(
      !demoTabs.afterPreview.previewHidden
      && demoTabs.afterPreview.codeHidden
      && demoTabs.afterPreview.previewSelected === 'true'
      && demoTabs.afterPreview.codeSelected === 'false',
      `component demo tabs did not switch back to preview: ${JSON.stringify(demoTabs)}`
    );

    const rawBacktickCopy = await evaluate(cdp, 'raw backticks in section descriptions', `(() =>
      Array.from(document.querySelectorAll('.uzu-section-head .uzu-text'))
        .filter((element) => element.textContent.includes('\`'))
        .map((element) => element.textContent.trim())
    )()`);
    assert(rawBacktickCopy.length === 0, `component page has raw markdown backticks in visible descriptions: ${JSON.stringify(rawBacktickCopy)}`);

    await openPanel(cdp, 'component-typography');
    const typographyPanel = await panelState(cdp, 'component-typography');
    assertPanelState('component-typography', typographyPanel);
    const typographySpecimens = await evaluate(cdp, 'typography specimen containment', `(() => {
      const makeTextRect = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        range.detach?.();
        return rect;
      };
      return Array.from(document.querySelectorAll('#component-typography .uzu-scroll-area > :is(.uzu-signature, .uzu-hero-title, .uzu-page-title, .uzu-section-title)'))
        .map((element) => {
          const preview = element.closest('.uzu-scroll-area');
          const card = element.closest('.uzu-card');
          const previewStyle = getComputedStyle(preview);
          const cardRect = card.getBoundingClientRect();
          const previewRect = preview.getBoundingClientRect();
          const textRect = makeTextRect(element);
          return {
            label: element.className,
            textLeft: textRect.left,
            textRight: textRect.right,
            previewLeft: previewRect.left,
            previewRight: previewRect.right,
            previewTop: previewRect.top,
            previewBottom: previewRect.bottom,
            previewOverflowY: previewStyle.overflowY,
            previewMaxHeight: previewStyle.maxHeight,
            previewClientHeight: preview.clientHeight,
            previewScrollHeight: preview.scrollHeight,
            cardLeft: cardRect.left,
            cardRight: cardRect.right,
            cardTop: cardRect.top,
            cardBottom: cardRect.bottom
          };
        });
    })()`);
    assert(typographySpecimens.length >= 4, `typography specimen containment did not inspect all display roles: ${JSON.stringify(typographySpecimens)}`);
    for (const specimen of typographySpecimens) {
      assert(
        specimen.previewLeft >= specimen.cardLeft - 1
        && specimen.previewRight <= specimen.cardRight + 1
        && specimen.previewTop >= specimen.cardTop - 1
        && specimen.previewBottom <= specimen.cardBottom + 1,
        `typography specimen preview escapes its card: ${JSON.stringify(specimen)}`
      );
      assert(
        specimen.textLeft >= specimen.previewLeft - 1 && specimen.textRight <= specimen.previewRight + 1,
        `typography specimen text escapes its public preview surface horizontally: ${JSON.stringify(specimen)}`
      );
      assert(
        specimen.previewOverflowY === 'auto' && Number.parseFloat(specimen.previewMaxHeight) > 0,
        `typography specimen preview should use a bounded public scroll area: ${JSON.stringify(specimen)}`
      );
    }
    assert(
      typographySpecimens.some((specimen) => specimen.label.includes('uzu-signature') && specimen.previewScrollHeight > specimen.previewClientHeight),
      `signature specimen should be visibly bounded by its public scroll area: ${JSON.stringify(typographySpecimens)}`
    );

    await openPanel(cdp, 'component-markdown-editor');
    const markdown = await waitForPanel(cdp, 'component-markdown-editor', (state) => state.markdownRendered);
    assertPanelState('component-markdown-editor', markdown);
    assert(markdown.markdownValue.includes('# Release note') && markdown.markdownRendered, 'built-in markdown preview did not render');

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

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await cdp.send('Emulation.setVisibleSize', { width: 390, height: 844 });
    await delay(350);
    await openPanel(cdp, 'component-skeleton');
    await delay(350);
    const mobileLayout = await evaluate(cdp, 'mobile component page layout', `(() => {
      const panel = document.querySelector('#component-skeleton');
      const sidebar = document.querySelector('.uzu-sidebar.uzu-scroll-area');
      const panelRect = panel?.getBoundingClientRect();
      const sidebarRect = sidebar?.getBoundingClientRect();
      const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
      return {
        visiblePanel: ${visibleComponentPanelExpression()},
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        panelTop: panelRect?.top ?? 9999,
        panelWidth: panelRect?.width ?? 0,
        sidebarHeight: sidebarRect?.height ?? 0,
        sidebarOverflowY: sidebarStyle?.overflowY || '',
        sidebarScrollHeight: sidebar?.scrollHeight || 0,
        sidebarClientHeight: sidebar?.clientHeight || 0
      };
    })()`);
    assertPanelState('component-skeleton', mobileLayout);
    assert(mobileLayout.panelTop < mobileLayout.viewportHeight * 0.72, `mobile component panel is pushed below the first viewport: ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.sidebarHeight <= 280, `mobile component sidebar is too tall: ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.sidebarOverflowY === 'auto', `mobile component sidebar should be locally scrollable: ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.sidebarScrollHeight > mobileLayout.sidebarClientHeight, `mobile component sidebar should contain local overflow: ${JSON.stringify(mobileLayout)}`);

    cdp.close();
    console.log('Site browser smoke passed.');
  } finally {
    child.kill();
    await Promise.race([waitForChildExit(child), delay(1500)]);
    await removeWithRetry(profile);
  }
}

await runBrowserSmoke();
