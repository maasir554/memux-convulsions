"use client";

import { useMemo, useState } from "react";
import {
  FilePlus,
  FolderPlus,
  Sheet,
  SquareCode,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FolderNode } from "@/lib/mock-notes";

import type { CreateKind } from "@/components/galexy/file-explorer";

const KIND_OPTIONS: { value: CreateKind; label: string; Icon: typeof FilePlus }[] = [
  { value: "markdown", label: "Markdown note", Icon: FilePlus },
  { value: "code", label: "Code file", Icon: SquareCode },
  { value: "csv", label: "Sheet (CSV)", Icon: Sheet },
  { value: "folder", label: "Folder", Icon: FolderPlus },
];

const PLACEHOLDER_BY_KIND: Record<CreateKind, string> = {
  markdown: "Note name",
  code: "filename.ts",
  csv: "Sheet name",
  folder: "Folder name",
};

/** Flatten a folder tree into a depth-first list of path/label pairs. */
function flattenFolders(
  nodes: FolderNode[],
  depth = 0,
): Array<{ path: string; label: string; depth: number }> {
  const out: Array<{ path: string; label: string; depth: number }> = [];
  for (const node of nodes) {
    out.push({ path: node.path, label: node.label, depth });
    if (node.children.length > 0) {
      out.push(...flattenFolders(node.children, depth + 1));
    }
  }
  return out;
}

/** Best-effort filename parsing: strip extension, infer code language. */
function parseName(
  raw: string,
  kind: CreateKind,
): { title: string; language?: string } {
  const trimmed = raw.trim();
  if (kind === "markdown") {
    return { title: trimmed.replace(/\.md$/i, "") };
  }
  if (kind === "csv") {
    return { title: trimmed.replace(/\.csv$/i, "") };
  }
  if (kind === "code") {
    const m = trimmed.match(/^(.+)\.(ts|tsx|js|jsx|py|rs|go|sh|json|css)$/i);
    if (m) return { title: m[1], language: m[2].toLowerCase() };
    return { title: trimmed };
  }
  return { title: trimmed };
}

type CreateNoteInput = {
  type: "markdown" | "code" | "csv";
  title: string;
  folder?: string;
  language?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Top-level folder nodes (already nested). */
  folderTree: FolderNode[];
  /** Folder path to pre-select; "" for vault root. */
  initialFolder?: string;
  /** Kind to pre-select. */
  initialKind?: CreateKind;
  onCreateNote: (input: CreateNoteInput) => void | Promise<void>;
  onCreateFolder: (path: string) => void | Promise<void>;
};

export function CreateItemDialog({
  open,
  onOpenChange,
  folderTree,
  initialFolder = "",
  initialKind = "markdown",
  onCreateNote,
  onCreateFolder,
}: Props) {
  // The parent re-keys this component when `open` flips to true, so plain
  // useState defaults give us a fresh form on every open — no resetting in
  // an effect.
  const [kind, setKind] = useState<CreateKind>(initialKind);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<string>(initialFolder);

  const flatFolders = useMemo(
    () => flattenFolders(folderTree),
    [folderTree],
  );

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (kind === "folder") {
      // Folders are created under the selected parent — final path is
      // "<parent>/<name>" (or just "<name>" at root).
      const path = folder ? `${folder}/${trimmed}` : trimmed;
      void onCreateFolder(path);
    } else {
      const { title, language } = parseName(trimmed, kind);
      if (!title) return;
      void onCreateNote({
        type: kind,
        title,
        folder,
        language,
      });
    }
    onOpenChange(false);
  }

  const KindIcon = KIND_OPTIONS.find((k) => k.value === kind)?.Icon ?? FilePlus;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create new</DialogTitle>
          <DialogDescription>
            Pick a type, name it, and choose where it lives in the vault.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="create-kind">Type</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as CreateKind)}
            >
              <SelectTrigger id="create-kind" className="w-full">
                <SelectValue>
                  <KindIcon className="size-4" />
                  {KIND_OPTIONS.find((k) => k.value === kind)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map(({ value, label, Icon }) => (
                  <SelectItem key={value} value={value}>
                    <Icon className="size-4" />
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={PLACEHOLDER_BY_KIND[kind]}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-location">Location</Label>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger id="create-location" className="w-full">
                <SelectValue placeholder="Vault root" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Vault root</SelectItem>
                {flatFolders.map(({ path, label, depth }) => (
                  <SelectItem key={path} value={path}>
                    <span
                      style={{ paddingLeft: `${depth * 12}px` }}
                      className="font-mono text-xs"
                    >
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {path}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
