import { MarkdownIt } from '../runtime/markdown-editor-deps.js';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});
const activeMarkdownEditors = new WeakSet();

function emit(target, name, detail) {
  target.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail
  }));
}

function isVisible(element) {
  return Boolean(element.offsetParent || element.getClientRects().length);
}

function renderMarkdown(shell) {
  const source = shell.querySelector('[data-uzu-markdown-source]');
  const preview = shell.querySelector('[data-uzu-markdown-preview]');
  if (!source || !preview) return;
  const value = source.value || '';
  shell.dataset.uzuMarkdownValue = value;
  preview.innerHTML = markdown.render(value);
  window.Usuzumi?.init(preview);
  emit(shell, 'uzu-markdown-editor-render', {
    editor: shell,
    source,
    preview,
    value
  });
}

function initMarkdownEditor(shell) {
  const source = shell.querySelector('[data-uzu-markdown-source]');
  if (!source || activeMarkdownEditors.has(shell)) return;
  activeMarkdownEditors.add(shell);
  shell.dataset.editorReady = 'markdown-it';
  renderMarkdown(shell);
  shell.addEventListener('uzu-markdown-editor-change', () => renderMarkdown(shell));
}

function initMarkdownEditors(root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  scope.querySelectorAll('[data-uzu-markdown-editor]').forEach((shell) => {
    if (isVisible(shell)) initMarkdownEditor(shell);
  });
}

function bootMarkdownEditors() {
  initMarkdownEditors(document);
  document.addEventListener('uzu-panel-show', (event) => {
    initMarkdownEditors(event.detail?.panel || event.target);
  });
  window.addEventListener('resize', () => initMarkdownEditors(document));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMarkdownEditors, { once: true });
} else {
  bootMarkdownEditors();
}

window.UsuzumiComponentMarkdownEditor = {
  initMarkdownEditor,
  initMarkdownEditors
};

export { initMarkdownEditor, initMarkdownEditors };
