/**
 * Message types and helpers for TeamRoom.
 *
 * Mentions are parsed server-side at send time so:
 *  - notification routing (Phase 6) doesn't have to re-parse client output
 *  - the parsed list is immutable across clients (no per-client drift)
 *
 * Syntax: `@<userId>` where userId matches Better-Auth's id shape
 * (alphanumeric, sometimes with hyphens). We don't resolve names → ids
 * server-side; the client is responsible for inserting the canonical
 * @<userId> token when the user picks someone from a typeahead.
 */

export interface ChatAttachment {
  /** R2 object key. Includes teamId so we can authorise per-team without
   *  a separate lookup. Shape: `teams/<teamId>/<uuid>/<filename>`. */
  key: string;
  filename: string;
  contentType: string;
  /** Bytes. Set by the upload handler from the R2 put result. */
  size: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderImage: string | null;
  body: string;
  /** User IDs mentioned in the body via `@<userId>`. De-duplicated. */
  mentions: string[];
  /** Files attached to this message. R2-backed. */
  attachments?: ChatAttachment[];
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** Cap per upload — Workers free-tier request body limit + UX. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB
/** Max attachments per message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const MENTION_RE = /(?:^|\s)@([A-Za-z0-9_-]{8,64})/g;

export function parseMentions(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    seen.add(m[1]);
  }
  return Array.from(seen);
}

export const MAX_MESSAGE_LENGTH = 4000;
