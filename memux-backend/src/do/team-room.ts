/**
 * TeamRoom — one Durable Object per team.
 *
 * Holds:
 *  - Live WebSocket connections (via the Hibernation API, so idle DOs cost
 *    almost nothing — the runtime evicts them and rehydrates only when a
 *    message arrives).
 *  - Full chat history in DO storage, keyed by `msg:<paddedTs>:<id>` so
 *    `list({ prefix: "msg:" })` returns chronological order naturally.
 *  - Presence: connected user IDs derived live from `ctx.getWebSockets()`.
 *    Nothing to persist — when the last socket goes away, presence is empty.
 *
 * Authorisation:
 *  - The Worker authenticates the caller and verifies membership BEFORE
 *    forwarding to this DO. The DO trusts headers `x-memux-user-id` /
 *    `x-memux-user-name` / `x-memux-user-image` set by the Worker.
 *  - The DO is only addressable via its binding from the Worker, so a
 *    client cannot bypass the Worker.
 *
 * Protocol over the WebSocket (JSON each frame):
 *  - server → client
 *      { type: "hello",     presence: [userId…], history: [ChatMessage…] }
 *      { type: "message",   message: ChatMessage }
 *      { type: "presence",  join?: userId, leave?: userId, current: [userId…] }
 *  - client → server
 *      { type: "send",      body: string }
 *      { type: "ping" }       (optional keep-alive; runtime also pings)
 */

import { DurableObject } from "cloudflare:workers";

import { type ChatMessage, MAX_MESSAGE_LENGTH, parseMentions } from "../lib/messages";
import type { WorkerEnv } from "../env";

interface Attachment {
  userId: string;
  userName: string;
  image: string | null;
}

// 13-digit padded ms timestamp keeps lexicographic == chronological through
// the year 2287. Suffix with a uuid so two messages in the same millisecond
// still sort deterministically.
function messageKey(ms: number, id: string): string {
  return `msg:${String(ms).padStart(13, "0")}:${id}`;
}

export class TeamRoom extends DurableObject<WorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") return this.handleWebSocket(request);
    if (url.pathname === "/messages" && request.method === "GET") {
      return this.handleHistory(url);
    }
    if (url.pathname === "/messages" && request.method === "POST") {
      return this.handleSend(request);
    }
    return new Response("not found", { status: 404 });
  }

  // ─────────────────────────────────────────────────────────────────────
  // WebSocket upgrade
  // ─────────────────────────────────────────────────────────────────────

  private async handleWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const user = this.extractUser(request);
    if (!user) return new Response("missing user identity", { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation API: DO can be evicted while the WS stays alive. Identity
    // travels with the socket via serializeAttachment so the DO doesn't
    // need to keep an in-memory map.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(user satisfies Attachment);

    // Initial hello — history + current presence (including self).
    const history = await this.recentMessages(50);
    const presence = this.currentPresence();
    server.send(
      JSON.stringify({
        type: "hello",
        you: user.userId,
        presence,
        history,
      }),
    );

    // Tell everyone else a new member joined.
    this.broadcastExcept(server, {
      type: "presence",
      join: user.userId,
      current: presence,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Hibernation callbacks
  // ─────────────────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const msg = parsed as { type?: string; body?: string };

    if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* socket dead */ }
      return;
    }

    if (msg.type === "send" && typeof msg.body === "string") {
      const attached = ws.deserializeAttachment() as Attachment | null;
      if (!attached) return;
      const body = msg.body.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!body) return;

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: attached.userId,
        senderName: attached.userName,
        senderImage: attached.image,
        body,
        mentions: parseMentions(body),
        createdAt: new Date().toISOString(),
      };

      await this.storeMessage(message);
      this.broadcast({ type: "message", message });
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // The runtime may give us a closed socket whose attachment is still
    // readable; protect against it being null after a hard error.
    let userId: string | null = null;
    try {
      const a = ws.deserializeAttachment() as Attachment | null;
      userId = a?.userId ?? null;
    } catch { /* ignore */ }

    try { ws.close(code, "client closed"); } catch { /* already closed */ }

    if (userId && !this.userStillConnected(userId)) {
      this.broadcast({
        type: "presence",
        leave: userId,
        current: this.currentPresence(),
      });
    }
  }

  async webSocketError(_ws: WebSocket, _err: unknown): Promise<void> {
    // Errors land here before webSocketClose; let close do the cleanup.
  }

  // ─────────────────────────────────────────────────────────────────────
  // History + send (REST surface, mirrors WS for clients that prefer it)
  // ─────────────────────────────────────────────────────────────────────

  private async handleHistory(url: URL): Promise<Response> {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const before = url.searchParams.get("before");
    const messages = await this.recentMessages(limit, before ?? undefined);
    return Response.json({ messages });
  }

  private async handleSend(request: Request): Promise<Response> {
    const user = this.extractUser(request);
    if (!user) return new Response("missing user identity", { status: 401 });

    const body = (await request.json().catch(() => null)) as { body?: string } | null;
    const text = body?.body?.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) return new Response(JSON.stringify({ error: "body required" }), { status: 400 });

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: user.userId,
      senderName: user.userName,
      senderImage: user.image,
      body: text,
      mentions: parseMentions(text),
      createdAt: new Date().toISOString(),
    };
    await this.storeMessage(message);
    this.broadcast({ type: "message", message });
    return Response.json({ message }, { status: 201 });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Storage helpers
  // ─────────────────────────────────────────────────────────────────────

  private async storeMessage(m: ChatMessage): Promise<void> {
    const ms = Date.parse(m.createdAt);
    await this.ctx.storage.put(messageKey(ms, m.id), m);
  }

  /**
   * Most-recent-first scan. Optionally bounded by a cursor — pass the
   * `key` (not the message id) of the oldest message already shown, and
   * we return the page strictly older than it.
   */
  private async recentMessages(limit: number, beforeKey?: string): Promise<ChatMessage[]> {
    const opts: DurableObjectListOptions = {
      prefix: "msg:",
      reverse: true,
      limit,
    };
    if (beforeKey) opts.end = beforeKey;
    const map = await this.ctx.storage.list<ChatMessage>(opts);
    // Reverse so caller gets oldest→newest within the page (UI-friendly).
    return Array.from(map.values()).reverse();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Presence + broadcast
  // ─────────────────────────────────────────────────────────────────────

  private currentPresence(): string[] {
    const seen = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a?.userId) seen.add(a.userId);
      } catch { /* ignore */ }
    }
    return Array.from(seen);
  }

  /**
   * After a close, presence should only drop `userId` if NO other
   * connection from that user remains (multi-tab / multi-device).
   */
  private userStillConnected(userId: string): boolean {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a?.userId === userId) return true;
      } catch { /* ignore */ }
    }
    return false;
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch { /* closed */ }
    }
  }

  private broadcastExcept(exclude: WebSocket, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try { ws.send(data); } catch { /* closed */ }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Header → user (set by the Worker after auth + membership check)
  // ─────────────────────────────────────────────────────────────────────

  private extractUser(request: Request): Attachment | null {
    const id = request.headers.get("x-memux-user-id");
    const name = request.headers.get("x-memux-user-name");
    if (!id || !name) return null;
    return {
      userId: id,
      userName: name,
      image: request.headers.get("x-memux-user-image") || null,
    };
  }
}
