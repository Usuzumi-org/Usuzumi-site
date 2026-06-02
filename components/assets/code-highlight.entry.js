import {
  cssParser,
  GFM,
  highlightCode,
  htmlParser,
  javascriptParser,
  jsonParser,
  markdownParser,
  parseCode,
  tagHighlighter,
  tags
} from '../runtime/highlight-deps.js';

const languageAliases = {
  bash: 'bash',
  css: 'css',
  html: 'html',
  htm: 'html',
  javascript: 'javascript',
  jsx: 'jsx',
  js: 'javascript',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  shell: 'bash',
  sh: 'bash',
  tsx: 'tsx',
  ts: 'typescript',
  typescript: 'typescript',
  xml: 'html'
};

const escaped = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;'
};

const parserCache = new Map();
const shellKeywords = new Set([
  'case',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'then',
  'until',
  'while'
]);
const shellBuiltins = new Set([
  'cat',
  'cd',
  'chmod',
  'cp',
  'curl',
  'echo',
  'export',
  'find',
  'git',
  'grep',
  'ls',
  'mkdir',
  'mv',
  'node',
  'npm',
  'pnpm',
  'pwd',
  'rm',
  'sed',
  'sh',
  'source',
  'sudo',
  'touch',
  'unset',
  'yarn'
]);

const highlighter = tagHighlighter([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: 'uzu-code-token-comment' },
  { tag: [tags.string, tags.character, tags.attributeValue, tags.docString], class: 'uzu-code-token-string' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier, tags.atom, tags.self, tags.null, tags.bool], class: 'uzu-code-token-keyword' },
  { tag: [tags.tagName, tags.typeName, tags.className, tags.labelName], class: 'uzu-code-token-tag' },
  { tag: [tags.attributeName, tags.propertyName], class: 'uzu-code-token-attr' },
  { tag: [tags.variableName, tags.name, tags.namespace, tags.macroName], class: 'uzu-code-token-variable' },
  { tag: [tags.number, tags.integer, tags.float, tags.color], class: 'uzu-code-token-number' },
  { tag: [tags.literal, tags.regexp, tags.escape, tags.url], class: 'uzu-code-token-string' },
  { tag: [tags.operator, tags.arithmeticOperator, tags.logicOperator, tags.bitwiseOperator, tags.compareOperator, tags.updateOperator, tags.definitionOperator, tags.typeOperator, tags.controlOperator, tags.derefOperator], class: 'uzu-code-token-operator' },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren, tags.brace], class: 'uzu-code-token-punctuation' },
  { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'uzu-code-token-selector' },
  { tag: [tags.link, tags.monospace, tags.processingInstruction, tags.meta, tags.documentMeta, tags.annotation], class: 'uzu-code-token-property' },
  { tag: [tags.strong], class: 'uzu-code-token-keyword' },
  { tag: [tags.emphasis], class: 'uzu-code-token-string' },
  { tag: [tags.invalid], class: 'uzu-code-token-invalid' }
]);

const parserFactories = {
  css: () => cssParser,
  html: () => htmlParser,
  javascript: () => javascriptParser,
  json: () => jsonParser,
  jsx: () => javascriptParser.configure({ dialect: 'jsx' }),
  markdown: () => markdownParser.configure([
    GFM,
    parseCode({
      codeParser: (info) => {
        const language = normalizeLanguage(info);
        return language === 'markdown' ? null : getParser(language);
      },
      htmlParser
    })
  ]),
  tsx: () => javascriptParser.configure({ dialect: 'ts jsx' }),
  typescript: () => javascriptParser.configure({ dialect: 'ts' })
};

function escapeHtml(value) {
  return value.replace(/[&<>]/g, (char) => escaped[char]);
}

function normalizeLanguage(value) {
  const language = String(value || '').trim().toLowerCase().split(/\s+/)[0] || 'text';
  return languageAliases[language] || language || 'text';
}

function inferLanguage(value) {
  const text = value.trim();
  if (!text) return 'text';
  if (/^</.test(text)) return 'html';
  if (/^(\{|\[)/.test(text)) return 'json';
  if (/^(:root|\.|#|@media|--uzu-)/.test(text) || /--uzu-[\w-]+\s*:/.test(text)) return 'css';
  if (/^(npm|pnpm|yarn|node|git|cd|mkdir|cp|mv|rm|curl)\b/m.test(text)) return 'bash';
  if (/^(#|\- |\* |\d+\. )/m.test(text)) return 'markdown';
  if (/\b(import|export|const|let|function|return|document|window|class|await|async)\b/.test(text)) return 'javascript';
  return 'text';
}

function getLanguage(target) {
  const classLanguage = [...target.classList]
    .find((className) => className.startsWith('language-'))
    ?.replace(/^language-/, '');
  const rawLanguage = target.dataset.uzuCodeLanguage || classLanguage || inferLanguage(target.textContent || '');
  return normalizeLanguage(rawLanguage);
}

function getParser(language) {
  const createParser = parserFactories[language];
  if (!createParser) return null;
  if (!parserCache.has(language)) parserCache.set(language, createParser());
  return parserCache.get(language);
}

function emitCode(source, tree) {
  let output = '';
  highlightCode(
    source,
    tree,
    highlighter,
    (text, classes) => {
      output += classes
        ? `<span class="uzu-code-token ${classes}">${escapeHtml(text)}</span>`
        : escapeHtml(text);
    },
    () => {
      output += '\n';
    }
  );
  return output;
}

function highlightSource(source, language) {
  if (language === 'bash') return highlightShell(source);
  const parser = getParser(language);
  if (!parser) return escapeHtml(source);
  return emitCode(source, parser.parse(source));
}

function splitShellComment(line) {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];
    if (previous === '\\') continue;
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '#') return [line.slice(0, index), line.slice(index)];
  }
  return [line, ''];
}

function wrapToken(value, className) {
  return `<span class="uzu-code-token ${className}">${escapeHtml(value)}</span>`;
}

function highlightShellSegment(segment) {
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\$\{?[\w@#?$!*-]+\}?|--?[\w-]+|\b\d+(?:\.\d+)?\b|\b[\w.-]+\b|[|&;()<>]+)/g;
  let output = '';
  let cursor = 0;

  for (const match of segment.matchAll(pattern)) {
    const token = match[0];
    const index = match.index || 0;
    output += escapeHtml(segment.slice(cursor, index));

    if (/^["'`]/.test(token)) output += wrapToken(token, 'uzu-code-token-string');
    else if (token.startsWith('$')) output += wrapToken(token, 'uzu-code-token-variable');
    else if (/^--?/.test(token)) output += wrapToken(token, 'uzu-code-token-attr');
    else if (/^\d/.test(token)) output += wrapToken(token, 'uzu-code-token-number');
    else if (shellKeywords.has(token)) output += wrapToken(token, 'uzu-code-token-keyword');
    else if (shellBuiltins.has(token)) output += wrapToken(token, 'uzu-code-token-tag');
    else if (/^[|&;()<>]+$/.test(token)) output += wrapToken(token, 'uzu-code-token-operator');
    else output += escapeHtml(token);

    cursor = index + token.length;
  }

  return output + escapeHtml(segment.slice(cursor));
}

function highlightShell(source) {
  return source
    .split('\n')
    .map((line) => {
      const [body, comment] = splitShellComment(line);
      const highlightedBody = highlightShellSegment(body);
      return comment
        ? `${highlightedBody}${wrapToken(comment, 'uzu-code-token-comment')}`
        : highlightedBody;
    })
    .join('\n');
}

function highlightCodeBlock(target) {
  if (!(target instanceof HTMLElement)) return;
  const source = target.dataset.uzuCodeSource || target.textContent || '';
  const language = getLanguage(target);
  const cacheKey = `${language}:${source}`;
  if (target.dataset.uzuSyntaxHighlighted === cacheKey) return;

  target.dataset.uzuCodeSource = source;
  target.dataset.uzuCodeLanguage = language;
  target.dataset.uzuSyntaxHighlighted = cacheKey;
  target.classList.add(`language-${language}`);
  target.innerHTML = highlightSource(source, language);
}

function getCodeTargets(scope) {
  const nestedCode = [...scope.querySelectorAll('.uzu-code-block pre code, pre.uzu-code-block-body code')];
  const plainPre = [...scope.querySelectorAll('.uzu-code-block pre, pre.uzu-code-block-body')]
    .filter((pre) => !pre.querySelector('code'));
  return [...nestedCode, ...plainPre];
}

function highlightAll(root = document) {
  const scope = root instanceof Element || root instanceof Document ? root : document;
  getCodeTargets(scope).forEach((target) => highlightCodeBlock(target));
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

const codeHighlightApi = {
  highlightAll,
  highlightCodeBlock
};

window.UsuzumiComponentCodeHighlight = codeHighlightApi;
window.UsuzumiSiteCodeHighlight = codeHighlightApi;

export { highlightAll, highlightCodeBlock };
