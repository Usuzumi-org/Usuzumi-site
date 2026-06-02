import { basicSetup, EditorView, javascript } from '../runtime/code-editor-deps.js';

const activeCodeEditors = new WeakMap();

function isVisible(element) {
  return Boolean(element.offsetParent || element.getClientRects().length);
}

function initCodeEditor(shell) {
  const mount = shell.querySelector('[data-code-editor-mount]');
  if (!mount || activeCodeEditors.has(shell)) return null;
  const view = new EditorView({
    parent: mount,
    doc: `const theme = {
  surface: "var(--uzu-surface)",
  accent: "var(--uzu-fg-strong)"
};

console.log(theme);`,
    extensions: [
      basicSetup,
      javascript(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          minHeight: '260px',
          color: 'var(--uzu-fg)',
          backgroundColor: 'var(--uzu-surface)'
        },
        '.cm-content': {
          minHeight: '260px',
          padding: '14px'
        },
        '.cm-gutters': {
          backgroundColor: 'var(--uzu-surface-soft)',
          color: 'var(--uzu-muted)',
          borderRightColor: 'var(--uzu-border)'
        },
        '.cm-activeLine': {
          backgroundColor: 'color-mix(in srgb, var(--uzu-fg-strong) 8%, transparent)'
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'color-mix(in srgb, var(--uzu-fg-strong) 10%, var(--uzu-surface-soft))'
        },
        '&.cm-focused': {
          outline: 'none'
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: 'var(--uzu-fg-strong)'
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
          backgroundColor: 'color-mix(in srgb, var(--uzu-fg-strong) 22%, transparent)'
        }
      })
    ]
  });
  activeCodeEditors.set(shell, view);
  shell.dataset.editorReady = 'codemirror';
  return view;
}

function initCodeEditors(root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  scope.querySelectorAll('[data-code-editor-shell]').forEach((shell) => {
    if (isVisible(shell)) initCodeEditor(shell);
  });
}

function bootCodeEditors() {
  initCodeEditors(document);
  document.addEventListener('uzu-panel-show', (event) => {
    initCodeEditors(event.detail?.panel || event.target);
  });
  window.addEventListener('resize', () => initCodeEditors(document));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCodeEditors, { once: true });
} else {
  bootCodeEditors();
}

window.UsuzumiComponentCodeEditor = {
  initCodeEditor,
  initCodeEditors
};

export { initCodeEditor, initCodeEditors };
