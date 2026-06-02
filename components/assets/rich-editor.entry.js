import {
  Editor,
  Highlight,
  Link,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  TaskItem,
  TaskList,
  TextAlign,
  Underline,
  StarterKit
} from '../runtime/rich-editor-deps.js';

const activeRichEditors = new WeakMap();

function emit(target, name, detail) {
  target.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail
  }));
}

function isVisible(element) {
  return Boolean(element.offsetParent || element.getClientRects().length);
}

function setCommandState(button, active) {
  button.classList.toggle('is-active', active);
  if (button.hasAttribute('data-uzu-editor-toggle')) {
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function setCommandAvailability(button, available) {
  button.disabled = !available;
  button.setAttribute('aria-disabled', available ? 'false' : 'true');
}

function getToolbarLinkTarget(shell) {
  const input = shell.querySelector('[data-uzu-editor-link-target]');
  return input?.value?.trim() || 'https://tiptap.dev';
}

function getTableCommandState(editor) {
  const inTable = editor.isActive('table');
  return {
    insertTable: editor.can().chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    addColumnAfter: editor.can().chain().focus().addColumnAfter().run(),
    addRowAfter: editor.can().chain().focus().addRowAfter().run(),
    horizontalRule: editor.can().chain().focus().setHorizontalRule().run(),
    clearFormatting: editor.can().chain().focus().unsetAllMarks().clearNodes().run(),
    inTable
  };
}

function getCommandActiveState(editor, command, value) {
  if (command === 'paragraph') return editor.isActive('paragraph');
  if (command === 'heading') return editor.isActive('heading', { level: Number(value || 3) });
  if (command === 'bulletList') return editor.isActive('bulletList');
  if (command === 'orderedList') return editor.isActive('orderedList');
  if (command === 'taskList') return editor.isActive('taskList');
  if (command === 'blockquote') return editor.isActive('blockquote');
  if (command === 'codeBlock') return editor.isActive('codeBlock');
  if (command === 'align') return editor.isActive({ textAlign: value || 'left' });
  if (command === 'highlight') return editor.isActive('highlight');
  if (command === 'link') return editor.isActive('link');
  if (command === 'unlink') return false;
  if (command === 'table') return editor.isActive('table');
  if (command === 'tableRow') return editor.isActive('tableRow');
  if (command === 'tableHeader') return editor.isActive('tableHeader');
  if (command === 'tableCell') return editor.isActive('tableCell');
  if (command) return editor.isActive(command);
  return false;
}

function updateToolbarState(shell, editor) {
  const tableState = getTableCommandState(editor);
  shell.querySelectorAll('[data-uzu-editor-command]').forEach((button) => {
    const command = button.dataset.uzuEditorCommand || '';
    const value = button.dataset.uzuEditorValue || '';
    setCommandState(button, getCommandActiveState(editor, command, value));
    if (command === 'insertTable') setCommandAvailability(button, tableState.insertTable);
    if (command === 'addColumnAfter') setCommandAvailability(button, tableState.inTable && tableState.addColumnAfter);
    if (command === 'addRowAfter') setCommandAvailability(button, tableState.inTable && tableState.addRowAfter);
    if (command === 'horizontalRule') setCommandAvailability(button, tableState.horizontalRule);
    if (command === 'clearFormatting') setCommandAvailability(button, tableState.clearFormatting);
    if (command === 'undo') setCommandAvailability(button, editor.can().undo());
    if (command === 'redo') setCommandAvailability(button, editor.can().redo());
    if (command === 'unlink') setCommandAvailability(button, editor.isActive('link'));
  });
  const linkInput = shell.querySelector('[data-uzu-editor-link-target]');
  if (linkInput) linkInput.toggleAttribute('aria-invalid', !linkInput.value.trim());
}

function toggleLink(editor, url) {
  if (editor.isActive('link')) return editor.chain().focus().unsetLink().run();
  return editor
    .chain()
    .focus()
    .extendMarkRange('link')
    .setLink({ href: url || 'https://tiptap.dev' })
    .run();
}

function runTiptapCommand(editor, command, value) {
  const chain = editor.chain().focus();
  if (command === 'paragraph') return chain.setParagraph().run();
  if (command === 'bold') return chain.toggleBold().run();
  if (command === 'italic') return chain.toggleItalic().run();
  if (command === 'underline') return chain.toggleUnderline().run();
  if (command === 'strike') return chain.toggleStrike().run();
  if (command === 'code') return chain.toggleCode().run();
  if (command === 'highlight') return chain.toggleHighlight().run();
  if (command === 'link') return toggleLink(editor, value);
  if (command === 'bulletList') return chain.toggleBulletList().run();
  if (command === 'orderedList') return chain.toggleOrderedList().run();
  if (command === 'taskList') return chain.toggleTaskList().run();
  if (command === 'blockquote') return chain.toggleBlockquote().run();
  if (command === 'codeBlock') return chain.toggleCodeBlock().run();
  if (command === 'heading') return chain.toggleHeading({ level: Number(value || 3) }).run();
  if (command === 'align') return chain.setTextAlign(value || 'left').run();
  if (command === 'horizontalRule') return chain.setHorizontalRule().run();
  if (command === 'insertTable') return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  if (command === 'addColumnAfter') return chain.addColumnAfter().run();
  if (command === 'addRowAfter') return chain.addRowAfter().run();
  if (command === 'clearFormatting') return chain.unsetAllMarks().clearNodes().run();
  if (command === 'unlink') return chain.unsetLink().run();
  if (command === 'undo') return chain.undo().run();
  if (command === 'redo') return chain.redo().run();
  return false;
}

function initRichEditor(shell) {
  const surface = shell.querySelector('[data-uzu-editor-surface]');
  if (!surface || activeRichEditors.has(shell)) return null;
  const editor = new Editor({
    element: surface,
    extensions: [
      StarterKit,
      Underline,
      Highlight,
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https'
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph']
      })
    ],
    content: `
      <h2>Release draft</h2>
      <p><strong>Usuzumi</strong> keeps the editor shell quiet while Tiptap handles the document model, selection, history, links, lists, and keyboard shortcuts.</p>
      <p>Try selecting this sentence, then apply <mark>highlight</mark>, inline <code>code</code>, alignment, or a link from the toolbar.</p>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Wire Usuzumi toolbar events to Tiptap commands.</p></div></li>
        <li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Replace the editor engine without changing the surrounding UI shell.</p></div></li>
      </ul>
      <blockquote><p>The page demonstrates integration boundaries: Usuzumi styles and emits events; Tiptap edits the document.</p></blockquote>
      <table>
        <tr><th>Area</th><th>Engine</th><th>Notes</th></tr>
        <tr><td>Structure</td><td>Tiptap</td><td>Commands, state, and selection live here.</td></tr>
        <tr><td>Surface</td><td>Usuzumi</td><td>Toolbar, spacing, and typography stay consistent.</td></tr>
      </table>
      <pre><code>editor.chain().focus().toggleBold().run();</code></pre>
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
  shell.addEventListener('input', (event) => {
    if (event.target?.matches?.('[data-uzu-editor-link-target]')) {
      updateToolbarState(shell, editor);
    }
  });
  shell.addEventListener('uzu-editor-command', (event) => {
    const { button, command, value } = event.detail;
    const commandValue = command === 'link' ? getToolbarLinkTarget(shell) : value;
    if (!runTiptapCommand(editor, command, commandValue)) return;
    if (button) setCommandState(button, getCommandActiveState(editor, command, commandValue));
    updateToolbarState(shell, editor);
  });
  return editor;
}

function initRichEditors(root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  scope.querySelectorAll('[data-uzu-rich-editor]').forEach((shell) => {
    if (isVisible(shell)) initRichEditor(shell);
  });
}

function bootRichEditors() {
  initRichEditors(document);
  document.addEventListener('uzu-panel-show', (event) => {
    initRichEditors(event.detail?.panel || event.target);
  });
  window.addEventListener('resize', () => initRichEditors(document));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootRichEditors, { once: true });
} else {
  bootRichEditors();
}

window.UsuzumiComponentRichEditor = {
  initRichEditor,
  initRichEditors
};

export { initRichEditor, initRichEditors };
