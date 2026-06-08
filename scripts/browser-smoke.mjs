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
      languageSelectorProbe: (() => {
        const pageSelect = document.querySelector('main > .uzu-topbar [data-uzu-language-select]');
        const retiredToggleSelector = '[data-uzu-language-' + 'toggle], .uzu-language-' + 'toggle';
        return {
          legacyToggleCount: document.querySelectorAll(retiredToggleSelector).length,
          selectCount: document.querySelectorAll('[data-uzu-language-select]').length,
          pageSelectExists: Boolean(pageSelect),
          pageTriggerExists: Boolean(pageSelect?.querySelector('[data-uzu-language-trigger]')),
          pageMenuExists: Boolean(pageSelect?.querySelector('[data-uzu-language-menu]')),
          pageOptionValues: Array.from(pageSelect?.querySelectorAll('[data-uzu-language-option]') || [])
            .map((option) => option.getAttribute('data-uzu-language-value') || '')
        };
      })(),
      catalogStructurePanelCount: Array.from(document.querySelectorAll('.uzu-panel[id^="component-"]')).filter((panel) =>
        panel.querySelector('.uzu-callout')
        && panel.querySelector('.uzu-table')
        && panel.querySelector('.uzu-code-block')
        && panel.querySelector('[data-uzu-code-copy]')
      ).length,
      catalogNotesPanelCount: Array.from(document.querySelectorAll('.uzu-panel[id^="component-"]')).filter((panel) =>
        Array.from(panel.querySelectorAll('.uzu-card > .uzu-title-pair > h3')).some((heading) => {
          const text = heading.innerText.trim();
          return text.includes('组件文档') || text.includes('Component Docs') || text.includes('接口') || text.includes('Interface');
        })
      ).length,
      demoTabPanelCount: Array.from(document.querySelectorAll('.uzu-panel[id^="component-"]')).filter((panel) =>
        panel.querySelector('[aria-label="Component demo view"][data-uzu-tabs]')
        && panel.querySelector('[data-uzu-tab-target^="#demo-"][data-uzu-tab-target$="-preview"]')
        && panel.querySelector('[data-uzu-tab-target^="#demo-"][data-uzu-tab-target$="-code"]')
        && panel.querySelector('[id^="demo-"][id$="-preview"]')
        && panel.querySelector('[id^="demo-"][id$="-code"] .uzu-code-block')
      ).length,
      pageTopbarActionsProbe: (() => {
        const probe = (topbar, actions) => {
          const topbarRect = topbar?.getBoundingClientRect();
          const actionsRect = actions?.getBoundingClientRect();
          const topbarStyle = topbar ? getComputedStyle(topbar) : null;
          const actionsStyle = actions ? getComputedStyle(actions) : null;
          return {
            exists: Boolean(topbar && actions),
            topbarDisplay: topbarStyle?.display || '',
            actionsDisplay: actionsStyle?.display || '',
            actionsFlexShrink: actionsStyle?.flexShrink || '',
            actionsRightDelta: topbarRect && actionsRect ? Math.abs(actionsRect.right - topbarRect.right) : 9999,
            actionsTop: actionsRect?.top ?? 0,
            topbarTop: topbarRect?.top ?? 0,
            actionsBottom: actionsRect?.bottom ?? 0,
            topbarBottom: topbarRect?.bottom ?? 0
          };
        };
        return probe(document.querySelector('main > .uzu-topbar'), document.querySelector('main > .uzu-topbar > .uzu-topbar-actions'));
      })(),
      sidebarScrollGapProbe: (() => {
        const sidebar = document.querySelector('.uzu-sidebar.uzu-scroll-area');
        const active = sidebar?.querySelector('.uzu-panel-nav-button[aria-pressed="true"], .uzu-panel-nav-button.is-active');
        const sidebarRect = sidebar?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
        return {
          exists: Boolean(sidebar && active),
          overflowY: sidebarStyle?.overflowY || '',
          scrollbarGutter: sidebarStyle?.scrollbarGutter || '',
          paddingInlineEnd: sidebarStyle?.paddingInlineEnd || '',
          activeRightGap: sidebarRect && activeRect ? Math.round(sidebarRect.right - activeRect.right) : 0
        };
      })(),
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
    assert(initial.sidebarScrollGapProbe.exists, `component sidebar scroll gap probe is missing public structure: ${JSON.stringify(initial.sidebarScrollGapProbe)}`);
    assert(
      initial.sidebarScrollGapProbe.overflowY === 'auto'
        && String(initial.sidebarScrollGapProbe.scrollbarGutter).includes('stable')
        && Number.parseFloat(initial.sidebarScrollGapProbe.paddingInlineEnd) >= 12
        && initial.sidebarScrollGapProbe.activeRightGap >= 18,
      `component sidebar should keep active items away from its scrollbar: ${JSON.stringify(initial.sidebarScrollGapProbe)}`
    );
    assert(initial.languageSelectorProbe.legacyToggleCount === 0, `component page should not expose retired language toggle controls: ${JSON.stringify(initial.languageSelectorProbe)}`);
    assert(initial.languageSelectorProbe.selectCount >= 2, `component page should expose page and preview language selectors: ${JSON.stringify(initial.languageSelectorProbe)}`);
    assert(initial.languageSelectorProbe.pageSelectExists && initial.languageSelectorProbe.pageTriggerExists && initial.languageSelectorProbe.pageMenuExists, `page topbar language selector is incomplete: ${JSON.stringify(initial.languageSelectorProbe)}`);
    assert(initial.languageSelectorProbe.pageOptionValues.includes('zh') && initial.languageSelectorProbe.pageOptionValues.includes('en'), `page topbar language selector should provide concrete options: ${JSON.stringify(initial.languageSelectorProbe)}`);
    assert(initial.catalogStructurePanelCount === initial.panelCount, `catalog structure panel count ${initial.catalogStructurePanelCount} does not match panel count ${initial.panelCount}`);
    assert(initial.catalogNotesPanelCount === initial.panelCount, `catalog notes panel count ${initial.catalogNotesPanelCount} does not match panel count ${initial.panelCount}`);
    assert(initial.demoTabPanelCount === initial.panelCount, `component preview/code tabs ${initial.demoTabPanelCount} do not match panel count ${initial.panelCount}`);
    const pageTopbarProbe = initial.pageTopbarActionsProbe;
    assert(pageTopbarProbe.exists, `component page header should include the public actions slot: ${JSON.stringify(pageTopbarProbe)}`);
    assert(pageTopbarProbe.topbarDisplay === 'flex' && pageTopbarProbe.actionsDisplay === 'flex' && pageTopbarProbe.actionsFlexShrink === '0', `component page header actions should use the public flex contract: ${JSON.stringify(pageTopbarProbe)}`);
    assert(pageTopbarProbe.actionsRightDelta <= 1, `component page header actions should align to the topbar end: ${JSON.stringify(pageTopbarProbe)}`);
    assert(pageTopbarProbe.actionsTop >= pageTopbarProbe.topbarTop - 1 && pageTopbarProbe.actionsBottom <= pageTopbarProbe.topbarBottom + 1, `component page header actions should stay inside the topbar row: ${JSON.stringify(pageTopbarProbe)}`);
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

    await openPanel(cdp, 'component-topbar');
    const topbarPanel = await waitForPanel(cdp, 'component-topbar', (state) => state.visiblePanel === 'component-topbar');
    assertPanelState('component-topbar', topbarPanel);
    const previewTopbarProbe = await evaluate(cdp, 'component topbar preview actions position', `(() => {
      const topbar = document.querySelector('#component-topbar #demo-topbar-preview .uzu-topbar');
      const actions = document.querySelector('#component-topbar #demo-topbar-preview .uzu-topbar-actions');
      const topbarRect = topbar?.getBoundingClientRect();
      const actionsRect = actions?.getBoundingClientRect();
      const topbarStyle = topbar ? getComputedStyle(topbar) : null;
      const actionsStyle = actions ? getComputedStyle(actions) : null;
      return {
        exists: Boolean(topbar && actions),
        topbarDisplay: topbarStyle?.display || '',
        topbarMarginBottom: topbarStyle?.marginBottom || '',
        actionsDisplay: actionsStyle?.display || '',
        actionsFlexShrink: actionsStyle?.flexShrink || '',
        actionsRightDelta: topbarRect && actionsRect ? Math.abs(actionsRect.right - topbarRect.right) : 9999,
        actionsTop: actionsRect?.top ?? 0,
        topbarTop: topbarRect?.top ?? 0,
        actionsBottom: actionsRect?.bottom ?? 0,
        topbarBottom: topbarRect?.bottom ?? 0
      };
    })()`);
    assert(previewTopbarProbe.exists, `component topbar preview should include the public actions slot: ${JSON.stringify(previewTopbarProbe)}`);
    assert(previewTopbarProbe.topbarDisplay === 'flex' && previewTopbarProbe.actionsDisplay === 'flex' && previewTopbarProbe.actionsFlexShrink === '0', `component topbar preview actions should use the public flex contract: ${JSON.stringify(previewTopbarProbe)}`);
    assert(previewTopbarProbe.topbarMarginBottom === '0px', `component topbar preview should remove page-level bottom spacing with a public variable: ${JSON.stringify(previewTopbarProbe)}`);
    assert(previewTopbarProbe.actionsRightDelta <= 1, `component topbar preview actions should align to the topbar end: ${JSON.stringify(previewTopbarProbe)}`);
    assert(previewTopbarProbe.actionsTop >= previewTopbarProbe.topbarTop - 1 && previewTopbarProbe.actionsBottom <= previewTopbarProbe.topbarBottom + 1, `component topbar preview actions should stay inside the topbar row: ${JSON.stringify(previewTopbarProbe)}`);

    const localLanguage = await evaluate(cdp, 'component topbar local language selector interaction', `(() => {
      const pageRoot = document.documentElement;
      const root = document.querySelector('#demo-topbar-language-root');
      const select = root?.querySelector('[data-uzu-language-select]');
      const trigger = select?.querySelector('[data-uzu-language-trigger]');
      const menu = select?.querySelector('[data-uzu-language-menu]');
      const option = select?.querySelector('[data-uzu-language-option][data-uzu-language-value="en"]');
      const zhCopy = root?.querySelector('[data-lang="zh"]');
      const enCopy = root?.querySelector('[data-lang="en"]');
      if (!root || !select || !trigger || !menu || !option || !zhCopy || !enCopy) throw new Error('Missing local language selector preview controls');
      const isHidden = (element) => element.hasAttribute('data-uzu-language-hidden') || getComputedStyle(element).display === 'none';
      const before = {
        pageLanguage: pageRoot.getAttribute('data-language') || '',
        rootLanguage: root.getAttribute('data-language') || '',
        rootUzuLang: root.getAttribute('data-uzu-lang') || '',
        rootHtmlLang: root.getAttribute('lang') || '',
        zhHidden: isHidden(zhCopy),
        enHidden: isHidden(enCopy),
        menuHidden: menu.hidden,
        triggerExpanded: trigger.getAttribute('aria-expanded')
      };
      trigger.click();
      const afterOpen = {
        menuHidden: menu.hidden,
        menuDisplay: getComputedStyle(menu).display,
        openClass: select.classList.contains('is-open'),
        triggerExpanded: trigger.getAttribute('aria-expanded')
      };
      option.click();
      const afterChoose = {
        pageLanguage: pageRoot.getAttribute('data-language') || '',
        rootLanguage: root.getAttribute('data-language') || '',
        rootUzuLang: root.getAttribute('data-uzu-lang') || '',
        rootHtmlLang: root.getAttribute('lang') || '',
        zhHidden: isHidden(zhCopy),
        enHidden: isHidden(enCopy),
        selectedText: select.querySelector('[data-uzu-language-option].is-selected')?.textContent.trim() || '',
        selectedValue: select.querySelector('[data-uzu-language-option].is-selected')?.getAttribute('data-uzu-language-value') || '',
        triggerExpanded: trigger.getAttribute('aria-expanded'),
        closingOrHidden: select.classList.contains('is-closing') || menu.hidden
      };
      return { before, afterOpen, afterChoose };
    })()`);
    assert(
      localLanguage.before.pageLanguage === 'zh'
      && localLanguage.before.rootLanguage === 'zh'
      && localLanguage.before.rootUzuLang === 'zh'
      && localLanguage.before.rootHtmlLang === 'zh-CN'
      && !localLanguage.before.zhHidden
      && localLanguage.before.enHidden
      && localLanguage.before.menuHidden
      && localLanguage.before.triggerExpanded === 'false',
      `local language preview should start in Chinese without affecting the page: ${JSON.stringify(localLanguage)}`
    );
    assert(
      !localLanguage.afterOpen.menuHidden
      && localLanguage.afterOpen.menuDisplay === 'grid'
      && localLanguage.afterOpen.openClass
      && localLanguage.afterOpen.triggerExpanded === 'true',
      `local language menu did not open like a selector: ${JSON.stringify(localLanguage)}`
    );
    assert(
      localLanguage.afterChoose.pageLanguage === 'zh'
      && localLanguage.afterChoose.rootLanguage === 'en'
      && localLanguage.afterChoose.rootUzuLang === 'en'
      && localLanguage.afterChoose.rootHtmlLang === 'en'
      && localLanguage.afterChoose.zhHidden
      && !localLanguage.afterChoose.enHidden
      && localLanguage.afterChoose.selectedValue === 'en'
      && localLanguage.afterChoose.selectedText === 'English'
      && localLanguage.afterChoose.triggerExpanded === 'false'
      && localLanguage.afterChoose.closingOrHidden,
      `local language selector should update only its target root: ${JSON.stringify(localLanguage)}`
    );

    const pageLanguage = await evaluate(cdp, 'page language selector interaction', `(() => {
      const root = document.documentElement;
      const select = document.querySelector('main > .uzu-topbar [data-uzu-language-select]');
      const trigger = select?.querySelector('[data-uzu-language-trigger]');
      const menu = select?.querySelector('[data-uzu-language-menu]');
      const option = select?.querySelector('[data-uzu-language-option][data-uzu-language-value="en"]');
      const zhCopy = document.querySelector('main > .uzu-topbar [data-lang="zh"]');
      const enCopy = document.querySelector('main > .uzu-topbar [data-lang="en"]');
      if (!select || !trigger || !menu || !option || !zhCopy || !enCopy) throw new Error('Missing page language selector controls');
      const events = [];
      select.addEventListener('uzu-language-change', (event) => {
        events.push({
          language: event.detail.language,
          previousLanguage: event.detail.previousLanguage,
          htmlLang: event.detail.htmlLang,
          key: event.detail.key
        });
      }, { once: true });
      const isHidden = (element) => element.hasAttribute('data-uzu-language-hidden') || getComputedStyle(element).display === 'none';
      const before = {
        rootLanguage: root.getAttribute('data-language') || '',
        rootUzuLang: root.getAttribute('data-uzu-lang') || '',
        rootHtmlLang: root.getAttribute('lang') || '',
        zhHidden: isHidden(zhCopy),
        enHidden: isHidden(enCopy),
        menuHidden: menu.hidden,
        triggerExpanded: trigger.getAttribute('aria-expanded')
      };
      trigger.click();
      const afterOpen = {
        menuHidden: menu.hidden,
        menuDisplay: getComputedStyle(menu).display,
        openClass: select.classList.contains('is-open'),
        triggerExpanded: trigger.getAttribute('aria-expanded')
      };
      option.click();
      const afterChoose = {
        rootLanguage: root.getAttribute('data-language') || '',
        rootUzuLang: root.getAttribute('data-uzu-lang') || '',
        rootHtmlLang: root.getAttribute('lang') || '',
        zhHidden: isHidden(zhCopy),
        enHidden: isHidden(enCopy),
        selectedText: select.querySelector('[data-uzu-language-option].is-selected')?.textContent.trim() || '',
        selectedValue: select.querySelector('[data-uzu-language-option].is-selected')?.getAttribute('data-uzu-language-value') || '',
        triggerExpanded: trigger.getAttribute('aria-expanded'),
        closingOrHidden: select.classList.contains('is-closing') || menu.hidden,
        events
      };
      return { before, afterOpen, afterChoose };
    })()`);
    assert(
      pageLanguage.before.rootLanguage === 'zh'
      && pageLanguage.before.rootUzuLang === 'zh'
      && pageLanguage.before.rootHtmlLang === 'zh-CN'
      && !pageLanguage.before.zhHidden
      && pageLanguage.before.enHidden
      && pageLanguage.before.menuHidden
      && pageLanguage.before.triggerExpanded === 'false',
      `page language selector should start from the document language state: ${JSON.stringify(pageLanguage)}`
    );
    assert(
      !pageLanguage.afterOpen.menuHidden
      && pageLanguage.afterOpen.menuDisplay === 'grid'
      && pageLanguage.afterOpen.openClass
      && pageLanguage.afterOpen.triggerExpanded === 'true',
      `page language menu did not open like a selector: ${JSON.stringify(pageLanguage)}`
    );
    assert(
      pageLanguage.afterChoose.rootLanguage === 'en'
      && pageLanguage.afterChoose.rootUzuLang === 'en'
      && pageLanguage.afterChoose.rootHtmlLang === 'en'
      && pageLanguage.afterChoose.zhHidden
      && !pageLanguage.afterChoose.enHidden
      && pageLanguage.afterChoose.selectedValue === 'en'
      && pageLanguage.afterChoose.selectedText === 'English'
      && pageLanguage.afterChoose.triggerExpanded === 'false'
      && pageLanguage.afterChoose.closingOrHidden
      && pageLanguage.afterChoose.events.length === 1
      && pageLanguage.afterChoose.events[0].language === 'en'
      && pageLanguage.afterChoose.events[0].previousLanguage === 'zh'
      && pageLanguage.afterChoose.events[0].htmlLang === 'en',
      `page language selector should update the document root and emit a change event: ${JSON.stringify(pageLanguage)}`
    );

    await evaluate(cdp, 'reset page language to Chinese for localized component code checks', `(() => {
      window.Usuzumi.applyLanguage(document.documentElement, 'zh', '', 'zh-CN');
      return true;
    })()`);

    await openPanel(cdp, 'component-layout-primitives');
    const layoutPrimitivesPanel = await waitForPanel(cdp, 'component-layout-primitives', (state) => state.visiblePanel === 'component-layout-primitives');
    assertPanelState('component-layout-primitives', layoutPrimitivesPanel);
    const layoutPrimitivesProbe = await evaluate(cdp, 'component layout primitives composition and localized code', `(() => {
      const panel = document.querySelector('#component-layout-primitives');
      const preview = panel?.querySelector('#demo-layout-primitives-preview');
      const codeTab = panel?.querySelector('[data-uzu-tab-target="#demo-layout-primitives-code"]');
      const codePanel = panel?.querySelector('#demo-layout-primitives-code');
      if (!panel || !preview || !codeTab || !codePanel) throw new Error('Missing layout primitives preview controls');
      const previewText = preview.innerText;
      const card = preview.querySelector(':scope > section.uzu-card.uzu-stack');
      const scrollArea = preview.querySelector('.uzu-scroll-area.uzu-stack');
      const scrollTitle = scrollArea?.querySelector('.uzu-title-pair');
      const scrollAreaRect = scrollArea?.getBoundingClientRect();
      const scrollTitleRect = scrollTitle?.getBoundingClientRect();
      const scrollTopGap = scrollAreaRect && scrollTitleRect ? Math.round(scrollTitleRect.top - scrollAreaRect.top) : null;
      const scrollAreaClientHeight = scrollArea?.clientHeight || 0;
      const scrollAreaScrollHeight = scrollArea?.scrollHeight || 0;
      const sidebarLinks = Array.from(preview.querySelectorAll('.uzu-sidebar-layout .uzu-sidebar-nav a')).map((link) => link.getAttribute('href') || '');
      codeTab.click();
      const visiblePre = Array.from(codePanel.querySelectorAll('pre')).find((pre) =>
        !pre.hidden
        && !pre.hasAttribute('data-uzu-language-hidden')
        && getComputedStyle(pre).display !== 'none'
      );
      return {
        titleText: panel.querySelector('.uzu-section-title')?.innerText.trim() || '',
        previewText,
        cardLabelledby: card?.getAttribute('aria-labelledby') || '',
        cardLabelText: card?.getAttribute('aria-labelledby') ? document.getElementById(card.getAttribute('aria-labelledby'))?.innerText.trim() || '' : '',
        specimenCount: preview.querySelectorAll(':scope > section.uzu-card > .uzu-stack > article.uzu-callout').length,
        hasDirectCardStack: Boolean(card),
        hasPanelNav: Boolean(preview.querySelector('.uzu-panel-nav')),
        hasSidebarLayout: Boolean(preview.querySelector('.uzu-sidebar-layout > .uzu-sidebar + main.uzu-stack')),
        hasActionRow: Boolean(preview.querySelector('.uzu-flex .uzu-spacer + .uzu-button')),
        hasAspect: Boolean(preview.querySelector('.uzu-aspect.uzu-card.uzu-center')),
        hasLocalScroll: Boolean(scrollArea),
        sidebarLinks,
        sidebarTargetsExist: sidebarLinks.every((href) => href.startsWith('#') && Boolean(document.querySelector(href))),
        scrollTopGap,
        scrollAreaClientHeight,
        scrollAreaScrollHeight,
        visibleLang: visiblePre?.getAttribute('data-lang') || '',
        visibleCode: visiblePre?.textContent || ''
      };
    })()`);
    assert(
      layoutPrimitivesProbe.titleText.includes('布局工具')
      && layoutPrimitivesProbe.previewText.includes('布局原语标本')
      && layoutPrimitivesProbe.previewText.includes('纵向节奏')
      && layoutPrimitivesProbe.previewText.includes('行内分布')
      && layoutPrimitivesProbe.previewText.includes('局部滚动')
      && layoutPrimitivesProbe.previewText.includes('侧栏加正文')
      && !layoutPrimitivesProbe.previewText.includes('Page Skeleton Composition')
      && !layoutPrimitivesProbe.previewText.includes('Layout Primitive Specimens')
      && layoutPrimitivesProbe.hasDirectCardStack
      && layoutPrimitivesProbe.specimenCount === 5
      && !layoutPrimitivesProbe.hasPanelNav
      && layoutPrimitivesProbe.hasSidebarLayout
      && layoutPrimitivesProbe.hasActionRow
      && layoutPrimitivesProbe.hasAspect
      && layoutPrimitivesProbe.hasLocalScroll
      && layoutPrimitivesProbe.sidebarLinks.length === 2
      && layoutPrimitivesProbe.sidebarLinks[0] === '#layout-primitives-stack-specimen'
      && layoutPrimitivesProbe.sidebarLinks[1] === '#layout-primitives-scroll-specimen'
      && layoutPrimitivesProbe.sidebarTargetsExist
      && layoutPrimitivesProbe.cardLabelledby === 'layout-primitives-preview-title'
      && layoutPrimitivesProbe.cardLabelText.includes('布局原语标本')
      && layoutPrimitivesProbe.scrollTopGap !== null
      && layoutPrimitivesProbe.scrollTopGap >= 12
      && layoutPrimitivesProbe.scrollTopGap <= 24
      && layoutPrimitivesProbe.scrollAreaClientHeight > 120
      && layoutPrimitivesProbe.scrollAreaScrollHeight > layoutPrimitivesProbe.scrollAreaClientHeight,
      `layout primitives preview should explain public layout utilities as clear vertical specimens: ${JSON.stringify(layoutPrimitivesProbe)}`
    );
    assert(
      layoutPrimitivesProbe.visibleLang === 'zh'
      && layoutPrimitivesProbe.visibleCode.includes('布局原语标本')
      && layoutPrimitivesProbe.visibleCode.includes('行内分布')
      && layoutPrimitivesProbe.visibleCode.includes('class="uzu-sidebar-layout"')
      && layoutPrimitivesProbe.visibleCode.includes('uzu-aspect')
      && layoutPrimitivesProbe.visibleCode.includes('uzu-scroll-area')
      && !layoutPrimitivesProbe.visibleCode.includes('Layout primitive specimens')
      && !layoutPrimitivesProbe.visibleCode.includes('Long content'),
      `Chinese layout primitives code tab should show localized specimen code: ${JSON.stringify(layoutPrimitivesProbe)}`
    );

    await openPanel(cdp, 'component-popover');
    const popoverPanel = await waitForPanel(cdp, 'component-popover', (state) => state.visiblePanel === 'component-popover');
    assertPanelState('component-popover', popoverPanel);
    const popoverProbe = await evaluate(cdp, 'component popover trigger context and localized code', `(async () => {
      const panel = document.querySelector('#component-popover');
      const preview = panel?.querySelector('#demo-popover-preview');
      const codeTab = panel?.querySelector('[data-uzu-tab-target="#demo-popover-code"]');
      const codePanel = panel?.querySelector('#demo-popover-code');
      if (!panel || !preview || !codeTab || !codePanel) throw new Error('Missing popover preview controls');
      const previewText = preview.innerText;
      const root = preview.querySelector('[data-uzu-popover]');
      const trigger = root?.querySelector('[data-uzu-popover-trigger]');
      const surface = preview.querySelector('.uzu-popover');
      const surfaceLabelledby = surface?.getAttribute('aria-labelledby') || '';
      const surfaceLabelText = surfaceLabelledby ? document.getElementById(surfaceLabelledby)?.innerText.trim() || '' : '';
      const surfaceAriaLabel = surface?.getAttribute('aria-label') || '';
      const initialHidden = surface?.hidden ?? null;
      const initialExpanded = trigger?.getAttribute('aria-expanded') || '';
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const open = root?.classList.contains('is-open') || false;
      const expandedAfterOpen = trigger?.getAttribute('aria-expanded') || '';
      const hiddenAfterOpen = surface?.hidden ?? null;
      const openAnimation = surface ? getComputedStyle(surface).animationName : '';
      const openText = preview.innerText;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 260));
      const closedAfterEscape = Boolean(surface?.hidden && !root?.classList.contains('is-open'));
      codeTab.click();
      const visiblePre = Array.from(codePanel.querySelectorAll('pre')).find((pre) =>
        !pre.hidden
        && !pre.hasAttribute('data-uzu-language-hidden')
        && getComputedStyle(pre).display !== 'none'
      );
      return {
        titleText: panel.querySelector('.uzu-section-title')?.innerText.trim() || '',
        previewText,
        hasDirectPopover: Boolean(preview.querySelector(':scope > aside.uzu-popover')),
        hasContextCard: Boolean(preview.querySelector(':scope > section.uzu-card.uzu-stack')),
        hasRuntimeRoot: Boolean(root),
        hasTriggerButton: Boolean(trigger && trigger.classList.contains('uzu-popover-trigger')),
        hasPopoverSurface: Boolean(preview.querySelector('section.uzu-card [data-uzu-popover-content].uzu-popover.uzu-stack')),
        checkboxCount: preview.querySelectorAll('.uzu-popover .uzu-check-row input[type="checkbox"]').length,
        surfaceLabelledby,
        surfaceLabelText,
        surfaceAriaLabel,
        initialHidden,
        initialExpanded,
        open,
        expandedAfterOpen,
        hiddenAfterOpen,
        openAnimation,
        openText,
        closedAfterEscape,
        visibleLang: visiblePre?.getAttribute('data-lang') || '',
        visibleCode: visiblePre?.textContent || ''
      };
    })()`);
    assert(
      popoverProbe.titleText === '浮层'
      && popoverProbe.previewText.includes('触发点旁的短设置')
      && !popoverProbe.previewText.includes('显示选项')
      && !popoverProbe.previewText.includes('Short Settings Beside A Trigger')
      && !popoverProbe.previewText.includes('Display Options')
      && !popoverProbe.hasDirectPopover
      && popoverProbe.hasContextCard
      && popoverProbe.hasRuntimeRoot
      && popoverProbe.hasTriggerButton
      && popoverProbe.hasPopoverSurface
      && popoverProbe.checkboxCount >= 2
      && popoverProbe.surfaceLabelledby === 'popover-surface-preview-title'
      && popoverProbe.surfaceLabelText.includes('显示选项')
      && popoverProbe.surfaceAriaLabel === ''
      && popoverProbe.initialHidden === true
      && popoverProbe.initialExpanded === 'false'
      && popoverProbe.open
      && popoverProbe.expandedAfterOpen === 'true'
      && popoverProbe.hiddenAfterOpen === false
      && popoverProbe.openAnimation === 'uzu-menu-in'
      && popoverProbe.openText.includes('显示选项')
      && popoverProbe.closedAfterEscape,
      `popover preview should present a real public triggered popover: ${JSON.stringify(popoverProbe)}`
    );
    assert(
      popoverProbe.visibleLang === 'zh'
      && popoverProbe.visibleCode.includes('视图设置')
      && popoverProbe.visibleCode.includes('显示选项')
      && popoverProbe.visibleCode.includes('data-uzu-popover')
      && popoverProbe.visibleCode.includes('data-uzu-popover-trigger')
      && popoverProbe.visibleCode.includes('data-uzu-popover-content')
      && popoverProbe.visibleCode.includes('hidden')
      && popoverProbe.visibleCode.includes('class="uzu-popover uzu-stack"')
      && popoverProbe.visibleCode.includes('class="uzu-check-row"')
      && !popoverProbe.visibleCode.includes('View Settings')
      && !popoverProbe.visibleCode.includes('Display Options')
      && !popoverProbe.visibleCode.includes('Show Guides'),
      `Chinese popover code tab should show localized triggered popover code: ${JSON.stringify(popoverProbe)}`
    );

    await openPanel(cdp, 'component-slider');
    const sliderPanel = await waitForPanel(cdp, 'component-slider', (state) => state.visiblePanel === 'component-slider');
    assertPanelState('component-slider', sliderPanel);
    const sliderProbe = await evaluate(cdp, 'component stepped slider preview and localized code', `(() => {
      const panel = document.querySelector('#component-slider');
      const preview = panel?.querySelector('#demo-slider-preview');
      const continuous = preview?.querySelector('#density-slider.uzu-slider');
      const stepped = preview?.querySelector('#priority-slider.uzu-slider-stepped[data-uzu-slider-stepped]');
      const codeTab = panel?.querySelector('[data-uzu-tab-target="#demo-slider-code"]');
      const codePanel = panel?.querySelector('#demo-slider-code');
      if (!panel || !preview || !continuous || !stepped || !codeTab || !codePanel) throw new Error('Missing slider preview controls');
      const steppedStyle = getComputedStyle(stepped);
      codeTab.click();
      const visiblePre = Array.from(codePanel.querySelectorAll('pre')).find((pre) =>
        !pre.hidden
        && !pre.hasAttribute('data-uzu-language-hidden')
        && getComputedStyle(pre).display !== 'none'
      );
      return {
        continuousType: continuous.getAttribute('type') || '',
        steppedType: stepped.getAttribute('type') || '',
        steppedStep: stepped.getAttribute('step') || '',
        steppedValue: stepped.value,
        continuousAriaValueText: continuous.getAttribute('aria-valuetext') || '',
        steppedAriaValueText: stepped.getAttribute('aria-valuetext') || '',
        stepCount: steppedStyle.getPropertyValue('--uzu-slider-step-count').trim(),
        stepTicks: steppedStyle.getPropertyValue('--uzu-slider-step-ticks').trim(),
        trackHeight: steppedStyle.getPropertyValue('--uzu-slider-track-height').trim(),
        thumbSize: steppedStyle.getPropertyValue('--uzu-slider-thumb-size').trim(),
        visibleLang: visiblePre?.getAttribute('data-lang') || '',
        visibleCode: visiblePre?.textContent || ''
      };
    })()`);
    assert(
      sliderProbe.continuousType === 'range'
      && sliderProbe.steppedType === 'range'
      && sliderProbe.steppedStep === '1'
      && sliderProbe.steppedValue === '4'
      && sliderProbe.continuousAriaValueText === ''
      && sliderProbe.steppedAriaValueText === ''
      && sliderProbe.stepCount === '6'
      && sliderProbe.stepTicks.includes('radial-gradient')
      && sliderProbe.trackHeight === '10px'
      && sliderProbe.thumbSize === '16px',
      `stepped slider preview should use the public finite range contract: ${JSON.stringify(sliderProbe)}`
    );
    assert(
      sliderProbe.visibleLang === 'zh'
      && sliderProbe.visibleCode.includes('优先级')
      && sliderProbe.visibleCode.includes('class="uzu-slider uzu-slider-stepped"')
      && sliderProbe.visibleCode.includes('data-uzu-slider-stepped')
      && !sliderProbe.visibleCode.includes('aria-valuetext')
      && !sliderProbe.visibleCode.includes('Priority'),
      `Chinese slider code tab should show localized stepped slider code: ${JSON.stringify(sliderProbe)}`
    );
    for (const snippet of [
      '.uzu-slider-stepped',
      '[data-uzu-slider-stepped]',
      '--uzu-slider-step-ticks'
    ]) {
      assert(vendorCss.includes(snippet), `vendor Usuzumi CSS should include stepped slider support: ${snippet}`);
    }

    await openPanel(cdp, 'component-input-group');
    const inputGroupPanel = await waitForPanel(cdp, 'component-input-group', (state) => state.visiblePanel === 'component-input-group');
    assertPanelState('component-input-group', inputGroupPanel);
    const inputGroupProbe = await evaluate(cdp, 'component input group selectable suffix', `(async () => {
      const panel = document.querySelector('#component-input-group');
      const preview = panel?.querySelector('#demo-input-group-preview');
      const group = preview?.querySelector('.uzu-input-group');
      const input = group?.querySelector('.uzu-input');
      const action = group?.querySelector('.uzu-input-action');
      const select = group?.querySelector('[data-uzu-select]');
      const trigger = select?.querySelector('[data-uzu-select-trigger]');
      const menu = select?.querySelector('.uzu-select-menu');
      const eur = select?.querySelector('[data-value="eur"]');
      if (!panel || !preview || !group || !input || !action || !select || !trigger || !menu || !eur) throw new Error('Missing input group selectable suffix');
      const baseBorder = getComputedStyle(group).borderTopColor;
      const focusVisible = (target) => {
        try {
          target.focus({ focusVisible: true });
        } catch (_) {
          target.focus();
        }
      };
      const readAttachedFocus = async (target, surface) => {
        focusVisible(target);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const surfaceStyle = getComputedStyle(surface);
        const targetStyle = getComputedStyle(target);
        const result = {
          active: document.activeElement === target,
          border: surfaceStyle.borderTopColor,
          shadow: surfaceStyle.boxShadow,
          targetShadow: targetStyle.boxShadow,
          outlineStyle: targetStyle.outlineStyle,
          outlineWidth: targetStyle.outlineWidth,
          outlineOffset: targetStyle.outlineOffset
        };
        target.blur();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return result;
      };
      const triggerFocus = await readAttachedFocus(trigger, group);
      const actionFocus = await readAttachedFocus(action, group);
      input.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const inputFocus = {
        active: document.activeElement === input,
        border: getComputedStyle(group).borderTopColor,
        shellShadow: getComputedStyle(group).boxShadow,
        inputShadow: getComputedStyle(input).boxShadow
      };
      input.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const before = {
        staticUsdAddon: Boolean(Array.from(group.querySelectorAll('.uzu-input-addon')).find((addon) => addon.textContent.trim() === 'USD')),
        selectedValue: select.dataset.uzuSelectValue || '',
        label: trigger.textContent.trim(),
        baseBorder,
        triggerFocus,
        actionFocus,
        inputFocus,
        triggerBorderWidth: getComputedStyle(trigger).borderTopWidth,
        triggerBackground: getComputedStyle(trigger).backgroundColor
      };
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const groupRect = group.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const afterOpen = {
        menuDisplay: getComputedStyle(menu).display,
        openAnimation: getComputedStyle(menu).animationName,
        expanded: trigger.getAttribute('aria-expanded'),
        menuEscapesGroup: menuRect.bottom > groupRect.bottom + 2
      };
      eur.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const afterChoose = {
        selectedValue: select.dataset.uzuSelectValue || '',
        label: trigger.textContent.trim(),
        expanded: trigger.getAttribute('aria-expanded')
      };
      return { before, afterOpen, afterChoose };
    })()`);
    assert(
      !inputGroupProbe.before.staticUsdAddon
      && inputGroupProbe.before.selectedValue === 'usd'
      && inputGroupProbe.before.label === 'USD'
      && inputGroupProbe.before.triggerFocus.active
      && inputGroupProbe.before.triggerFocus.border === inputGroupProbe.before.baseBorder
      && inputGroupProbe.before.triggerFocus.shadow === 'none'
      && inputGroupProbe.before.triggerFocus.targetShadow === 'none'
      && inputGroupProbe.before.triggerFocus.outlineStyle === 'solid'
      && Number.parseFloat(inputGroupProbe.before.triggerFocus.outlineWidth) >= 1
      && inputGroupProbe.before.actionFocus.active
      && inputGroupProbe.before.actionFocus.border === inputGroupProbe.before.baseBorder
      && inputGroupProbe.before.actionFocus.shadow === 'none'
      && inputGroupProbe.before.actionFocus.targetShadow === 'none'
      && inputGroupProbe.before.actionFocus.outlineStyle === 'solid'
      && Number.parseFloat(inputGroupProbe.before.actionFocus.outlineWidth) >= 1
      && inputGroupProbe.before.inputFocus.active
      && inputGroupProbe.before.inputFocus.border !== inputGroupProbe.before.baseBorder
      && inputGroupProbe.before.inputFocus.shellShadow === 'none'
      && inputGroupProbe.before.inputFocus.inputShadow === 'none'
      && inputGroupProbe.before.triggerBorderWidth === '0px'
      && inputGroupProbe.before.triggerBackground,
      `input group suffix should start as an attached selectable control and only the real input should trigger the outer focus border: ${JSON.stringify(inputGroupProbe)}`
    );
    assert(
      inputGroupProbe.afterOpen.menuDisplay === 'grid'
      && inputGroupProbe.afterOpen.openAnimation === 'uzu-menu-in'
      && inputGroupProbe.afterOpen.expanded === 'true'
      && inputGroupProbe.afterOpen.menuEscapesGroup,
      `input group suffix select should open without being clipped by the group shell: ${JSON.stringify(inputGroupProbe)}`
    );
    assert(
      inputGroupProbe.afterChoose.selectedValue === 'eur'
      && inputGroupProbe.afterChoose.label === 'EUR'
      && inputGroupProbe.afterChoose.expanded === 'false',
      `input group suffix select should choose and sync currency: ${JSON.stringify(inputGroupProbe)}`
    );

    await openPanel(cdp, 'component-stepper');
    const stepperPanel = await waitForPanel(cdp, 'component-stepper', (state) => state.visiblePanel === 'component-stepper');
    assertPanelState('component-stepper', stepperPanel);
    const stepperProbe = await evaluate(cdp, 'component stepper edit focus boundary', `(async () => {
      const panel = document.querySelector('#component-stepper');
      const stepper = panel?.querySelector('#demo-stepper-preview .uzu-stepper');
      const input = stepper?.querySelector('.uzu-stepper-input');
      const increment = stepper?.querySelector('[data-uzu-stepper-increment]');
      if (!panel || !stepper || !input || !increment) throw new Error('Missing stepper preview controls');
      const baseBorder = getComputedStyle(stepper).borderTopColor;
      const focusVisible = (target) => {
        try {
          target.focus({ focusVisible: true });
        } catch (_) {
          target.focus();
        }
      };
      focusVisible(increment);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const stepperStyle = getComputedStyle(stepper);
      const incrementStyle = getComputedStyle(increment);
      const buttonFocus = {
        active: document.activeElement === increment,
        border: stepperStyle.borderTopColor,
        shadow: stepperStyle.boxShadow,
        targetShadow: incrementStyle.boxShadow,
        outlineStyle: incrementStyle.outlineStyle,
        outlineWidth: incrementStyle.outlineWidth,
        outlineOffset: incrementStyle.outlineOffset
      };
      increment.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
      input.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const inputFocus = {
        active: document.activeElement === input,
        border: getComputedStyle(stepper).borderTopColor,
        shellShadow: getComputedStyle(stepper).boxShadow,
        inputShadow: getComputedStyle(input).boxShadow
      };
      input.blur();
      return { baseBorder, buttonFocus, inputFocus };
    })()`);
    assert(
      stepperProbe.buttonFocus.active
      && stepperProbe.buttonFocus.border === stepperProbe.baseBorder
      && stepperProbe.buttonFocus.shadow === 'none'
      && stepperProbe.buttonFocus.targetShadow === 'none'
      && stepperProbe.buttonFocus.outlineStyle === 'solid'
      && Number.parseFloat(stepperProbe.buttonFocus.outlineWidth) >= 1
      && stepperProbe.inputFocus.active
      && stepperProbe.inputFocus.border !== stepperProbe.baseBorder
      && stepperProbe.inputFocus.shellShadow === 'none'
      && stepperProbe.inputFocus.inputShadow === 'none',
      `stepper preview should only strengthen the outer edit border when the number input is focused: ${JSON.stringify(stepperProbe)}`
    );

    await openPanel(cdp, 'component-search');
    const searchPanel = await waitForPanel(cdp, 'component-search', (state) => state.visiblePanel === 'component-search');
    assertPanelState('component-search', searchPanel);
    const searchProbe = await evaluate(cdp, 'component search localized code and clear icon', `(() => {
      const panel = document.querySelector('#component-search');
      const codeTab = panel?.querySelector('[data-uzu-tab-target="#demo-search-code"]');
      const codePanel = panel?.querySelector('#demo-search-code');
      const input = panel?.querySelector('#demo-search-preview .uzu-search-input');
      const clear = panel?.querySelector('#demo-search-preview [data-uzu-search-clear]');
      if (!panel || !codeTab || !codePanel || !input || !clear) throw new Error('Missing search preview controls');
      codeTab.click();
      const visiblePre = Array.from(codePanel.querySelectorAll('pre')).find((pre) =>
        !pre.hidden
        && !pre.hasAttribute('data-uzu-language-hidden')
        && getComputedStyle(pre).display !== 'none'
      );
      const clearStyle = getComputedStyle(clear);
      return {
        visibleLang: visiblePre?.getAttribute('data-lang') || '',
        visibleCode: visiblePre?.textContent || '',
        clearHasSvg: Boolean(clear.querySelector('svg')),
        clearText: clear.textContent.trim(),
        clearWidth: clearStyle.width,
        clearHeight: clearStyle.height,
        clearBorderWidth: clearStyle.borderTopWidth,
        clearBorderRadius: clearStyle.borderTopLeftRadius,
        clearBackground: clearStyle.backgroundColor,
        clearBoxShadow: clearStyle.boxShadow,
        clearBackdropFilter: clearStyle.backdropFilter || clearStyle.webkitBackdropFilter || ''
      };
    })()`);
    assert(
      searchProbe.visibleLang === 'zh'
      && searchProbe.visibleCode.includes('value="组件"')
      && searchProbe.visibleCode.includes('aria-label="清空搜索"')
      && !searchProbe.visibleCode.includes('value="button"'),
      `Chinese search code tab should show localized code: ${JSON.stringify(searchProbe)}`
    );
    assert(searchProbe.clearHasSvg && searchProbe.clearText === '', `search clear button should be icon-only: ${JSON.stringify(searchProbe)}`);
    assert(
      searchProbe.clearWidth === '32px'
      && searchProbe.clearHeight === '32px'
      && searchProbe.clearBorderWidth === '0px'
      && Number.parseFloat(searchProbe.clearBorderRadius) <= 12
      && (searchProbe.clearBackground === 'rgba(0, 0, 0, 0)' || searchProbe.clearBackground === 'transparent')
      && searchProbe.clearBoxShadow === 'none'
      && ['none', ''].includes(searchProbe.clearBackdropFilter),
      `search clear button should render as a quiet embedded input action: ${JSON.stringify(searchProbe)}`
    );
    for (const snippet of [
      '.uzu-search-input::-webkit-search-cancel-button',
      'pointer-events: none',
      '-webkit-appearance: none'
    ]) {
      assert(vendorCss.includes(snippet), `vendor Usuzumi CSS should hide native search controls: ${snippet}`);
    }

    await openPanel(cdp, 'component-password');
    const passwordPanel = await waitForPanel(cdp, 'component-password', (state) => state.visiblePanel === 'component-password');
    assertPanelState('component-password', passwordPanel);
    const passwordProbe = await evaluate(cdp, 'component password embedded toggle', `(() => {
      const panel = document.querySelector('#component-password');
      const toggle = panel?.querySelector('#demo-password-preview [data-uzu-password-toggle]');
      if (!panel || !toggle) throw new Error('Missing password toggle');
      const style = getComputedStyle(toggle);
      return {
        hasSvg: Boolean(toggle.querySelector('svg')),
        text: toggle.textContent.trim(),
        width: style.width,
        height: style.height,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || ''
      };
    })()`);
    assert(
      passwordProbe.hasSvg
      && passwordProbe.text === ''
      && passwordProbe.width === '32px'
      && passwordProbe.height === '32px'
      && passwordProbe.borderWidth === '0px'
      && Number.parseFloat(passwordProbe.borderRadius) <= 12
      && (passwordProbe.background === 'rgba(0, 0, 0, 0)' || passwordProbe.background === 'transparent')
      && passwordProbe.boxShadow === 'none'
      && ['none', ''].includes(passwordProbe.backdropFilter),
      `password toggle should render as a quiet embedded icon action: ${JSON.stringify(passwordProbe)}`
    );

    await openPanel(cdp, 'component-toast');
    const toastPanel = await waitForPanel(cdp, 'component-toast', (state) => state.visiblePanel === 'component-toast');
    assertPanelState('component-toast', toastPanel);
    const toastProbe = await evaluate(cdp, 'component toast trigger and localized code', `(async () => {
      const panel = document.querySelector('#component-toast');
      const preview = panel?.querySelector('#demo-toast-preview');
      const trigger = preview?.querySelector('[data-uzu-toast-trigger]');
      const stack = preview?.querySelector('#demo-toast-stack');
      const codeTab = panel?.querySelector('[data-uzu-tab-target="#demo-toast-code"]');
      const codePanel = panel?.querySelector('#demo-toast-code');
      if (!panel || !preview || !trigger || !stack || !codeTab || !codePanel) throw new Error('Missing toast preview controls');
      const isHidden = (element) => element.hasAttribute('data-uzu-language-hidden') || getComputedStyle(element).display === 'none';
      const initialCount = stack.querySelectorAll('[data-uzu-toast]').length;
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const toast = stack.querySelector('[data-uzu-toast]');
      const visibleTitle = Array.from(toast?.querySelectorAll('h3 [data-lang]') || []).find((element) => !isHidden(element));
      const visibleClose = Array.from(toast?.querySelectorAll('[data-uzu-toast-close]') || []).find((element) => !isHidden(element));
      const afterOpenCount = stack.querySelectorAll('[data-uzu-toast]').length;
      const afterOpen = {
        initialCount,
        afterOpenCount,
        visibleTitle: visibleTitle?.textContent.trim() || '',
        visibleCloseLabel: visibleClose?.getAttribute('aria-label') || '',
        visibleCloseHasSvg: Boolean(visibleClose?.querySelector('svg')),
        role: toast?.getAttribute('role') || '',
        live: toast?.getAttribute('aria-live') || ''
      };
      visibleClose?.click();
      await new Promise((resolve) => setTimeout(resolve, 260));
      codeTab.click();
      const visiblePre = Array.from(codePanel.querySelectorAll('pre')).find((pre) =>
        !pre.hidden
        && !pre.hasAttribute('data-uzu-language-hidden')
        && getComputedStyle(pre).display !== 'none'
      );
      return {
        ...afterOpen,
        removedAfterClose: !stack.querySelector('[data-uzu-toast]'),
        visibleCodeLang: visiblePre?.getAttribute('data-lang') || '',
        visibleCode: visiblePre?.textContent || ''
      };
    })()`);
    assert(
      toastProbe.initialCount === 0
      && toastProbe.afterOpenCount === 1
      && toastProbe.visibleTitle === '已保存'
      && toastProbe.visibleCloseLabel === '关闭 Toast'
      && toastProbe.visibleCloseHasSvg
      && toastProbe.role === 'status'
      && toastProbe.live === 'polite'
      && toastProbe.removedAfterClose,
      `toast preview should create and close a localized toast only after interaction: ${JSON.stringify(toastProbe)}`
    );
    assert(
      toastProbe.visibleCodeLang === 'zh'
      && toastProbe.visibleCode.includes('显示 Toast')
      && toastProbe.visibleCode.includes('已保存')
      && !toastProbe.visibleCode.includes('Show Toast'),
      `Chinese toast code tab should show localized trigger code: ${JSON.stringify(toastProbe)}`
    );

    await openPanel(cdp, 'component-typography');
    const typographyPanel = await panelState(cdp, 'component-typography');
    assertPanelState('component-typography', typographyPanel);
    const typographyLayout = await evaluate(cdp, 'typography preview layout', `(() => {
      const preview = document.querySelector('#demo-typography-preview');
      const surface = preview?.querySelector('.uzu-card > .uzu-surface-soft');
      return {
        previewGridCount: preview?.querySelectorAll('.uzu-grid').length ?? -1,
        surfaceSectionCount: surface?.querySelectorAll(':scope > section').length ?? 0,
        surfaceSeparatorCount: surface?.querySelectorAll(':scope > .uzu-separator').length ?? 0
      };
    })()`);
    assert(
      typographyLayout.previewGridCount === 0
        && typographyLayout.surfaceSectionCount >= 6
        && typographyLayout.surfaceSeparatorCount >= 5,
      `typography preview should use one vertical specimen surface: ${JSON.stringify(typographyLayout)}`
    );
    const typographySpecimens = await evaluate(cdp, 'typography specimen containment', `(() => {
      const makeTextRect = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        range.detach?.();
        return rect;
      };
      const specimens = [
        { role: 'uzu-signature', selector: '#demo-typography-preview .uzu-signature' },
        { role: 'uzu-hero-title', selector: '#demo-typography-preview .uzu-hero-title' },
        { role: 'uzu-page-title', selector: '#demo-typography-preview .uzu-page-title' },
        { role: 'uzu-section-title', selector: '#demo-typography-preview .uzu-section-title' }
      ];
      return specimens
        .map((specimen) => {
          const element = document.querySelector(specimen.selector);
          if (!element) return { label: specimen.role, missing: true };
          const preview = element.closest('.uzu-surface-soft');
          const card = element.closest('.uzu-card');
          if (!preview || !card) return { label: specimen.role, missingSurface: !preview, missingCard: !card };
          const previewStyle = getComputedStyle(preview);
          const cardRect = card.getBoundingClientRect();
          const previewRect = preview.getBoundingClientRect();
          const textRect = makeTextRect(element);
          return {
            label: specimen.role,
            className: element.className,
            isScrollArea: preview.classList.contains('uzu-scroll-area'),
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
      assert(!specimen.missing && !specimen.missingSurface && !specimen.missingCard, `typography specimen is missing its public preview structure: ${JSON.stringify(specimen)}`);
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
        !specimen.isScrollArea && specimen.previewOverflowY !== 'auto' && specimen.previewMaxHeight === 'none',
        `typography specimen preview should not use a fixed-height scroll container: ${JSON.stringify(specimen)}`
      );
    }

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
