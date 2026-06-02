const currentScript = document.currentScript;
const assetBase = currentScript?.src ? new URL('.', currentScript.src) : new URL('components/assets/', window.location.href);
const loadingBundles = new Map();

const editorBundles = [
  {
    key: 'rich',
    selector: '[data-uzu-rich-editor]',
    src: 'rich-editor.js',
    globalName: 'UsuzumiComponentRichEditor',
    initName: 'initRichEditors'
  },
  {
    key: 'markdown',
    selector: '[data-uzu-markdown-editor]',
    src: 'markdown-editor.js',
    globalName: 'UsuzumiComponentMarkdownEditor',
    initName: 'initMarkdownEditors'
  },
  {
    key: 'code',
    selector: '[data-code-editor-shell]',
    src: 'code-editor.js',
    globalName: 'UsuzumiComponentCodeEditor',
    initName: 'initCodeEditors'
  }
];

function isVisible(element) {
  return Boolean(element.offsetParent || element.getClientRects().length);
}

function getScope(root) {
  return root instanceof Element || root instanceof Document ? root : document;
}

function hasVisibleTarget(bundle, root = document) {
  return [...getScope(root).querySelectorAll(bundle.selector)].some(isVisible);
}

function loadBundle(bundle) {
  if (window[bundle.globalName]) return Promise.resolve(window[bundle.globalName]);
  if (loadingBundles.has(bundle.key)) return loadingBundles.get(bundle.key);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(bundle.src, assetBase).href;
    script.async = true;
    script.onload = () => resolve(window[bundle.globalName]);
    script.onerror = () => reject(new Error(`Failed to load ${bundle.src}`));
    document.head.append(script);
  });
  loadingBundles.set(bundle.key, promise);
  return promise;
}

function initBundle(bundle, root) {
  const api = window[bundle.globalName];
  const init = api?.[bundle.initName];
  if (typeof init === 'function') init(root);
}

function loadVisibleEditors(root = document) {
  editorBundles.forEach((bundle) => {
    if (!hasVisibleTarget(bundle, root)) return;
    loadBundle(bundle)
      .then(() => initBundle(bundle, root))
      .catch((error) => console.warn('[usuzumi-site] editor bundle failed to load', error));
  });
}

function bootEditorLoader() {
  loadVisibleEditors(document);
  document.addEventListener('uzu-panel-show', (event) => {
    loadVisibleEditors(event.detail?.panel || event.target);
  });
  window.addEventListener('resize', () => loadVisibleEditors(document));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootEditorLoader, { once: true });
} else {
  bootEditorLoader();
}

window.UsuzumiComponentEditorLoader = {
  loadVisibleEditors
};

export { loadVisibleEditors };
