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
