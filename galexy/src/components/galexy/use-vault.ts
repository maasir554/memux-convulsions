"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getVaultDb,
  loadAllItems,
  persistContent,
  type VaultDb,
} from "@/lib/db/vault-db";
import type { Note } from "@/lib/mock-notes";

type Vault = {
  /** null while the DB is loading. */
  notes: Note[] | null;
  updateContent: (id: string, content: string) => void;
};

/** Loads the vault from PGlite and writes content edits through to it. */
export function useVault(): Vault {
  const dbRef = useRef<VaultDb | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const db = await getVaultDb();
      const loaded = await loadAllItems(db);
      if (!mounted) return;
      dbRef.current = db;
      setNotes(loaded);
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

  return { notes, updateContent };
}
