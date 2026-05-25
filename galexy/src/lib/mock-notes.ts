// Mock vault data + link helpers for the galexy (Obsidian-like) shell.
// See galexy/OBSIDIAN.md for the product reference this models.

export type Note = {
  id: string;
  title: string;
  folder: string; // "" = vault root
  content: string; // raw markdown
  tags: string[];
  updatedAt: string; // ISO date
};

// --- The vault ---------------------------------------------------------------

export const NOTES: Note[] = [
  {
    id: "welcome",
    title: "Welcome",
    folder: "",
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
    tags: ["daily"],
    updatedAt: "2026-05-25",
    content: `# 2026-05-25

- [x] Scaffold the [[MEMUX]] shell
- [ ] Wire up the [[Graph View]]
- [ ] Block out time for [[Deep Work]]

#daily`,
  },
];

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
  /** noteId -> ids of notes it links to */
  outgoing: Record<string, string[]>;
  /** noteId -> ids of notes that link to it */
  backlinks: Record<string, string[]>;
};

/** Build the outgoing/backlink index from the current note contents. */
export function buildLinkGraph(notes: Note[]): LinkGraph {
  const idByTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
  const outgoing: Record<string, string[]> = {};
  const backlinks: Record<string, string[]> = {};

  for (const note of notes) {
    outgoing[note.id] ??= [];
    backlinks[note.id] ??= [];
  }

  for (const note of notes) {
    const targets = new Set<string>();
    for (const title of extractWikiLinkTitles(note.content)) {
      const targetId = idByTitle.get(title.toLowerCase());
      if (targetId && targetId !== note.id) targets.add(targetId);
    }
    for (const targetId of targets) {
      outgoing[note.id].push(targetId);
      backlinks[targetId].push(note.id);
    }
  }

  return { outgoing, backlinks };
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

/** Group notes by folder for the file explorer (root folder first). */
export function buildVaultTree(notes: Note[]): VaultTree {
  const byFolder = new Map<string, Note[]>();
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
