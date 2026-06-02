window.UsuzumiComponentDocs = window.UsuzumiComponentDocs || {};
window.UsuzumiComponentDocs.componentInterfaces = Object.assign(
  window.UsuzumiComponentDocs.componentInterfaces || {},
{
  "colors": {
    "variables": [
      "--uzu-bg",
      "--uzu-surface",
      "--uzu-border",
      "--uzu-success",
      "--uzu-warning",
      "--uzu-danger",
      "--uzu-info"
    ],
    "scope": [
      ":root",
      ".uzu-app",
      ".uzu-scope",
      "local wrapper"
    ]
  },
  "typography": {
    "base": [
      ".uzu-signature",
      ".uzu-hero-title",
      ".uzu-page-title",
      ".uzu-section-title",
      ".uzu-body-large",
      ".uzu-text",
      ".uzu-section-label",
      ".uzu-kicker",
      ".uzu-title-pair"
    ],
    "variables": [
      "--uzu-font-serif",
      "--uzu-font-signature",
      "--uzu-font-mono",
      "--uzu-card-title-size",
      "--uzu-card-title-line",
      "--uzu-card-subtitle-size",
      "--uzu-card-subtitle-line",
      "--uzu-card-title-gap"
    ],
    "files": [
      "ui/usuzumi.css",
      "ui/usuzumi-signature.css"
    ]
  },
  "motion": {
    "variables": [
      "--uzu-motion-quick",
      "--uzu-motion-base",
      "--uzu-motion-slow",
      "--uzu-ease-standard"
    ]
  }
}
);
