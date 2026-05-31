import { javascript } from '@codemirror/lang-javascript';
import { Editor } from '@tiptap/core';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { basicSetup, EditorView } from 'codemirror';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

const activeRichEditors = new WeakMap();
const activeCodeEditors = new WeakMap();
const activeMarkdownEditors = new WeakSet();

function emit(target, name, detail) {
  target.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail
  }));
}

function setCommandState(button, active) {
  button.classList.toggle('is-active', active);
  if (button.hasAttribute('data-uzu-editor-toggle')) {
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function updateToolbarState(shell, editor) {
  shell.querySelectorAll('[data-uzu-editor-command]').forEach((button) => {
    const command = button.dataset.uzuEditorCommand || '';
    const value = button.dataset.uzuEditorValue || '';
    let active = false;
    if (command === 'heading') active = editor.isActive('heading', { level: Number(value || 3) });
    else if (command === 'bulletList') active = editor.isActive('bulletList');
    else if (command === 'orderedList') active = editor.isActive('orderedList');
    else if (command) active = editor.isActive(command);
    setCommandState(button, active);
  });
}

function runTiptapCommand(editor, command, value) {
  const chain = editor.chain().focus();
  if (command === 'bold') return chain.toggleBold().run();
  if (command === 'italic') return chain.toggleItalic().run();
  if (command === 'underline') return chain.toggleUnderline().run();
  if (command === 'bulletList') return chain.toggleBulletList().run();
  if (command === 'orderedList') return chain.toggleOrderedList().run();
  if (command === 'heading') return chain.toggleHeading({ level: Number(value || 3) }).run();
  return false;
}

function initRichEditor(shell) {
  const surface = shell.querySelector('[data-uzu-editor-surface]');
  if (!surface || activeRichEditors.has(shell)) return;
  const editor = new Editor({
    element: surface,
    extensions: [StarterKit, Underline],
    content: `
      <h3>Usuzumi editor bridge</h3>
      <p>Edit this Tiptap document. The toolbar above is styled by Usuzumi and sends commands through <code>uzu-editor-command</code>.</p>
      <ul><li>The document model, selection, history, and keyboard behavior come from Tiptap.</li></ul>
    `,
    editorProps: {
      attributes: {
        'aria-label': 'Tiptap rich text editor',
        class: 'uzu-tiptap-editor'
      }
    },
    onCreate: ({ editor: instance }) => {
      updateToolbarState(shell, instance);
      shell.dataset.editorReady = 'tiptap';
    },
    onSelectionUpdate: ({ editor: instance }) => updateToolbarState(shell, instance),
    onUpdate: ({ editor: instance }) => {
      updateToolbarState(shell, instance);
      emit(shell, 'uzu-editor-change', {
        editor: shell,
        surface,
        value: instance.getHTML()
      });
    }
  });
  activeRichEditors.set(shell, editor);
  shell.addEventListener('uzu-editor-command', (event) => {
    const { button, command, value } = event.detail;
    if (!runTiptapCommand(editor, command, value)) return;
    if (button) {
      const active = command === 'heading'
        ? editor.isActive('heading', { level: Number(value || 3) })
        : editor.isActive(command);
      setCommandState(button, active);
    }
    updateToolbarState(shell, editor);
  });
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
  if (activeMarkdownEditors.has(shell)) return;
  const source = shell.querySelector('[data-uzu-markdown-source]');
  if (!source) return;
  activeMarkdownEditors.add(shell);
  shell.dataset.editorReady = 'markdown-it';
  renderMarkdown(shell);
  shell.addEventListener('uzu-markdown-editor-change', () => renderMarkdown(shell));
}

function initCodeEditor(shell) {
  const mount = shell.querySelector('[data-code-editor-mount]');
  if (!mount || activeCodeEditors.has(shell)) return;
  const view = new EditorView({
    parent: mount,
    doc: `const theme = {
  surface: "var(--uzu-surface)",
  accent: "var(--uzu-accent)"
};

console.log(theme);`,
    extensions: [
      basicSetup,
      javascript(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          minHeight: '260px',
          color: 'var(--uzu-text)',
          backgroundColor: 'var(--uzu-surface)'
        },
        '.cm-content': {
          minHeight: '260px',
          padding: '14px'
        },
        '.cm-gutters': {
          backgroundColor: 'var(--uzu-surface-soft)',
          color: 'var(--uzu-text-muted)',
          borderRightColor: 'var(--uzu-border)'
        },
        '.cm-activeLine': {
          backgroundColor: 'color-mix(in srgb, var(--uzu-accent) 8%, transparent)'
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'color-mix(in srgb, var(--uzu-accent) 10%, var(--uzu-surface-soft))'
        },
        '&.cm-focused': {
          outline: 'none'
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: 'var(--uzu-text)'
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
          backgroundColor: 'color-mix(in srgb, var(--uzu-accent) 22%, transparent)'
        }
      })
    ]
  });
  activeCodeEditors.set(shell, view);
  shell.dataset.editorReady = 'codemirror';
}

function isVisible(element) {
  return Boolean(element.offsetParent || element.getClientRects().length);
}

function initVisibleEditors(root = document) {
  root.querySelectorAll('[data-uzu-rich-editor]').forEach((shell) => {
    if (isVisible(shell)) initRichEditor(shell);
  });
  root.querySelectorAll('[data-uzu-markdown-editor]').forEach((shell) => {
    if (isVisible(shell)) initMarkdownEditor(shell);
  });
  root.querySelectorAll('[data-code-editor-shell]').forEach((shell) => {
    if (isVisible(shell)) initCodeEditor(shell);
  });
}

function initComponentEditors() {
  initVisibleEditors(document);
  document.addEventListener('uzu-panel-show', (event) => {
    initVisibleEditors(event.detail?.panel || document);
  });
  window.addEventListener('resize', () => initVisibleEditors(document));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initComponentEditors, { once: true });
} else {
  initComponentEditors();
}

export { initComponentEditors };
