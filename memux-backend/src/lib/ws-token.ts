/**
 * Short-lived signed token for WebSocket auth.
 *
 * Why this exists:
 *   The browser session cookie is set on the API origin (Workers in dev,
 *   Vercel in prod after rewrites). The TeamRoom WebSocket cannot go
 *   through Vercel rewrites — they're HTTP-only. So the WS connects
 *   directly to workers.dev, an origin where the session cookie isn't
 *   present (third-party cookie restrictions). We bridge with a tiny
 *   HMAC-signed token: the frontend fetches it on a same-origin HTTP
 *   endpoint (cookie works there), then opens the WS with `?token=`.
 *
 * Threat model:
 *   - Token TTL is short (60s) so a leaked URL has near-zero replay value.
 *   - Token is bound to a specific teamId — can't be reused for other rooms.
 *   - Signing key is BETTER_AUTH_SECRET, identical to what Better-Auth uses
 *     for session signing — same blast radius if it leaks.
 *   - URL query strings appear in logs; the short TTL is the mitigation.
 *
 * Format:  base64url(JSON(payload)) + "." + base64url(HMAC-SHA256)
 */

export interface WsTokenPayload {
  teamId: string;
  userId: string;
  userName: string;
  userImage: string | null;
  /** Unix seconds. */
  exp: number;
}

const TOKEN_TTL_SECONDS = 60;

export function tokenExpiry(): number {
  return Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
}

export async function signWsToken(
  secret: string,
  payload: WsTokenPayload,
): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

export async function verifyWsToken(
  secret: string,
  token: string,
): Promise<WsTokenPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = await hmacSign(secret, body);
  if (!timingSafeEqual(sig, expected)) return null;

  let payload: WsTokenPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(body));
    payload = JSON.parse(json) as WsTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.teamId !== "string" || typeof payload.userId !== "string") {
    return null;
  }
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────
// Crypto helpers — Web Crypto is available in Workers
// ─────────────────────────────────────────────────────────────────────────

async function hmacSign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time string comparison. Length-leak resistant only when both
 *  values are HMAC outputs of the same length — fine for our use. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
