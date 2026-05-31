window.UsuzumiComponentDocs = window.UsuzumiComponentDocs || {};
window.UsuzumiComponentDocs.componentNotes = Object.assign(
  window.UsuzumiComponentDocs.componentNotes || {},
{
  "page": {
    "classes": [
      ".uzu-page",
      ".uzu-page-narrow",
      ".uzu-section"
    ],},
  "section-centered": {
    "classes": [
      ".uzu-section-centered",
      ".uzu-section-head",
      ".uzu-download-actions"
    ],},
  "grid": {
    "classes": [
      ".uzu-grid",
      ".uzu-grid-2",
      ".uzu-grid-3"
    ],},
  "layout-primitives": {
    "classes": [
      ".uzu-stack",
      ".uzu-flex",
      ".uzu-spacer",
      ".uzu-aspect",
      ".uzu-scroll-area"
    ],
    "structure": [
      "Stack 负责纵向间距，Flex 负责行内排列，Spacer 占据剩余空间，Aspect 保持固定比例，Scroll Area 限制局部滚动高度。",
      "Stack controls vertical gaps, Flex arranges inline content, Spacer takes remaining space, Aspect keeps a fixed ratio, and Scroll Area limits local scroll height."
    ],
    "behavior": [
      "布局原语没有脚本行为；用 CSS 变量 `--uzu-stack-gap`、`--uzu-flex-gap`、`--uzu-aspect-ratio`、`--uzu-scroll-area-max-height` 调整。",
      "Layout primitives have no script behavior; tune them with `--uzu-stack-gap`, `--uzu-flex-gap`, `--uzu-aspect-ratio`, and `--uzu-scroll-area-max-height`."
    ]
  },
  "split-pane": {
    "classes": [
      ".uzu-split-pane",
      ".uzu-split-panel",
      ".uzu-split-resizer"
    ],
    "structure": [
      "外层加 `data-uzu-split-pane`，两个 `.uzu-split-panel` 中间放一个 `data-uzu-split-resizer`。",
      "Add `data-uzu-split-pane` to the wrapper, place two `.uzu-split-panel` nodes around one `data-uzu-split-resizer`."
    ],
    "behavior": [
      "拖动分隔条会更新 `--uzu-split-primary-size`；分隔条获得焦点后支持方向键、Home 和 End。",
      "Dragging the divider updates `--uzu-split-primary-size`; focused dividers support arrow keys, Home, and End."
    ],
    "tutorialSections": [
      {
        "title": [
          "两栏结构",
          "Two-Panel Structure"
        ],
        "body": [
          "外层写 `data-uzu-split-pane`，中间的 `data-uzu-split-resizer` 是按钮，因此可以获得焦点并响应键盘。初始比例用 `data-uzu-split-size`，范围用 `data-uzu-split-min` / `data-uzu-split-max`。",
          "Set `data-uzu-split-pane` on the wrapper. The middle `data-uzu-split-resizer` is a button, so it can receive focus and respond to the keyboard. Use `data-uzu-split-size` for the initial ratio and `data-uzu-split-min` / `data-uzu-split-max` for bounds."
        ],
        "code": "<div class=\"uzu-split-pane\" data-uzu-split-pane data-uzu-split-size=\"42\" data-uzu-split-min=\"24\" data-uzu-split-max=\"72\">\n  <section class=\"uzu-split-panel\">List</section>\n  <button class=\"uzu-split-resizer\" type=\"button\" data-uzu-split-resizer></button>\n  <section class=\"uzu-split-panel\">Detail</section>\n</div>",
        "language": "html"
      },
      {
        "title": [
          "尺寸持久化",
          "Size Persistence"
        ],
        "body": [
          "`uzu-split-resize` 会带出当前百分比。项目可以把它写入偏好设置；需要自动持久化时使用 `data-uzu-split-key`。",
          "`uzu-split-resize` includes the current percentage. Applications can save it as a preference; use `data-uzu-split-key` when automatic persistence is wanted."
        ],
        "code": "splitPane.addEventListener('uzu-split-resize', (event) => {\n  userPreferences.sidebarWidth = event.detail.size;\n});",
        "language": "js"
      }
    ]
  },
  "resizable": {
    "classes": [
      ".uzu-resizable",
      ".uzu-resizable-content",
      ".uzu-resizable-handle"
    ],
    "structure": [
      "外层加 `data-uzu-resizable`，内容放进 `.uzu-resizable-content`，右下角按钮加 `data-uzu-resizable-handle`。",
      "Add `data-uzu-resizable` outside, place content in `.uzu-resizable-content`, and add a lower-right `data-uzu-resizable-handle` button."
    ],
    "behavior": [
      "拖拽或方向键会更新 `--uzu-resizable-width` 和 `--uzu-resizable-height`，并派发 `uzu-resizable-resize`。",
      "Dragging or arrow keys update `--uzu-resizable-width` and `--uzu-resizable-height`, then emit `uzu-resizable-resize`."
    ],
    "tutorialSections": [
      {
        "title": [
          "可调整区域",
          "Resizable Area"
        ],
        "body": [
          "外层写 `data-uzu-resizable`，内容放在 `.uzu-resizable-content`，右下角手柄写 `data-uzu-resizable-handle`。宽高和最小值都可以通过 data 属性给出初始值。",
          "Set `data-uzu-resizable` on the wrapper, put content inside `.uzu-resizable-content`, and add a lower-right `data-uzu-resizable-handle`. Width, height, and minimum values can be supplied through data attributes."
        ],
        "code": "<div class=\"uzu-resizable\" data-uzu-resizable data-uzu-resizable-width=\"360\" data-uzu-resizable-height=\"180\">\n  <div class=\"uzu-resizable-content\">Preview</div>\n  <button class=\"uzu-resizable-handle\" type=\"button\" data-uzu-resizable-handle></button>\n</div>",
        "language": "html"
      },
      {
        "title": [
          "尺寸事件",
          "Resize Event"
        ],
        "body": [
          "`uzu-resizable-resize` 会返回宽高和目标元素。可以用它更新状态栏、保存面板尺寸，或同步相邻区域。",
          "`uzu-resizable-resize` returns width, height, and the target element. Use it to update status text, save panel size, or sync nearby regions."
        ],
        "code": "panel.addEventListener('uzu-resizable-resize', (event) => {\n  sizeLabel.textContent = `${event.detail.width} × ${event.detail.height}`;\n});",
        "language": "js"
      }
    ]
  },
  "topbar": {
    "classes": [
      ".uzu-topbar",
      ".uzu-brand-link",
      ".uzu-nav"
    ],}
}
);
