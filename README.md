# Usuzumi Site

Documentation, homepage, and component demos for Usuzumi.

This repository is intentionally separate from the UI library. It keeps larger
documentation-only dependencies inside the component workspace so they do not
become library dependencies.

## Local Setup

```bash
npm install
npm run validate
```

The site pages load Usuzumi from `assets/vendor/usuzumi`, which is generated
from the installed `components/node_modules/usuzumi` package during
`npm install` and `npm run build`. The `components/` workspace owns build tooling and the local editor runtime.
Editor demos are split by engine: Tiptap uses
`components/runtime/rich-editor-deps.js`, markdown-it uses
`components/runtime/markdown-editor-deps.js`, and CodeMirror uses
`components/runtime/code-editor-deps.js`. `components/assets/editor-loader.js`
loads those bundles only when their component panels are visible. Static code
block highlighting uses the narrower `components/runtime/highlight-deps.js`
bridge so it does not bundle editor engines into read-only code examples.

`npm run validate` checks generated bundle drift, page references, component
documentation completeness, bundle boundaries, and public class usage. When a
Chromium, Chrome, or Edge executable is available, it also opens
`components.html` in headless mode and verifies sidebar switching, code
highlighting, copy buttons, data grid, tree, split/resizable panels, and the
Tiptap / markdown-it / CodeMirror editor mounts.

Run `npm install` after changing `components/package.json` or after checking out
the site on a clean machine. Run `npm run build` after updating the Usuzumi
dependency so the committed vendor assets match the package version.
