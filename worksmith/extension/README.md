# Worksmith Extension

Chromium (Manifest V3) debug console for tab, URL, scroll, and accessibility
telemetry. Built with **React + TypeScript + Vite** via the
[`@crxjs/vite-plugin`](https://crxjs.dev/).

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
  App.tsx                  Layout, UI state, top bar, sidebars, activity view
  components/              Console UI (saved view, tree explorer, modal, icons)
  hooks/useWorksmith.ts    Port connection + live state from the background worker
  lib/                     types, accessibility-tree pruning, tree helpers, format
  background/background.ts  Service worker: tab/nav/scroll events, stable-capture
  content/                 Content script + DOM-derived accessibility tree builder
styles/console.css         Global styles (shared with all components)
manifest.config.ts         MV3 manifest (CRXJS)
```
