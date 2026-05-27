# Worksmith Extension

Chromium (Manifest V3) debug console for tab, URL, scroll, and accessibility
telemetry. Built with **React + TypeScript + Vite** via the
[`@crxjs/vite-plugin`](https://crxjs.dev/), styled with **Tailwind CSS v4 +
shadcn/ui** ("sleek dark dev-tool" theme).

## Develop

```bash
npm install
npm run dev      # Vite dev server with HMR for the console page
```

Then load the extension once from the generated dev output (CRXJS writes a
`dist/` while `dev` runs) via `chrome://extensions` → **Load unpacked** →
select the `dist/` folder. The console page hot-reloads on edits.

## Build

```bash
npm run build    # tsc --noEmit && vite build  ->  dist/
npm run typecheck
```

Load the built extension via `chrome://extensions` → **Load unpacked** →
select `dist/`. (Load `dist/`, not the project root — the source is bundled.)

## Layout

```
src/
  main.tsx                 React entry for the console page (index.html)
  index.css                Tailwind v4 theme + bespoke tree-explorer styles
  App.tsx                  Layout, UI state, top bar, sidebars, activity view
  components/              Console UI (saved view, tree explorer, AI nav, modal)
  components/ui/           shadcn/ui primitives (button, tabs, tooltip, …)
  hooks/useWorksmith.ts    Port connection + live state from the background worker
  lib/                     types, prune, AI-tree, tree helpers, format, cn util
  background/background.ts  Service worker: tab/nav/scroll events, stable-capture
  content/                 Content script + DOM-derived accessibility tree builder
manifest.config.ts         MV3 manifest (CRXJS)
components.json            shadcn/ui config
```
