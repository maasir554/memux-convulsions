/**
 * useTeamRoom — connects to the TeamRoom DO over WebSocket and exposes
 * the live state (messages, presence) plus a `send(body)` function.
 *
 * Frame handling matches the protocol in memux-backend/src/do/team-room.ts:
 *   server → client: hello | message | presence | pong
 *   client → server: send | ping
 *
 * Keep-alive: the runtime hibernates idle WebSockets; we send a "ping"
 * every 30s so a slow reverse proxy / network device doesn't kill the
 * connection in the meantime. (Cloudflare itself doesn't need this; some
 * intermediate hops do.)
 *
 * Reconnect: minimal exponential backoff on close. Resets on success.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { teamRoomWsUrl } from "./api";
import type { ChatMessage } from "./types";

export type RoomStatus = "connecting" | "open" | "closed" | "error";

export interface TeamRoomState {
  status: RoomStatus;
  myId: string | null;
  messages: ChatMessage[];
  presence: Set<string>;
  send: (body: string) => boolean;
}

type ServerFrame =
  | { type: "hello"; you: string; presence: string[]; history: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "presence"; join?: string; leave?: string; current: string[] }
  | { type: "pong" };

const PING_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useTeamRoom(teamId: string | null): TeamRoomState {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectMs = useRef<number>(RECONNECT_BASE_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!teamId) {
      setStatus("closed");
      return;
    }

    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");

      const ws = new WebSocket(teamRoomWsUrl(teamId!));
      wsRef.current = ws;

      const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* dead */ }
        }
      }, PING_INTERVAL_MS);

      ws.addEventListener("open", () => {
        if (cancelled) return;
        setStatus("open");
        reconnectMs.current = RECONNECT_BASE_MS;
      });

      ws.addEventListener("message", (e) => {
        if (cancelled) return;
        let frame: ServerFrame;
        try {
          frame = JSON.parse(e.data) as ServerFrame;
        } catch {
          return;
        }
        switch (frame.type) {
          case "hello":
            setMyId(frame.you);
            setMessages(frame.history);
            setPresence(new Set(frame.presence));
            break;
          case "message":
            setMessages((prev) => [...prev, frame.message]);
            break;
          case "presence":
            setPresence((prev) => {
              const next = new Set(prev);
              if (frame.join) next.add(frame.join);
              if (frame.leave) next.delete(frame.leave);
              // The DO sends `current` as the source of truth; trust it over
              // our incremental tracking in case we missed a join/leave.
              return new Set(frame.current);
            });
            break;
          case "pong":
            break;
        }
      });

      ws.addEventListener("error", () => {
        if (cancelled) return;
        setStatus("error");
      });

      ws.addEventListener("close", () => {
        clearInterval(pingTimer);
        if (cancelled) return;
        setStatus("closed");
        const delay = reconnectMs.current;
        reconnectMs.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        reconnectTimer.current = setTimeout(connect, delay);
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
        wsRef.current.close(1000, "unmount");
      }
    };
  }, [teamId]);

  const send = useCallback((body: string) => {
    const trimmed = body.trim();
    const ws = wsRef.current;
    if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type: "send", body: trimmed }));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { status, myId, messages, presence, send };
}
