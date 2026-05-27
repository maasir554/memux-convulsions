/**
 * OPFS-backed blob store. Uploaded PDFs, images, etc. live here; the blob key
 * is persisted on the item row (`blob_key`), and viewers resolve it to an
 * object URL on demand via `readBlobUrl`.
 *
 * OPFS is the natural fit: it's per-origin private storage, durable across
 * reloads, and unlike base64-in-Postgres it doesn't bloat the items table.
 */

const DIR_NAME = "galexy-blobs";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR_NAME, { create: true });
}

/** Write a file to OPFS, returning the key needed to retrieve it. */
export async function writeBlob(file: File): Promise<string> {
  const dir = await getDir();
  // Keep the original filename suffix on disk so dev tools / future exports
  // remain meaningful; collision risk is killed by the UUID prefix.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${uid()}-${safeName}`;
  const handle = await dir.getFileHandle(key, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
  return key;
}

/**
 * Returns an object URL for the blob. The caller owns lifecycle and should
 * `URL.revokeObjectURL` when done (use the `useBlobUrl` hook for components).
 */
export async function readBlobUrl(key: string): Promise<string> {
  const dir = await getDir();
  const handle = await dir.getFileHandle(key);
  const file = await handle.getFile();
  return URL.createObjectURL(file);
}

/** Best-effort delete; missing keys are silently ignored. */
export async function deleteBlob(key: string): Promise<void> {
  try {
    const dir = await getDir();
    await dir.removeEntry(key);
  } catch {
    // entry already gone — nothing to do
  }
}
