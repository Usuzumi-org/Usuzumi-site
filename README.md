# Usuzumi Site

Documentation, homepage, and component demos for Usuzumi.

This repository is intentionally separate from the UI library. Site pages
consume the public Usuzumi CSS and runtime from `assets/vendor/usuzumi`, which
is synced from the installed `usuzumi` package or the sibling local `../ui`
directory during development.

## Local Setup

```bash
npm run build
npm run validate
```

`npm run build` syncs the sibling local `../ui` library into
`assets/vendor/usuzumi/ui` during local development. If the sibling library is
not available, the build script falls back to the installed `usuzumi` package.
The component page is static consumer markup: its classes, data attributes, and
behavior come from public Usuzumi assets. It does not ship a site-owned
component-docs generator or editor runtime bundles.

## Component Page Rules

`components.html` is a catalog view of the public UI library, not a source of
new UI primitives. Each component panel should keep a real preview/code toggle,
copyable code, concrete interface notes, and examples built only from public
`uzu-*` classes plus public `data-uzu-*` runtime hooks. Closely related public
controls should be documented together when that makes the catalog clearer; for
example, the topbar panel also demonstrates the theme toggle and language selector.

Avoid placeholder prose and generated API filler. Interface tables should stay
short enough to scan, inline identifiers should use `.uzu-code`, and demo code
should be complete enough to copy without ellipsis placeholders. If a demo
appears to need a page-only selector or script, first check whether the public
library already exposes the needed primitive; only promote a new UI feature into
the library when it is useful outside this catalog page.

`npm run validate` checks generated bundle drift, page references, component
page boundaries, vendored Usuzumi assets, and public class usage. When a
Chromium, Chrome, or Edge executable is available, it also opens
`components.html` in headless mode and verifies sidebar switching, code
highlighting API availability, data grid, tree, split/resizable panels, and the
Markdown preview mount.
Run `npm install` only after changing site package dependencies or when testing
the installed package fallback instead of the sibling local library. Run
`npm run build` after updating the local library or Usuzumi dependency so the
committed vendor assets match the source being demonstrated.
