// Mock vault data + helpers for the galexy (Obsidian-like) shell.
// See galexy/OBSIDIAN.md for the product reference this models.

export type ItemType =
  | "markdown"
  | "code"
  | "csv"
  | "pdf"
  | "image"
  | "folder";

/** Per-sheet layout state (CSV spreadsheet column widths / row heights). */
export type SheetMeta = {
  columnWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
};

/**
 * A rectangular comment anchored to a PDF page. Coordinates are normalized
 * to [0,1] relative to the page's natural size so they survive zoom changes.
 */
export type PdfAnnotation = {
  id: string;
  pageIndex: number; // 0-based
  x: number;
  y: number;
  width: number;
  height: number;
  comment: string;
  createdAt: string; // ISO
};

export type Note = {
  id: string;
  title: string;
  folder: string; // parent folder name; "" = vault root
  type: ItemType;
  summary: string;
  content: string; // markdown / code source; empty for src-backed files
  tags: string[];
  updatedAt: string; // ISO date
  links?: string[]; // explicit outgoing links (item ids) for non-markdown files
  src?: string; // public path for pre-shipped pdf / image / csv
  blobKey?: string; // OPFS key for user-uploaded pdf / image binaries
  language?: string; // for code items
  childIds?: string[]; // for folder items
  sheetMeta?: SheetMeta; // CSV viewer's persisted layout state
  pdfAnnotations?: PdfAnnotation[]; // PDF viewer's box comments
};

// --- The vault (files) -------------------------------------------------------

export const NOTES: Note[] = [
  {
    id: "welcome",
    title: "Welcome",
    folder: "",
    type: "markdown",
    summary: "Start here — what galexy is and how to get around.",
    tags: ["start"],
    updatedAt: "2026-05-25",
    content: `# Welcome to galexy

This is a graph-based notebook, inspired by [[MEMUX]] and Obsidian.

## Get started
- Open notes from the file explorer on the left
- Follow a link like [[Graph View]] or [[Zettelkasten]]
- Watch the **Backlinks** panel on the right update as you browse

> [!note] Tip
> Everything here is mock data for the shell. Real editing comes next.

#start`,
  },
  {
    id: "memux",
    title: "MEMUX",
    folder: "Projects",
    type: "markdown",
    summary: "Team convulsions' hackathon entry — frictionless workflows.",
    tags: ["project", "hackathon"],
    updatedAt: "2026-05-25",
    content: `# MEMUX

MEMUX reimagines everyday workflows for students, researchers, and early
professionals — our entry for the AMD Slingshot Hackathon.

Built around two ideas:
- [[Productivity]] without friction
- A [[Research Workflow]] that connects what you read and write

Related: [[Welcome]], [[Zettelkasten]]

#project #hackathon`,
  },
  {
    id: "zettelkasten",
    title: "Zettelkasten",
    folder: "Concepts",
    type: "markdown",
    summary: "A method of interlinked atomic notes.",
    tags: ["method", "notes"],
    updatedAt: "2026-05-22",
    content: `# Zettelkasten

A method of interlinked atomic notes. Each note holds one idea and links to
others, forming a network you can explore in the [[Graph View]].

Powers the way [[MEMUX]] and a good [[Research Workflow]] organize knowledge.

#method`,
  },
  {
    id: "graph-view",
    title: "Graph View",
    folder: "Concepts",
    type: "markdown",
    summary: "The force-directed visualization of the vault.",
    tags: ["feature", "visualization"],
    updatedAt: "2026-05-21",
    content: `# Graph View

A force-directed visualization of the vault. Nodes are notes, edges are
[[Zettelkasten]] links. Bigger nodes are referenced more often.

The signature feature of [[MEMUX]].

#feature`,
  },
  {
    id: "productivity",
    title: "Productivity",
    folder: "",
    type: "markdown",
    summary: "The hackathon theme: the future of work.",
    tags: ["theme"],
    updatedAt: "2026-05-20",
    content: `# Productivity

The hackathon theme: the future of work. The core unit of real output is
[[Deep Work]], captured in a [[Daily Note]].

#theme`,
  },
  {
    id: "deep-work",
    title: "Deep Work",
    folder: "Concepts",
    type: "markdown",
    summary: "Focused, undistracted effort on demanding work.",
    tags: ["focus"],
    updatedAt: "2026-05-19",
    content: `# Deep Work

Focused, undistracted effort on a cognitively demanding task. The opposite of
shallow busywork. A key input to [[Productivity]].

#focus`,
  },
  {
    id: "research-workflow",
    title: "Research Workflow",
    folder: "Projects",
    type: "markdown",
    summary: "Read → capture → link → synthesize.",
    tags: ["workflow", "research"],
    updatedAt: "2026-05-18",
    content: `# Research Workflow

Read → capture → link → synthesize. Pairs a [[Zettelkasten]] of atomic notes
with regular [[Productivity]] reviews.

#workflow`,
  },
  {
    id: "daily-2026-05-25",
    title: "Daily Note",
    folder: "Daily",
    type: "markdown",
    summary: "Tasks and notes for the day.",
    tags: ["daily"],
    updatedAt: "2026-05-25",
    content: `# 2026-05-25

- [x] Scaffold the [[MEMUX]] shell
- [ ] Wire up the [[Graph View]]
- [ ] Block out time for [[Deep Work]]

#daily`,
  },

  // --- Non-markdown files ---------------------------------------------------
  {
    id: "slingshot-brief",
    title: "Slingshot Brief",
    folder: "Projects",
    type: "pdf",
    summary: "The AMD Slingshot Hackathon brief (PDF).",
    tags: ["reference"],
    updatedAt: "2026-05-24",
    content: "",
    src: "/files/slingshot-brief.pdf",
    links: ["memux"],
  },
  {
    id: "team-roster",
    title: "Team Roster",
    folder: "Projects",
    type: "csv",
    summary: "Team convulsions members and focus areas.",
    tags: ["data"],
    updatedAt: "2026-05-26",
    content: `name,role,focus,joined
Maasir,Lead / Frontend,App shell & graph,2026-05-25
Pankaj,Backend,Data & persistence,2026-05-25
Aisha,Design,UX & theming,2026-05-26
Ravi,Research,Workflows & notes,2026-05-26
`,
    links: ["memux"],
  },
  {
    id: "architecture",
    title: "Architecture",
    folder: "Concepts",
    type: "image",
    summary: "System architecture diagram.",
    tags: ["diagram"],
    updatedAt: "2026-05-23",
    content: "",
    src: "/files/architecture.png",
    links: ["memux", "graph-view"],
  },
  {
    id: "build-graph",
    title: "buildLinkGraph.ts",
    folder: "Concepts",
    type: "code",
    language: "typescript",
    summary: "Reference snippet for deriving the link graph.",
    tags: ["code"],
    updatedAt: "2026-05-22",
    links: ["graph-view"],
    content: `// Derive outgoing/backlink maps from item contents.
export function buildLinkGraph(items: Item[]): LinkGraph {
  const idByTitle = new Map(items.map((i) => [i.title.toLowerCase(), i.id]));
  const outgoing: Record<string, string[]> = {};
  for (const item of items) {
    outgoing[item.id] = extractWikiLinkTitles(item.content)
      .map((title) => idByTitle.get(title.toLowerCase()))
      .filter((id): id is string => Boolean(id));
  }
  return { outgoing };
}`,
  },
];

// --- Folders as first-class items -------------------------------------------

export const FOLDER_PREFIX = "folder:";

/**
 * Derive folder items from the distinct folders that contain files, plus any
 * explicit `extraNames` (so empty folders the user created still appear).
 */
export function deriveFolders(
  notes: Note[],
  extraNames: readonly string[] = [],
): Note[] {
  const childrenByFolder = new Map<string, string[]>();
  const allNames = new Set<string>(extraNames);
  for (const note of notes) {
    if (!note.folder) continue;
    allNames.add(note.folder);
    const list = childrenByFolder.get(note.folder) ?? [];
    list.push(note.id);
    childrenByFolder.set(note.folder, list);
  }
  return [...allNames].sort((a, b) => a.localeCompare(b)).map((name) => {
    const childIds = childrenByFolder.get(name) ?? [];
    return {
      id: `${FOLDER_PREFIX}${name}`,
      title: name,
      folder: "",
      type: "folder" as const,
      summary: `Folder — ${childIds.length} item${childIds.length === 1 ? "" : "s"}.`,
      content: "",
      tags: [],
      updatedAt: "",
      childIds,
    };
  });
}

/** Files plus derived folder items (everything that can be a graph node). */
export function buildItems(
  notes: Note[],
  extraFolderNames: readonly string[] = [],
): Note[] {
  return [...notes, ...deriveFolders(notes, extraFolderNames)];
}

// --- Link parsing & graph ----------------------------------------------------

/** Matches [[Target]], [[Target|alias]], [[Target#heading]]. */
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Extract the target titles referenced by a note's markdown. */
export function extractWikiLinkTitles(content: string): string[] {
  const titles: string[] = [];
  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = match[1].split("|")[0].split("#")[0].trim();
    if (target) titles.push(target);
  }
  return titles;
}

export type LinkGraph = {
  /** itemId -> ids it links to */
  outgoing: Record<string, string[]>;
  /** itemId -> ids that link to it */
  backlinks: Record<string, string[]>;
};

/**
 * Build the outgoing/backlink index. Markdown items infer links from their
 * [[wikilinks]]; other files use their explicit `links`.
 */
export function buildLinkGraph(items: Note[]): LinkGraph {
  const idByTitle = new Map(items.map((i) => [i.title.toLowerCase(), i.id]));
  const outgoing: Record<string, string[]> = {};
  const backlinks: Record<string, string[]> = {};

  for (const item of items) {
    outgoing[item.id] ??= [];
    backlinks[item.id] ??= [];
  }

  for (const item of items) {
    const targets = new Set<string>();
    if (item.type === "markdown") {
      for (const title of extractWikiLinkTitles(item.content)) {
        const targetId = idByTitle.get(title.toLowerCase());
        if (targetId && targetId !== item.id) targets.add(targetId);
      }
    } else if (item.links) {
      for (const id of item.links) if (id !== item.id) targets.add(id);
    }
    for (const targetId of targets) {
      outgoing[item.id].push(targetId);
      backlinks[targetId].push(item.id);
    }
  }

  return { outgoing, backlinks };
}

export type GraphEdge = {
  source: string;
  target: string;
  kind: "link" | "contains";
};

/** Folder -> child containment edges (highlighted when a folder is active). */
export function buildContainmentEdges(items: Note[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const item of items) {
    if (item.type === "folder" && item.childIds) {
      for (const childId of item.childIds) {
        edges.push({ source: item.id, target: childId, kind: "contains" });
      }
    }
  }
  return edges;
}

// --- Markdown helpers --------------------------------------------------------

export type Heading = { level: number; text: string };

/** Pull ATX headings (# .. ######) for the outline panel. */
export function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  for (const line of content.split("\n")) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2] });
  }
  return headings;
}

export function wordCount(content: string): number {
  const words = content.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Toggle the GFM task checkbox ([ ] <-> [x]) on a given 0-based line. */
export function toggleTaskInContent(content: string, lineIndex: number): string {
  const lines = content.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return content;
  lines[lineIndex] = lines[lineIndex].replace(
    /^(\s*[-*+]\s+)\[([ xX])\]/,
    (_match: string, prefix: string, mark: string) =>
      `${prefix}[${mark.toLowerCase() === "x" ? " " : "x"}]`,
  );
  return lines.join("\n");
}

// --- File tree ---------------------------------------------------------------

export type VaultTree = { folder: string; notes: Note[] }[];

/**
 * Group files by folder for the file explorer (root folder first).
 * `extraFolderNames` ensures empty folders still show up as collapsible groups.
 */
export function buildVaultTree(
  notes: Note[],
  extraFolderNames: readonly string[] = [],
): VaultTree {
  const byFolder = new Map<string, Note[]>();
  for (const name of extraFolderNames) byFolder.set(name, []);
  for (const note of notes) {
    const list = byFolder.get(note.folder) ?? [];
    list.push(note);
    byFolder.set(note.folder, list);
  }
  const folders = [...byFolder.keys()].sort((a, b) => {
    if (a === "") return -1; // root first
    if (b === "") return 1;
    return a.localeCompare(b);
  });
  return folders.map((folder) => ({
    folder,
    notes: (byFolder.get(folder) ?? []).sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
  }));
}
