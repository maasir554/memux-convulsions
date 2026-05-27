# Galexy — Progress

A graph-based notebook in the spirit of Obsidian, built for the AMD Slingshot
Hackathon by **convulsions** as the frontend for MEMUX. Runs entirely
client-side: the editor, the database, the file store, and the graph
simulation all live in the browser.

This document summarises what's been built, the technical choices behind it,
and what's still open.

---

## Stack

| Layer            | Choice                                               |
| ---------------- | ---------------------------------------------------- |
| Framework        | **Next.js 16** (App Router, Turbopack)               |
| UI               | **React 19** (Strict Mode disabled — see notes)      |
| Language         | **TypeScript** end-to-end                            |
| Styling          | **Tailwind v4** with CSS-variable theming            |
| Primitives       | **shadcn/ui** (via `radix-nova`) + raw `radix-ui`    |
| Database         | **PGlite** (Postgres in WASM) over IndexedDB         |
| ORM              | **Drizzle** with `pg-core`                           |
| Spreadsheet      | **Univer** presets (sheets-core)                     |
| Markdown render  | **react-markdown** v9 + custom remark-obsidian       |
| Markdown editor  | **CodeMirror 6** with custom highlight style         |
| Graph            | **react-force-graph-2d** with custom forces & hits   |
| Binary store     | **OPFS** (`navigator.storage.getDirectory`)          |
| Icons            | **lucide-react**                                     |

`reactStrictMode: false` in `next.config.ts` — Univer's lifecycle is the
reason; double-mount under Strict Mode wedges the workbook because Univer's
internal scheduler doesn't tolerate sync unmount during render.

---

## Features

### App shell

- Three-pane layout via **`react-resizable-panels` v4** (numeric values are
  pixels, strings are percentages — bit them on this once).
- Collapsible left/right sidebars driven through `usePanelRef` with animated
  collapse/expand transitions and a pulse `galexy-animating` class so border
  handles fade with the panel.
- Ribbon (vertical left rail) switches the left sidebar between **Files**,
  **Search**, and **Graph view**. Re-clicking the active view collapses the
  panel — Obsidian behaviour.
- Status bar shows the active file and its backlink count.

### File explorer (left sidebar)

- Vault tree grouped by folder, root folders first, alphabetically sorted.
- Folders persist as DB rows of their own (separate `folders` table); empty
  folders survive reload and show an `empty` badge with a "No items yet."
  placeholder inside the expanded body.
- Folder icons rendered in the same colour as the graph's folder tier
  (`var(--graph-folder)`) so the tree and graph share one visual identity.
- **Per-folder hover affordance**: each folder row reveals a `+` icon on
  hover. Click opens a Radix Popover with an auto-focused search input and a
  filtered list of seven actions (create md / code / sheet, upload md / csv /
  pdf / image), plus a separator-divided **Delete folder** action. Enter
  triggers the first matching create/upload entry (never delete — destructive
  actions never sit on the Enter path).
- **Right-click context menu** on folder rows: `New ›` and `Upload ›`
  submenus, plus a `Delete folder` entry. No search filter, per spec.
- **Per-item three-dots affordance**: every file row reveals a
  `MoreHorizontal` icon on hover with a Delete action in a popover. Right-
  clicking the row mirrors it via a Radix `ContextMenu`.
- **Root toolbar**: header strip carries four small icon buttons for vault-
  root creation (note, code, sheet, folder). Pressing one shows an inline
  dashed-border input row at the top of the tree.
- **Inline naming** input commits on Enter, cancels on Esc, and auto-commits
  on blur when non-empty. Extension-aware: `filename.ts` strips `.ts` and
  sets language; `note.md` / `data.csv` strip their extension. The input
  renders inside the folder it targets (or at root for the toolbar).
- **Search view**: filter notes by title or content; clicking a result both
  switches to Files and highlights the note.

### Editor pane

- Tab strip with overflow scroll, drag-to-scroll, gradient fades on each
  edge, and per-tab close button (hover-revealed).
- **Markdown viewer** (read mode):
  - `remark-gfm` for tables/strikethrough/tasks.
  - Custom `remark-obsidian` plugin emits `wikilink:` and `tag:` URL schemes;
    `urlTransform` lets them through.
  - Wikilinks decoded with `decodeURIComponent` so multi-word `[[My Note]]`
    targets resolve correctly.
  - Interactive task checkboxes (`- [ ]` / `- [x]`) toggle through to the
    underlying file content via `toggleTaskInContent`.
  - Callouts (`> [!note]`, `> [!warning]`, etc.) styled via class.
- **Markdown editor** (source mode): CodeMirror 6 with `@codemirror/lang-
  markdown` and a custom `HighlightStyle` keyed off `--cm-*` CSS variables so
  syntax colour respects light/dark.
- **Code viewer**: same CodeMirror baseline with language-aware highlighting
  from `@codemirror/lang-javascript` (and extension-derived language for
  uploaded files).
- **CSV viewer (read mode)**: virtual table with `Cmd/Ctrl+F` find and
  `Cmd/Ctrl+H` find-and-replace overlays.
- **CSV editor (Univer spreadsheet)**:
  - First load auto-fits column widths to content (`Math.min(280,
    Math.max(56, len * 7 + 18))`).
  - Saved column widths and row heights persist per-sheet (`sheet_meta jsonb`
    on the items row).
  - Save-while-typing via `SheetEditChanging` (patches the editing cell into
    the snapshot before serialising) + `SheetEditEnded` + `SheetValueChanged`,
    all funnelled through one 300 ms debouncer.
  - `CommandExecuted` listener picks up column/row resize, paste, insert/
    delete; meta is only emitted when it actually changed (`metasEqual` /
    `lastSavedMeta` dedup) so plain typing doesn't churn meta.
  - `Cmd/Ctrl+Z` and `Cmd/Ctrl+Y/Shift+Z` are routed to `univerAPI.undo()` /
    `redo()` from a `window` listener that skips when Univer already owns
    focus.
  - Dark mode toggled natively via `createUniver({ darkMode })` +
    `univerAPI.toggleDarkMode`, with a `MutationObserver` on
    `html.classList` driving updates (`lastDark` dedup avoids a feedback
    loop).
  - Custom `ff: "Geist"` baked into `defaultStyle` so cells render in the
    app font, not Univer's default.
  - No `workerURL` — Univer's RPC plugin hangs without one but boots fine
    without (the workbook lives in the main thread).
- **PDF viewer**: `<iframe>` with `src` (public asset) or OPFS object URL
  resolved via `useBlobUrl`.
- **Image viewer**: `<img>` likewise, with the same source-resolution path.
- **Folder view**: when a folder item is active, the body lists its children
  with type icons.

### Graph view

- Driven by `react-force-graph-2d`. The library's click detection is fragile
  (drag-vs-click threshold, label hit area), so the canvas does its own
  `screen2GraphCoords` → `nodeAt(x, y)` hit test using both circle radius and
  rendered label bounds via an offscreen `measureText`.
- Two link kinds drawn natively (`link` with arrows, `contains` thinner, no
  arrow — highlighted yellow when the source folder is active).
- **Tree-tier layering** (added later):
  - Synthetic backbone: `__tier:user → __tier:workspace → {top-level folders
    + root files}`.
  - Custom d3-force `tierY` pulls each node toward its tier's target y
    (`user: -340`, `workspace: -200`, `folder: -70`, `files: +90`); user and
    workspace are additionally pinned via `fx=0, fy=...`.
  - Link distance tuned per kind (`tree: 90`, `contains: 50`, `link: 30`) so
    structural edges spread the layout vertically.
  - Tree-tier nodes render with an outer ring and bolder label; click
    handler bails for user/workspace so phantom IDs never reach the
    app-shell `openNote`.
- Per-type colours live in CSS (`--graph-markdown` etc.) so light/dark mode
  both work without recompiling. The graph reads them at mount and watches
  `html.classList` for dark-mode toggles via `MutationObserver`.

### Right sidebar

- Outline (markdown headings), metadata (folder, tags, updated), backlinks
  and outgoing links — all derived live from `linkGraph`.

---

## Persistence

Two tables, both initialised with idempotent DDL on every boot:

```sql
items   (id text PK, title, folder, type, summary, content,
         tags jsonb, links jsonb, language, src, blob_key,
         sheet_meta jsonb, updated_at timestamp)

folders (name text PK, created_at timestamp)
```

- **PGlite** (`@electric-sql/pglite`) backed by `idb://galexy` with
  `relaxedDurability: true` for write throughput.
- **No drizzle-kit migrations** — schema is created with `CREATE TABLE IF
  NOT EXISTS`, and forward-compat column additions ride on
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`. Each migration runs in its own
  `client.exec()` call so one failing can't shadow the next, and any error
  is `console.warn`'d (`[vault] migration failed: …`) so failures are
  visible.
- **Initial seed**: `NOTES` from `src/lib/mock-notes.ts` is inserted if and
  only if the `items` table is empty. `applyContentUpgrades` then refills
  any seeded row whose `content` is still `""` (e.g. older DBs).
- **Binary uploads** (PDFs, images) live in **OPFS** under `galexy-blobs/`,
  the row carries only the OPFS key in `blob_key`. The viewers resolve the
  key to an object URL through `useBlobUrl`, which owns the URL's lifecycle
  (revokes on unmount and on key change, races safely if the key changes
  mid-fetch).
- **Local writes are optimistic.** `useVault.removeItem` mutates local state
  first, then issues the DB delete; if the delete throws, the snapshot is
  restored. Same pattern for `createNote` and `uploadFiles`.
- **Deleting a binary item** cascades to OPFS: `deleteItem` uses Drizzle's
  `.returning({ blobKey })` so the caller can `deleteBlob(key)` after the
  row is gone.
- **Folder delete** is opt-in cascade: the UI counts children, prompts the
  user with the count (`window.confirm`), and either drops just the folder
  row (empty) or also removes every child item first.

---

## Data model

```
Note {
  id, title, folder, type,            // identity / placement
  summary, content, tags, updatedAt,  // common
  links?,                             // explicit out-links (non-md files)
  src?, blobKey?,                     // pdf/image: shipped or uploaded
  language?,                          // code
  childIds?,                          // derived folder
  sheetMeta?,                         // csv: { columnWidths, rowHeights }
}
```

- `ItemType` is one of `markdown | code | csv | pdf | image | folder`.
- **Folders are derived** from file rows + the `folders` table, never stored
  in `items`. `deriveFolders(notes, extraFolderNames)` builds them, used by
  `buildItems` (graph nodes) and `buildVaultTree` (file explorer).
- **Graph nodes** widen the type at the graph layer only — `GraphNodeKind =
  ItemType | "user" | "workspace"` lets the tier nodes participate without
  bleeding back into the persistence enum.

---

## Notable design decisions

- **Folders persist as their own table** rather than being inferred from
  file rows. Without this, an empty folder you created would silently
  vanish on next reload — bad UX even if the data layer is "consistent".
- **No drizzle-kit migrations.** The vault is a single-user, single-origin
  IndexedDB store, so idempotent `IF NOT EXISTS` DDL + per-statement
  migrations are simpler and survive every dev-mode reload. The trade-off:
  no column renames or destructive changes without a custom script.
- **Univer over Fortune-sheet.** Fortune-sheet's dark mode required a
  `filter: invert(…)` hack the user explicitly vetoed ("we should have
  command on every pixel"). Univer's native dark mode supports proper
  per-cell theming.
- **Custom y-tier force** rather than a layered DAG layout library — the
  tier band wanted to coexist with the existing force layout for the file
  graph beneath it; pinning two synthetic nodes and adding a 50-line custom
  d3-force was lighter than swapping engines.
- **OPFS over base64-in-Postgres.** PDFs/images can be tens of MB; storing
  them in the row would bloat the items table and blow IndexedDB's per-row
  quota. The `blob_key` column was already there in the schema for exactly
  this.
- **Confirmation via `window.confirm`** rather than a styled dialog — for
  destructive single-item operations it's the right baseline, and swapping
  in a Radix `AlertDialog` later is purely a handler-internal change.
- **`react-strict-mode: false`** because Univer's lifecycle (deferred
  dispose, microtask init with cancellation flag, per-mount inner
  container) is incompatible with Strict Mode's intentional double-invoke.
- **Tree-shaping clicks at the graph canvas, not the app shell.** Tier
  nodes (user, workspace) never call `onOpen`. App-shell stays unaware of
  graph-internal IDs.

---

## MEMUX chat backend (cloud mode)

The plasma Hono server is now ported into galexy itself — same routes, same
shapes, same key-rotator. Four route handlers live under `src/app/api/`:

```
POST /v1/chat/completions   streaming + non-streaming, OpenAI shape
GET  /v1/models             returns the configured cloud models
GET  /api/health            { provider, ok }
GET  /api/settings          { provider, ready, configurable: false }
PUT  /api/settings          405 (read-only)
```

Provider modules live under `src/lib/memux/backend/`:

- `types.ts`   — `ChatRequest`, `ChatMessage`, `ModelInfo`, `Provider`
- `keys.ts`   — `KeyRotator`, `loadGoogleKeys`, `RetryWithNextKey`,
  `runWithRotation(rotator, fn)`
- `google.ts` — native Gemini client. Translates OpenAI request shape to
  native, native SSE → OpenAI `delta.content` / `delta.reasoning_content`,
  failover on `401/403/429/5xx`.
- `registry.ts` — `globalThis.__memuxCloudProvider` singleton so the
  rotator's cursor survives Next.js dev HMR cycles.

All four route files are `import "server-only"`-rooted via the lib modules
and run on `runtime = "nodejs"` (the streaming endpoint also opts out of
caching with `dynamic = "force-dynamic"`).

### Enabling Cloud mode

Copy `.env.local.example` → `.env.local` and set:

```
NUM_KEYS_GOOGLE=3
GOOGLE_AI_1=ya29....
GOOGLE_AI_2=ya29....
GOOGLE_AI_3=ya29....
```

Then in the chat's Settings dialog pick **Cloud**. `/api/settings.ready`
becomes `true` once at least one key loads; the dialog will refuse to switch
into Cloud mode otherwise. Keys are never sent to the browser — settings
returns only `{ provider, ready, configurable: false }`.

### What direct mode still does

`"direct"` mode (Lemonade default at `http://localhost:13305/v1`) is
untouched — the browser fetches the local server itself, bypassing our
routes. The two modes coexist; the user picks per chat session in
Settings.

---

## What's not yet built

These are deliberate scope cuts, in priority-ish order:

- **Rename** (notes and folders). The three-dots popover and the folder
  popover both have room for it; no DB changes needed beyond `UPDATE items
  SET title = …` / a folders table rename + child reassignment.
- **Drag-and-drop** between folders. Today, items can only land in the
  folder where they were created or uploaded.
- **Per-file "open" context** so the popover-create-note action can preview
  where the file will land.
- **Undo after delete.** Delete is final once the DB call succeeds and the
  OPFS blob is also removed.
- **Bulk-select + delete** in the file explorer.
- **Title collision warning.** Multiple notes can share a title; wikilinks
  resolve to the first match by case-insensitive lookup. Known, unchanged.
- **Multi-workspace.** The graph tier is structured for it (just add a
  second `workspace`-typed node and a second `user → workspace` edge), but
  the file explorer and data model don't yet partition by workspace.
- **Item-row keyboard navigation.** Tab/arrow keys don't move focus through
  the file tree yet.
- **Toast / non-modal feedback** for upload errors. Today the only signal
  is a `[vault] upload failed: …` console warning.

---

## Verification flow (during development)

Because Univer's dev session breaks if `npm run build` runs against an
active dev server, every change is verified with:

1. `npx tsc --noEmit -p tsconfig.json` — type-check.
2. `npx eslint <touched files>` — lint with the project's
   `react-hooks/static-components`, `react-hooks/set-state-in-effect`, and
   `react-hooks/refs` rules.
3. Manual reload of `localhost:3000` in the browser (hard refresh when
   touching CSS variables or the DDL).

Build is reserved for pre-deploy and is never run while a dev server is
attached.
