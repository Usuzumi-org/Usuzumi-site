import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import html from '@shikijs/langs/html';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import markdown from '@shikijs/langs/markdown';
import typescript from '@shikijs/langs/typescript';
import githubDark from '@shikijs/themes/github-dark-default';
import githubLight from '@shikijs/themes/github-light-default';

(() => {
  const supportedLanguages = new Set([
    'bash',
    'css',
    'html',
    'javascript',
    'js',
    'json',
    'markdown',
    'md',
    'shell',
    'sh',
    'text',
    'ts',
    'typescript'
  ]);

  const languageAliases = {
    js: 'javascript',
    md: 'markdown',
    shell: 'bash',
    sh: 'bash',
    ts: 'typescript'
  };

  const highlighterPromise = createHighlighterCore({
    langs: [bash, css, html, javascript, json, markdown, typescript],
    themes: [githubLight, githubDark],
    engine: createJavaScriptRegexEngine()
  });

  function getCurrentTheme() {
    const theme = document.documentElement.dataset.theme || document.documentElement.dataset.uzuTheme;
    return theme === 'dark' ? 'github-dark-default' : 'github-light-default';
  }

  function getLanguage(code) {
    const classLanguage = [...code.classList]
      .find((className) => className.startsWith('language-'))
      ?.replace(/^language-/, '');
    const rawLanguage = code.dataset.uzuCodeLanguage || classLanguage || inferLanguage(code.textContent || '');
    const normalized = languageAliases[rawLanguage] || rawLanguage;
    return supportedLanguages.has(normalized) ? normalized : 'text';
  }

  function inferLanguage(value) {
    const text = value.trim();
    if (!text) return 'text';
    if (/^</.test(text)) return 'html';
    if (/^(\{|\[)/.test(text)) return 'json';
    if (/^(:root|\.|#|@media|--uzu-)/.test(text) || /--uzu-[\w-]+\s*:/.test(text)) return 'css';
    if (/^(npm|node|git|cd|mkdir|cp|rm)\b/m.test(text)) return 'bash';
    if (/^(#|\- |\* |\d+\. )/m.test(text)) return 'markdown';
    if (/\b(import|export|const|let|function|return|document|window)\b/.test(text)) return 'javascript';
    return 'text';
  }

  function parseHighlightedPre(htmlText) {
    const template = document.createElement('template');
    template.innerHTML = htmlText.trim();
    return template.content.querySelector('pre');
  }

  async function highlightCodeBlock(code) {
    if (!(code instanceof HTMLElement)) return;
    const source = code.dataset.uzuCodeSource || code.textContent || '';
    const language = getLanguage(code);
    const theme = getCurrentTheme();
    if (code.dataset.uzuSyntaxHighlighted === `${language}:${theme}`) return;

    try {
      const highlighter = await highlighterPromise;
      const highlightedPre = parseHighlightedPre(highlighter.codeToHtml(source, { lang: language, theme }));
      const highlightedCode = highlightedPre?.querySelector('code');
      if (!highlightedCode) return;

      code.dataset.uzuCodeSource = source;
      code.dataset.uzuCodeLanguage = language;
      code.dataset.uzuSyntaxHighlighted = `${language}:${theme}`;
      code.classList.add(`language-${language}`);
      code.replaceChildren(...[...highlightedCode.childNodes].map((node) => node.cloneNode(true)));

      const pre = code.closest('pre');
      if (pre) {
        pre.style.setProperty('--uzu-code-block-bg', highlightedPre.style.background || 'var(--uzu-surface-inset)');
      }
    } catch (error) {
      console.warn('[usuzumi-site] Failed to highlight code block', error);
    }
  }

  function highlightAll(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    const blocks = scope.querySelectorAll('.uzu-code-block pre code, pre.uzu-code-block-body code');
    blocks.forEach((code) => {
      highlightCodeBlock(code);
    });
  }

  function scheduleHighlight(root = document) {
    window.requestAnimationFrame(() => highlightAll(root));
  }

  document.addEventListener('DOMContentLoaded', () => scheduleHighlight());
  document.addEventListener('uzu-panel-show', (event) => scheduleHighlight(event.target));
  document.addEventListener('uzu-tabs-change', (event) => {
    const panel = event.detail?.panel || event.target;
    scheduleHighlight(panel);
  });

  const observer = new MutationObserver(() => scheduleHighlight());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-uzu-theme']
  });

  window.UsuzumiSiteCodeHighlight = {
    highlightAll,
    highlightCodeBlock
  };
})();
