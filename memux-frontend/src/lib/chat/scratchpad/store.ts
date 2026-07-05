"use client";

/**
 * IndexedDB-backed scratchpad store. One row per chat session.
 *
 * Why IndexedDB and not PGlite: PGlite is already loaded with the vault DB
 * and has migration weight; the scratchpad is purely chat-session state
 * with one tiny table, so raw IDB is leaner. If we ever want cross-device
 * sync, we'd point this at the same backend that syncs PGlite.
 *
 * Single object store keyed by `sessionId`. Reads + writes are atomic per
 * session — no transactions across sessions. The whole scratchpad is read
 * back as one blob and re-serialised on save; a typical session is < 50 KB
 * even with hundreds of tool calls.
 */

import type { Candidate, Scratchpad, ScratchpadHistoryEntry, ToolName } from "@/lib/chat/types";

const DB_NAME = "memux-chat-scratchpad";
const STORE = "sessions";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "sessionId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = Promise.resolve(fn(store));
    t.oncomplete = () => out.then(resolve).catch(reject);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ============================================================ public API */

export async function loadScratchpad(sessionId: string): Promise<Scratchpad | null> {
  return tx("readonly", async (store) => {
    const row = await reqAsync(store.get(sessionId));
    return (row as Scratchpad | undefined) ?? null;
  });
}

export async function saveScratchpad(sp: Scratchpad): Promise<void> {
  await tx("readwrite", (store) => {
    store.put({ ...sp, updatedAt: Date.now() });
  });
}

export async function deleteScratchpad(sessionId: string): Promise<void> {
  await tx("readwrite", (store) => {
    store.delete(sessionId);
  });
}

export async function listSessions(): Promise<Array<{ sessionId: string; question: string; updatedAt: number }>> {
  return tx("readonly", async (store) => {
    const all = (await reqAsync(store.getAll())) as Scratchpad[];
    return all
      .map((sp) => ({
        sessionId: sp.sessionId,
        question: sp.question,
        updatedAt: sp.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

/* ============================================================ mutations */

/** Initialise an empty scratchpad for a new session. */
export function emptyScratchpad(sessionId: string, question: string): Scratchpad {
  return {
    sessionId,
    question,
    workingNotes: "",
    candidates: {},
    shortlist: [],
    history: [],
    plans: {},
    updatedAt: Date.now(),
  };
}

/**
 * Merge a fresh batch of refs into the candidate map, updating RRF scores.
 *
 * RRF formula: score += 1 / (k + rank). We use k=60 (standard from the
 * Cormack paper); higher k flattens the contribution curve which keeps a
 * later-tool surfacing from being drowned out by an earlier high-confidence
 * one.
 */
export function mergeCandidates(
  candidates: Record<string, Candidate>,
  refs: Array<{
    itemId: string;
    title: string;
    type: Candidate["type"];
    folder: string;
    snippet?: string;
    score?: number;
  }>,
  tool: ToolName,
  rrfK = 60,
): Record<string, Candidate> {
  const next = { ...candidates };
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    const rank = i + 1;
    const contribution = 1 / (rrfK + rank);
    const existing = next[r.itemId];
    if (existing) {
      next[r.itemId] = {
        ...existing,
        score: existing.score + contribution,
        evidence: [
          ...existing.evidence,
          { tool, rank, rawScore: r.score, snippet: r.snippet ?? "" },
        ],
        updatedAt: Date.now(),
      };
    } else {
      next[r.itemId] = {
        itemId: r.itemId,
        title: r.title,
        type: r.type,
        folder: r.folder,
        score: contribution,
        evidence: [{ tool, rank, rawScore: r.score, snippet: r.snippet ?? "" }],
        highlights: [],
        updatedAt: Date.now(),
      };
    }
  }
  return next;
}

/** Top-K candidates by RRF score, with stable tiebreak on itemId. */
export function shortlistTopK(
  candidates: Record<string, Candidate>,
  k = 8,
): Candidate[] {
  return Object.values(candidates)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.itemId.localeCompare(b.itemId);
    })
    .slice(0, k);
}

/** Append a history entry — used both by harness and replay. */
export function withHistoryEntry(
  sp: Scratchpad,
  entry: ScratchpadHistoryEntry,
): Scratchpad {
  return { ...sp, history: [...sp.history, entry] };
}
