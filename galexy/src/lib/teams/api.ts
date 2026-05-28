/**
 * Thin wrapper around fetch() for the memux-backend Teams API.
 *
 * Every call:
 *  - prefixes baseURL (NEXT_PUBLIC_MEMUX_API_URL, falls back to localhost:8787)
 *  - sends credentials so the Better-Auth session cookie flows
 *  - throws ApiError on non-2xx with the server's error message attached
 *
 * Kept as plain functions rather than a class so individual calls can
 * be passed straight to TanStack Query / SWR / etc. later without a
 * `this` rebind.
 */

import type {
  ChatAttachment,
  ChatMessage,
  TeamDetail,
  TeamInvite,
  TeamSummary,
} from "./types";

export const baseURL =
  process.env.NEXT_PUBLIC_MEMUX_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`${baseURL}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 204 No Content
  if (r.status === 204) return undefined as T;

  const text = await r.text();
  const data = text ? safeJson(text) : null;

  if (!r.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : null) ?? `${method} ${path} failed (${r.status})`;
    throw new ApiError(r.status, data, msg);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Teams
// ──────────────────────────────────────────────────────────────────────

export const teamsApi = {
  list: () => request<{ teams: TeamSummary[] }>("GET", "/api/teams"),

  create: (name: string) =>
    request<{ team: { id: string; name: string; createdAt: string; role: "owner" } }>(
      "POST",
      "/api/teams",
      { name },
    ),

  detail: (id: string) =>
    request<{ team: TeamDetail }>("GET", `/api/teams/${id}`),

  remove: (id: string) => request<void>("DELETE", `/api/teams/${id}`),

  leave: (id: string) => request<void>("POST", `/api/teams/${id}/leave`),

  join: (code: string) =>
    request<{ team: { id: string; name: string }; alreadyMember: boolean }>(
      "POST",
      "/api/teams/join",
      { code },
    ),

  // Invites
  createInvite: (
    teamId: string,
    opts: { maxUses?: number; expiresInHours?: number } = {},
  ) =>
    request<{ invite: TeamInvite }>(
      "POST",
      `/api/teams/${teamId}/invites`,
      opts,
    ),

  listInvites: (teamId: string) =>
    request<{ invites: TeamInvite[] }>("GET", `/api/teams/${teamId}/invites`),

  revokeInvite: (teamId: string, inviteId: string) =>
    request<void>("DELETE", `/api/teams/${teamId}/invites/${inviteId}`),

  // Messages (REST). Live updates go through the WebSocket — see use-team-room.
  messages: (teamId: string, opts: { before?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.before) qs.set("before", opts.before);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ messages: ChatMessage[] }>(
      "GET",
      `/api/teams/${teamId}/messages${suffix}`,
    );
  },

  sendMessage: (teamId: string, body: string) =>
    request<{ message: ChatMessage }>(
      "POST",
      `/api/teams/${teamId}/messages`,
      { body },
    ),

  // Upload a single file. The Worker enforces size + membership.
  // Multipart isn't a JSON body so we bypass the shared request() helper.
  uploadAttachment: async (teamId: string, file: File): Promise<ChatAttachment> => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${baseURL}/api/teams/${teamId}/attachments`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const text = await r.text();
    const data = text ? safeJson(text) : null;
    if (!r.ok) {
      const msg =
        (data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : null) ?? `Upload failed (${r.status})`;
      throw new ApiError(r.status, data, msg);
    }
    return (data as { attachment: ChatAttachment }).attachment;
  },
};

/** URL the browser hits to fetch an attachment. Session cookie required. */
export function attachmentUrl(key: string): string {
  return `${baseURL}/api/attachments/${key}`;
}

/**
 * Browser WebSocket URL for the TeamRoom DO. Converts `http(s)://...` →
 * `ws(s)://...` and appends the path.
 */
export function teamRoomWsUrl(teamId: string): string {
  return `${baseURL.replace(/^http/, "ws")}/api/teams/${teamId}/ws`;
}
