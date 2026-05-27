import { asc, desc, eq, sql } from "drizzle-orm";

import { getVaultDb } from "@/lib/db/vault-db";
import {
  indexRuns,
  type DbIndexRun,
  type IndexerFileRef,
  type RunStatus,
} from "@/lib/db/schema";
import { deleteBlob, writeBlob } from "@/lib/blob-store";

/** Plain-object shape used by the UI; matches DB but with numeric dates. */
export type Group = {
  id: string;
  queuePosition: number | null;
  status: RunStatus;
  /** Empty string means "AI should name it on completion". */
  groupName: string;
  prompt: string;
  files: IndexerFileRef[];
  scratchpadMd: string;
  folderName: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

const EDITABLE: ReadonlySet<RunStatus> = new Set(["draft", "queued"]);

function rowToGroup(row: DbIndexRun): Group {
  return {
    id: row.id,
    queuePosition: row.queuePosition ?? null,
    status: row.status,
    groupName: row.groupName,
    prompt: row.prompt,
    files: row.files,
    scratchpadMd: row.scratchpadMd,
    folderName: row.folderName ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
  };
}

export async function loadGroups(): Promise<Group[]> {
  const db = await getVaultDb();
  const rows = await db
    .select()
    .from(indexRuns)
    .orderBy(
      // queue_position first (nulls last), then created_at desc.
      sql`COALESCE(${indexRuns.queuePosition}, 1000000)`,
      desc(indexRuns.createdAt),
    );
  return rows.map(rowToGroup);
}

export async function loadGroup(id: string): Promise<Group | null> {
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  return row ? rowToGroup(row) : null;
}

export async function createDraft(initial?: Partial<Group>): Promise<string> {
  const db = await getVaultDb();
  const id = `run-${crypto.randomUUID()}`;
  await db.insert(indexRuns).values({
    id,
    status: "draft",
    groupName: initial?.groupName ?? "",
    prompt: initial?.prompt ?? "",
    files: initial?.files ?? [],
  });
  return id;
}

/** Partial update on draft/queued groups. Throws if the group is in a terminal/active status. */
export async function updateDraft(
  id: string,
  patch: Partial<Pick<Group, "groupName" | "prompt" | "files">>,
): Promise<void> {
  const db = await getVaultDb();
  const [row] = await db
    .select({ status: indexRuns.status })
    .from(indexRuns)
    .where(eq(indexRuns.id, id));
  if (!row) throw new Error(`Group ${id} not found`);
  if (!EDITABLE.has(row.status)) {
    throw new Error(`Cannot edit group in status ${row.status}`);
  }
  const set: Partial<typeof indexRuns.$inferInsert> = {};
  if (patch.groupName !== undefined) set.groupName = patch.groupName;
  if (patch.prompt !== undefined) set.prompt = patch.prompt;
  if (patch.files !== undefined) set.files = patch.files;
  if (Object.keys(set).length === 0) return;
  await db.update(indexRuns).set(set).where(eq(indexRuns.id, id));
}

/**
 * Attach Files to a draft group: writes each File to OPFS, appends an
 * IndexerFileRef to files[]. Skips files already attached by (name,size) so
 * a double-drop doesn't duplicate.
 */
export async function attachFiles(id: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  if (!row) throw new Error(`Group ${id} not found`);
  if (!EDITABLE.has(row.status)) {
    throw new Error(`Cannot attach files in status ${row.status}`);
  }
  const seen = new Set(row.files.map((f) => `${f.name}:${f.size}`));
  const next: IndexerFileRef[] = [...row.files];
  for (const file of files) {
    const key = `${file.name}:${file.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const refId = `f-${crypto.randomUUID()}`;
    let blobKey: string;
    try {
      blobKey = await writeBlob(file);
    } catch (err) {
      console.warn("[queue] OPFS write failed:", err);
      continue;
    }
    next.push({
      id: refId,
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      blobKey,
    });
  }
  await db.update(indexRuns).set({ files: next }).where(eq(indexRuns.id, id));
}

/** Remove a single file from a draft group and delete its OPFS blob. */
export async function removeFile(id: string, fileRefId: string): Promise<void> {
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  if (!row) return;
  if (!EDITABLE.has(row.status)) return;
  const removed = row.files.find((f) => f.id === fileRefId);
  const next = row.files.filter((f) => f.id !== fileRefId);
  await db.update(indexRuns).set({ files: next }).where(eq(indexRuns.id, id));
  if (removed?.blobKey) {
    try {
      await deleteBlob(removed.blobKey);
    } catch (err) {
      console.warn("[queue] OPFS delete failed:", err);
    }
  }
}

/** Delete a group entirely. Refuses if it's running. */
export async function deleteGroup(id: string): Promise<void> {
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  if (!row) return;
  if (
    row.status !== "draft" &&
    row.status !== "queued" &&
    row.status !== "done" &&
    row.status !== "failed" &&
    row.status !== "cancelled"
  ) {
    throw new Error(`Cannot delete group while ${row.status}`);
  }
  for (const f of row.files) {
    if (!f.blobKey) continue;
    try {
      await deleteBlob(f.blobKey);
    } catch (err) {
      console.warn("[queue] OPFS delete failed:", err);
    }
  }
  await db.delete(indexRuns).where(eq(indexRuns.id, id));
}

/** draft → queued, assigning the next available queue_position. */
export async function enqueue(id: string): Promise<void> {
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  if (!row) throw new Error(`Group ${id} not found`);
  if (row.status !== "draft") {
    throw new Error(`Cannot enqueue: status=${row.status}`);
  }
  if (row.files.length === 0) {
    throw new Error("Cannot enqueue an empty group");
  }
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${indexRuns.queuePosition}), 0)` })
    .from(indexRuns)
    .where(eq(indexRuns.status, "queued"));
  await db
    .update(indexRuns)
    .set({ status: "queued", queuePosition: Number(maxPos) + 1 })
    .where(eq(indexRuns.id, id));
}

/** queued → draft (pull a group back out of the queue to edit it). */
export async function dequeue(id: string): Promise<void> {
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  if (!row) return;
  if (row.status !== "queued") {
    throw new Error(`Cannot dequeue: status=${row.status}`);
  }
  await db
    .update(indexRuns)
    .set({ status: "draft", queuePosition: null })
    .where(eq(indexRuns.id, id));
}

/**
 * Move a queued group to position `newPos` (1-based). All other queued groups
 * shift to make room. No-op for non-queued groups.
 */
export async function reorder(id: string, newPos: number): Promise<void> {
  const db = await getVaultDb();
  const [row] = await db.select().from(indexRuns).where(eq(indexRuns.id, id));
  if (!row || row.status !== "queued") return;
  const queued = await db
    .select({ id: indexRuns.id, pos: indexRuns.queuePosition })
    .from(indexRuns)
    .where(eq(indexRuns.status, "queued"))
    .orderBy(asc(indexRuns.queuePosition));
  const filtered = queued.filter((r) => r.id !== id);
  const insertAt = Math.max(0, Math.min(newPos - 1, filtered.length));
  filtered.splice(insertAt, 0, { id, pos: null });
  // Re-number all queued groups so positions stay dense.
  for (let i = 0; i < filtered.length; i++) {
    await db
      .update(indexRuns)
      .set({ queuePosition: i + 1 })
      .where(eq(indexRuns.id, filtered[i].id));
  }
}

/**
 * Pop the next group off the queue and mark it preparing. Returns the group
 * row so the orchestrator can hand it to its first agent. Returns null if
 * the queue is empty.
 */
export async function popNextForRun(): Promise<Group | null> {
  const db = await getVaultDb();
  const [row] = await db
    .select()
    .from(indexRuns)
    .where(eq(indexRuns.status, "queued"))
    .orderBy(asc(indexRuns.queuePosition))
    .limit(1);
  if (!row) return null;
  await db
    .update(indexRuns)
    .set({
      status: "preparing",
      queuePosition: null,
      startedAt: new Date(),
    })
    .where(eq(indexRuns.id, row.id));
  return rowToGroup({
    ...row,
    status: "preparing",
    queuePosition: null,
    startedAt: new Date(),
  });
}

/** Used by the orchestrator (Phase 2+) to transition between states. */
export async function setStatus(
  id: string,
  status: RunStatus,
  extra?: Partial<
    Pick<DbIndexRun, "scratchpadMd" | "folderName" | "error" | "finishedAt">
  >,
): Promise<void> {
  const db = await getVaultDb();
  const set: Partial<typeof indexRuns.$inferInsert> = { status };
  if (extra?.scratchpadMd !== undefined) set.scratchpadMd = extra.scratchpadMd;
  if (extra?.folderName !== undefined) set.folderName = extra.folderName;
  if (extra?.error !== undefined) set.error = extra.error;
  if (extra?.finishedAt !== undefined) set.finishedAt = extra.finishedAt;
  await db.update(indexRuns).set(set).where(eq(indexRuns.id, id));
}

/** Append a line to the scratchpad. Cheap; used for agent narration. */
export async function appendScratch(id: string, line: string): Promise<void> {
  const db = await getVaultDb();
  await db
    .update(indexRuns)
    .set({
      scratchpadMd: sql`COALESCE(${indexRuns.scratchpadMd}, '') || ${line + "\n"}`,
    })
    .where(eq(indexRuns.id, id));
}

