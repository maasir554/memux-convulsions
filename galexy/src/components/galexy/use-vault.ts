"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteFolderName,
  deleteItem,
  getVaultDb,
  insertFolder,
  insertItem,
  loadAllFolders,
  loadAllItems,
  persistContent,
  persistItemFolder,
  persistLinks,
  persistPdfAnnotations,
  persistSheetMeta,
  persistTitle,
  renameFolderPath,
  type VaultDb,
} from "@/lib/db/vault-db";
import { deleteBlob, writeBlob } from "@/lib/blob-store";
import type {
  ItemType,
  Note,
  PdfAnnotation,
  SheetMeta,
} from "@/lib/mock-notes";

/** What the toolbar / folder-actions menu needs to create a new file. */
export type NewNoteInput = {
  type: "markdown" | "code" | "csv";
  title: string;
  folder?: string;
  language?: string;
};

/** Allowed upload categories. Determines how the file is stored. */
export type UploadCategory = "markdown" | "csv" | "pdf" | "image";

export type UploadInput = {
  category: UploadCategory;
  folder?: string;
  files: File[];
};

type Vault = {
  /** null while the DB is loading. */
  notes: Note[] | null;
  /** Explicit folder names (includes empty ones). null while loading. */
  folders: string[] | null;
  updateContent: (id: string, content: string) => void;
  updateLinks: (id: string, links: string[]) => void;
  renameItem: (id: string, title: string) => void;
  renameFolder: (oldPath: string, newPath: string) => Promise<void>;
  moveItem: (id: string, folder: string) => void;
  moveFolder: (oldPath: string, newParent: string) => Promise<void>;
  updateSheetMeta: (id: string, meta: SheetMeta) => void;
  updatePdfAnnotations: (id: string, annotations: PdfAnnotation[]) => void;
  /** Returns the new item's id once it lands in local state. */
  createNote: (input: NewNoteInput) => Promise<string>;
  createFolder: (name: string) => Promise<void>;
  /** Returns the new items' ids in upload order (skips files that errored). */
  uploadFiles: (input: UploadInput) => Promise<string[]>;
  /** Removes the item from the DB, local state, and OPFS (if it had a blob). */
  removeItem: (id: string) => Promise<void>;
  /**
   * Remove a folder. If `cascade`, every item with that folder name is
   * removed first (returns the ids that were removed so callers can also
   * close any tabs for them).
   */
  removeFolder: (
    name: string,
    opts?: { cascade?: boolean },
  ) => Promise<string[]>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultContent(input: NewNoteInput): string {
  switch (input.type) {
    case "markdown":
      return `# ${input.title}\n\n`;
    case "code":
    case "csv":
      return "";
  }
}

/** Filename → { title (no extension), ext? } for uploads. */
function stripExtension(name: string): { title: string; ext: string | null } {
  const m = name.match(/^(.+)\.([a-zA-Z0-9]+)$/);
  if (!m) return { title: name, ext: null };
  return { title: m[1], ext: m[2].toLowerCase() };
}

/** Read a File as UTF-8 text (md / csv uploads). */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Loads the vault from PGlite and writes content edits through to it. */
export function useVault(): Vault {
  const dbRef = useRef<VaultDb | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [folders, setFolders] = useState<string[] | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const db = await getVaultDb();
      const [loadedNotes, loadedFolders] = await Promise.all([
        loadAllItems(db),
        loadAllFolders(db),
      ]);
      if (!mounted) return;
      dbRef.current = db;
      setNotes(loadedNotes);
      setFolders(loadedFolders);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const updateContent = useCallback((id: string, content: string) => {
    setNotes((prev) =>
      prev ? prev.map((n) => (n.id === id ? { ...n, content } : n)) : prev,
    );
    const db = dbRef.current;
    if (db) void persistContent(db, id, content);
  }, []);

  const updateLinks = useCallback((id: string, links: string[]) => {
    setNotes((prev) =>
      prev ? prev.map((n) => (n.id === id ? { ...n, links } : n)) : prev,
    );
    const db = dbRef.current;
    if (db) void persistLinks(db, id, links);
  }, []);

  const renameItem = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setNotes((prev) =>
      prev
        ? prev.map((n) => (n.id === id ? { ...n, title: trimmed } : n))
        : prev,
    );
    const db = dbRef.current;
    if (db) void persistTitle(db, id, trimmed);
  }, []);

  const renameFolder = useCallback(
    async (oldPath: string, newPath: string): Promise<void> => {
      if (oldPath === newPath || !newPath.trim()) return;
      const target = newPath.trim();
      const oldPrefix = `${oldPath}/`;
      // Items inside the renamed folder (exact match or nested) get their
      // `folder` rewritten to use the new prefix.
      setNotes((prev) =>
        prev
          ? prev.map((n) => {
              if (n.folder === oldPath) return { ...n, folder: target };
              if (n.folder.startsWith(oldPrefix)) {
                return {
                  ...n,
                  folder: target + n.folder.slice(oldPath.length),
                };
              }
              return n;
            })
          : prev,
      );
      // Same logic on the folders list.
      setFolders((prev) =>
        prev
          ? prev.map((name) => {
              if (name === oldPath) return target;
              if (name.startsWith(oldPrefix))
                return target + name.slice(oldPath.length);
              return name;
            })
          : prev,
      );
      const db = dbRef.current;
      if (db) {
        try {
          await renameFolderPath(db, oldPath, target);
        } catch (err) {
          console.warn("[vault] renameFolderPath failed:", err);
        }
      }
    },
    [],
  );

  const moveItem = useCallback((id: string, folder: string) => {
    setNotes((prev) =>
      prev ? prev.map((n) => (n.id === id ? { ...n, folder } : n)) : prev,
    );
    const db = dbRef.current;
    if (db) void persistItemFolder(db, id, folder);
  }, []);

  /**
   * Move a folder into a new parent. The folder's last-segment name is
   * preserved — only its prefix changes. Reuses renameFolderPath under the
   * hood so all nested folders + items inside are updated atomically.
   *
   * Cycle prevention: dropping a folder onto itself or any descendant is a
   * no-op (silent), since `oldPath` would prefix-match `newParent`.
   */
  const moveFolder = useCallback(
    async (oldPath: string, newParent: string): Promise<void> => {
      const lastSlash = oldPath.lastIndexOf("/");
      const segment =
        lastSlash >= 0 ? oldPath.slice(lastSlash + 1) : oldPath;
      const newPath = newParent ? `${newParent}/${segment}` : segment;
      if (newPath === oldPath) return;
      // Block cycles: cannot move into self or descendant.
      if (newParent === oldPath || newParent.startsWith(`${oldPath}/`)) return;
      await renameFolder(oldPath, newPath);
    },
    [renameFolder],
  );

  const updateSheetMeta = useCallback((id: string, meta: SheetMeta) => {
    setNotes((prev) =>
      prev
        ? prev.map((n) => (n.id === id ? { ...n, sheetMeta: meta } : n))
        : prev,
    );
    const db = dbRef.current;
    if (db) void persistSheetMeta(db, id, meta);
  }, []);

  const updatePdfAnnotations = useCallback(
    (id: string, annotations: PdfAnnotation[]) => {
      setNotes((prev) =>
        prev
          ? prev.map((n) =>
              n.id === id ? { ...n, pdfAnnotations: annotations } : n,
            )
          : prev,
      );
      const db = dbRef.current;
      if (db) void persistPdfAnnotations(db, id, annotations);
    },
    [],
  );

  /** Internal: insert a fully-formed Note (used by both create and upload). */
  const insertNote = useCallback(async (note: Note): Promise<void> => {
    setNotes((prev) => (prev ? [...prev, note] : [note]));
    const db = dbRef.current;
    if (!db) return;
    try {
      await insertItem(db, note);
    } catch (err) {
      console.warn("[vault] insertItem failed:", err);
      setNotes((prev) =>
        prev ? prev.filter((n) => n.id !== note.id) : prev,
      );
      throw err;
    }
  }, []);

  const createNote = useCallback(
    async (input: NewNoteInput): Promise<string> => {
      const note: Note = {
        id: uid(),
        title: input.title,
        folder: input.folder ?? "",
        type: input.type,
        summary: "",
        content: defaultContent(input),
        tags: [],
        updatedAt: todayIso(),
        language: input.type === "code" ? (input.language ?? "ts") : undefined,
      };
      await insertNote(note);
      return note.id;
    },
    [insertNote],
  );

  const createFolder = useCallback(async (rawName: string): Promise<void> => {
    const name = rawName.trim();
    if (!name) return;
    setFolders((prev) => {
      if (!prev) return [name];
      if (prev.includes(name)) return prev;
      return [...prev, name];
    });
    const db = dbRef.current;
    if (db) {
      try {
        await insertFolder(db, name);
      } catch (err) {
        console.warn("[vault] insertFolder failed:", err);
      }
    }
  }, []);

  const uploadFiles = useCallback(
    async ({ category, folder, files }: UploadInput): Promise<string[]> => {
      const ids: string[] = [];
      for (const file of files) {
        const { title, ext } = stripExtension(file.name);
        let note: Note;
        try {
          if (category === "markdown" || category === "csv") {
            const content = await readAsText(file);
            note = {
              id: uid(),
              title,
              folder: folder ?? "",
              type: category as ItemType,
              summary: "",
              content,
              tags: [],
              updatedAt: todayIso(),
            };
          } else {
            // pdf / image — store binary in OPFS, keep just the key on the row.
            const blobKey = await writeBlob(file);
            note = {
              id: uid(),
              title,
              folder: folder ?? "",
              type: category as ItemType,
              summary: "",
              content: "",
              tags: [],
              updatedAt: todayIso(),
              blobKey,
              language: ext ?? undefined,
            };
          }
          await insertNote(note);
          ids.push(note.id);
        } catch (err) {
          console.warn("[vault] upload failed for", file.name, err);
        }
      }
      return ids;
    },
    [insertNote],
  );

  const removeItem = useCallback(async (id: string): Promise<void> => {
    // Snapshot the row before optimistic removal so we can roll back / cleanup.
    let snapshot: Note | undefined;
    setNotes((prev) => {
      if (!prev) return prev;
      snapshot = prev.find((n) => n.id === id);
      return prev.filter((n) => n.id !== id);
    });
    const db = dbRef.current;
    if (!db) return;
    try {
      const blobKey = await deleteItem(db, id);
      if (blobKey) void deleteBlob(blobKey);
    } catch (err) {
      console.warn("[vault] deleteItem failed:", err);
      // Roll back so the user doesn't lose data without realising.
      if (snapshot) {
        const restored = snapshot;
        setNotes((prev) => (prev ? [...prev, restored] : [restored]));
      }
      throw err;
    }
  }, []);

  const removeFolder = useCallback(
    async (
      name: string,
      opts?: { cascade?: boolean },
    ): Promise<string[]> => {
      const cascade = opts?.cascade ?? false;
      const removedIds: string[] = [];

      // A path is inside this folder if it matches exactly OR sits under
      // a `${name}/` prefix. Without the prefix check, items in nested
      // subfolders survive, and buildNestedTree re-creates the parent
      // from their orphaned paths.
      const prefix = `${name}/`;
      const isInside = (folderPath: string): boolean =>
        folderPath === name || folderPath.startsWith(prefix);

      if (cascade) {
        // Snapshot child ids from current local state, then delete each.
        const childIds: string[] = [];
        setNotes((prev) => {
          if (!prev) return prev;
          for (const n of prev) if (isInside(n.folder)) childIds.push(n.id);
          return prev;
        });
        for (const id of childIds) {
          try {
            await removeItem(id);
            removedIds.push(id);
          } catch {
            // removeItem already logs + rolls back; keep going so we still
            // try to drop the folder row.
          }
        }
      }

      setFolders((prev) =>
        prev ? prev.filter((n) => !isInside(n)) : prev,
      );
      const db = dbRef.current;
      if (db) {
        try {
          await deleteFolderName(db, name);
        } catch (err) {
          console.warn("[vault] deleteFolderName failed:", err);
        }
      }
      return removedIds;
    },
    [removeItem],
  );

  return {
    notes,
    folders,
    updateContent,
    updateLinks,
    updateSheetMeta,
    updatePdfAnnotations,
    renameItem,
    renameFolder,
    moveItem,
    moveFolder,
    createNote,
    createFolder,
    uploadFiles,
    removeItem,
    removeFolder,
  };
}
