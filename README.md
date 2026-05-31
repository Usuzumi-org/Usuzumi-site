# Usuzumi Site

Documentation, homepage, and component demos for Usuzumi.

This repository is intentionally separate from the UI library. It can use larger
documentation-only dependencies such as Tiptap, markdown-it, and CodeMirror
without adding them to the library package.

## Local Setup

```bash
npm install
npm install --prefix components
npm run build
npm run validate
```

The site consumes the sibling library with `usuzumi: "file:.."`.
