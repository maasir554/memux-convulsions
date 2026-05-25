import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Worksmith",
  description:
    "Chromium browser automation debug console for tab, URL, scroll, and accessibility telemetry.",
  version: "0.1.0",
  action: { default_title: "Open Worksmith" },
  options_page: "index.html",
  background: { service_worker: "src/background/background.ts" },
  permissions: [
    "activeTab",
    "alarms",
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
