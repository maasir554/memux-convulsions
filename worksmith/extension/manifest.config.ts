import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "MEMUX Capture",
  description:
    "Capture page snapshots, full-page scrolls, and accessibility trees, and ship them into the MEMUX indexer.",
  version: "0.1.0",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  action: {
    default_title: "MEMUX Capture",
    default_popup: "popup.html",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
  options_page: "index.html",
  background: { service_worker: "src/background/background.ts" },
  permissions: [
    "activeTab",
    "alarms",
    "scripting",
    "storage",
    "tabs",
    "unlimitedStorage",
    "webNavigation",
  ],
  host_permissions: ["<all_urls>"],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content.ts"],
      run_at: "document_idle",
    },
  ],
});
