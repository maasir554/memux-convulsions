# Obsidian — Reference & Context for galexy

> Research notes on **Obsidian**, the graph-based note-taking app we're using as the
> reference product for **galexy**. Current focus: **frontend only** (Next.js).
> This document captures *what Obsidian is* and *how it looks/behaves* so we can
> reproduce the experience in the browser.

---

## 1. What is Obsidian?

Obsidian is a **local-first, Markdown-powered knowledge base and note-taking app**. It
treats a folder of plain `.md` text files as a "second brain": notes link to each other
with `[[wikilinks]]`, and those links are visualized as an interactive **graph**. It is
free for personal use, offline by default, and heavily extensible through community
plugins and themes.

**Core philosophy / selling points:**

- **Local & private** — notes are plain Markdown files on your device; no lock-in, works offline.
- **Networked thought** — build "your own personal Wikipedia" by linking notes; discover non-obvious connections (Zettelkasten methodology).
- **Visual** — the graph view surfaces clusters, patterns, and gaps in your knowledge.
- **Extensible** — thousands of community plugins/themes plus an open API.

---

## 2. Core Concepts (data model)

| Concept | Meaning |
| --- | --- |
| **Vault** | A folder on disk that holds all notes + config. The top-level container. |
| **Note** | A single `.md` Markdown file. The atomic unit. |
| **Folder** | Standard filesystem folders for organizing notes. |
| **Internal link** | A `[[wikilink]]` (or Markdown link) from one note to another — forms graph edges. |
| **Backlink** | The reverse direction: every note that links *to* the current note. |
| **Tag** | `#tag` inline labels, an alternative/parallel organization axis to folders. |
| **Frontmatter / Properties** | YAML metadata block at the top of a note (`---` fenced). |
| **Embed / Transclusion** | Inlining another note/section/block into the current note. |
| **Attachment** | Non-markdown files (images, PDFs, audio, video) referenced by notes. |

> For **galexy frontend**, the vault/notes can start as in-memory or mock JSON data;
> no real filesystem needed initially.

---

## 3. Editing Modes

Obsidian has **three ways to view/edit a note**:

1. **Source mode** — shows raw Markdown syntax (e.g. you see the literal `**bold**`).
2. **Live Preview** — renders formatting inline *while editing* (you see **bold**, but can still edit in place). This is the default and the signature UX.
3. **Reading view** — fully rendered, read-only HTML output (no editing affordances).

Users toggle between editing (Source/Live Preview) and Reading view. Editor niceties
include line folding, headings folding, and a properties/frontmatter UI.

---

## 4. Markdown Syntax Supported

Obsidian uses standard Markdown plus a few extensions:

| Element | Syntax |
| --- | --- |
| Headings | `# H1` … `###### H6` |
| Bold | `**text**` or `__text__` |
| Italic | `*text*` or `_text_` |
| Bold + Italic | `***text***` |
| Strikethrough | `~~text~~` |
| Highlight *(extension)* | `==text==` |
| Internal link *(extension)* | `[[Note name]]`, `[[Note#Heading]]`, `[[Note^block]]`, `[[Note\|alias]]` |
| Embed/transclude *(extension)* | `![[Note]]`, `![[Note#Heading]]`, `![[image.png]]` |
| Markdown link | `[text](url)` |
| External link | `[text](https://example.com)` |
| Image | `![alt](url)`, with sizing `![alt\|640x480](url)` |
| Unordered list | `-`, `*`, or `+` |
| Ordered list | `1.` or `1)` |
| Task list | `- [ ]` (todo), `- [x]` (done) |
| Blockquote | `> text` |
| Callout *(extension)* | `> [!note]`, `> [!warning]`, etc. (a typed blockquote) |
| Inline code | `` `code` `` |
| Code block | ` ```lang ` … ` ``` ` |
| Table | Pipe `\|` syntax |
| Footnote | `[^1]` + `[^1]: text`; inline `^[note]` |
| Horizontal rule | `---`, `***`, or `___` |
| Comment *(extension)* | `%% hidden %%` |
| Escape | backslash before special chars: `\*`, `\_`, `\#`, etc. |

---

## 5. Linking System (the heart of Obsidian)

- **Wikilinks** `[[Target]]` are the default, compact link format. Typing `[[` opens an
  autocomplete of existing notes. Linking to a non-existent note lets you create it on click.
- **Aliases** — `[[Target|display text]]` to show different text.
- **Heading/block links** — `[[Note#Heading]]` and `[[Note^blockId]]` for granular targets.
- **Backlinks panel** — shows **linked mentions** (explicit `[[...]]` references to this note)
  and **unlinked mentions** (occurrences of the note's name/aliases that aren't yet links).
- **Outgoing links panel** — the links *from* the current note.

> These four — wikilink autocomplete, backlinks, outgoing links, unlinked mentions —
> are the highest-value features to replicate for the "networked notes" feel.

---

## 6. Graph View (signature feature)

A force-directed network visualization of the vault.

- **Nodes** = notes (circles). **Edges** = internal links (lines, optionally with arrows).
- **Node size** scales with how often a note is referenced (popular notes are bigger).
- **Global graph** = the entire vault. **Local graph** = only notes connected to the
  active note, with a **depth slider** to expand how many link-hops are shown.

**Filters:** search-based filtering, toggle tags/attachments, "existing files only",
toggle orphan (unlinked) notes.

**Groups:** color-code subsets of notes by search query (visual categorization).

**Display options:** arrows on/off, text fade threshold (label visibility by zoom),
node size slider, link thickness slider, and a chronological **animation/time-lapse** playback.

**Physics forces** (the layout simulation):
- **Center force** — pull toward center (higher = more circular/compact).
- **Repel force** — node-to-node separation.
- **Link force** — tension along edges (tight vs. loose).
- **Link distance** — preferred spacing between connected nodes.

**Interactions:** hover to highlight connections, click to open note, right-click for
context menu, scroll / `+`/`-` to zoom, drag / arrow keys to pan (Shift to accelerate).

> **galexy frontend note:** this is the marquee screen. Strong candidate libraries:
> `react-force-graph` / `d3-force` / `cytoscape.js` for the simulation and rendering
> (canvas or WebGL for performance with many nodes).

---

## 7. Canvas

An **infinite, freeform 2D space** to arrange and connect cards: notes, attachments,
web pages, and text blocks. Used for brainstorming, diagramming, and spatial/non-linear
organization — complementary to the auto-generated graph view (which is link-derived,
not hand-arranged).

> Candidate libraries for galexy: `react-flow` (xyflow), `tldraw`, or `konva`.

---

## 8. UI Layout

```
┌──────┬───────────────────────────────────────┬──────────────┐
│      │  Tab bar (tabs / tab groups)          │              │
│ Ribb │ ┌───────────────────────────────────┐ │  Right       │
│ on   │ │                                   │ │  sidebar     │
│      │ │   Main editor pane(s)             │ │  (Backlinks, │
│ Left │ │   (split into multiple panes)     │ │  Outgoing,   │
│ side │ │                                   │ │  Tags, etc.) │
│ bar  │ │                                   │ │              │
│      │ └───────────────────────────────────┘ │              │
│(File │                                       │              │
│ expl,│                                       │              │
│search│                                       │              │
│graph)│                                       │              │
├──────┴───────────────────────────────────────┴──────────────┤
│  Status bar (word count, sync status, etc.)                  │
└──────────────────────────────────────────────────────────────┘
```

- **Two sidebars (left & right).** Both hold tabs created by core features/plugins.
  - *Left* typically: **File explorer**, **Search**, **Bookmarks**, **Graph**, plus the **Ribbon**.
  - *Right* typically: **Backlinks**, **Outgoing links**, **Tags**, **Outline**.
- **Ribbon** — vertical strip of action icons on the far left of the left sidebar.
- **Panes** — the window a file opens in. You can have many, arranged via drag-and-drop:
  drop on a side to split horizontally/vertically, drop in center to swap.
- **Tabs** — each pane shows one tab at a time; tabs can be reordered, **pinned**
  (so new notes open in a new tab instead of replacing), and grouped into **tab groups**.
- **Status bar** — bottom strip (word/character count, backlink count, sync state).
- Sidebars are **collapsible**; on mobile they're collapsed by default.

**Key navigation/command UI:**
- **Command palette** — fuzzy command launcher (Ctrl/Cmd+P).
- **Quick switcher** — fuzzy file-open jump (Ctrl/Cmd+O).
- **Global search** — full-text search across the vault, with operators.

---

## 9. Customization

- **Themes** — community themes + light/dark modes; deep CSS theming via CSS variables.
- **Plugins** — large ecosystem of community plugins; an open API; "core plugins"
  (graph, backlinks, canvas, search, file explorer, etc.) ship built-in but toggleable.
- **Hotkeys** — almost everything is rebindable.

---

## 10. Frontend Build Notes for galexy

Suggested scope/priority for a Next.js frontend MVP (no backend yet):

1. **App shell / layout** — left sidebar + main pane + right sidebar + status bar, all collapsible. (CSS Grid/Flex.)
2. **File explorer** — tree of mock notes/folders.
3. **Markdown editor** — start with Source mode; add Live Preview later.
   - Editor: CodeMirror 6 (what Obsidian itself uses) or a simpler textarea→render split.
   - Rendering: `react-markdown` + `remark`/`rehype` plugins (GFM, etc.); custom remark plugin for `[[wikilinks]]`.
4. **Wikilink support** — parse `[[...]]`, autocomplete on `[[`, click-to-navigate, create-on-missing.
5. **Backlinks / outgoing links panels** — derive from an in-memory link index.
6. **Graph view** — `react-force-graph` (d3-force under the hood); global + local with depth.
7. **Command palette + quick switcher** — `cmdk` is a good fit.
8. **Theming** — light/dark via CSS variables (Tailwind already set up in galexy).
9. **Tabs/panes** (stretch) — split-pane editing.
10. **Canvas** (stretch) — `react-flow` / `tldraw`.

**Suggested data shape (mock):**
```ts
type Note = {
  id: string;          // slug / path
  title: string;
  content: string;     // raw markdown
  tags: string[];
  links: string[];     // outgoing note ids (parsed from [[...]])
  createdAt: string;
  updatedAt: string;
};
// Derive: backlinks[noteId] = notes where links.includes(noteId)
//         graph = { nodes: Note[], edges: {source,target}[] }
```

---

## Sources

- [Obsidian — official site](https://obsidian.md/)
- [Obsidian (software) — Wikipedia](https://en.wikipedia.org/wiki/Obsidian_(software))
- [Sidebar — Obsidian Help](https://obsidian.md/help/User+interface/Sidebar)
- [Graph view — Obsidian Help](https://obsidian.md/help/plugins/graph)
- [Basic formatting syntax — Obsidian Help](https://obsidian.md/help/Editing+and+formatting/Basic+formatting+syntax)
- [A Guide to Obsidian — SitePoint](https://www.sitepoint.com/obsidian-beginner-guide/)
- [Internal Links and Backlinks — DeepWiki (obsidian-help)](https://deepwiki.com/obsidianmd/obsidian-help/4.2-internal-links-and-graph-view)
- [Why Use Obsidian for Note Taking — TechTimes](https://www.techtimes.com/articles/315717/20260407/why-use-obsidian-note-taking-graph-view-linked-notes-powerful-knowledge-management.htm)
