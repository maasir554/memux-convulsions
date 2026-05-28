/**
 * ID generators.
 *
 * - `genId()` for primary keys: `crypto.randomUUID()` (36 chars including
 *   hyphens). Random enough that we don't worry about collisions inside
 *   one D1 database.
 * - `genInviteCode()` for team invites: URL-safe base64 of 9 random
 *   bytes → 12 chars. Looks like `qm9Z-tEK_p3X`. Long enough to be
 *   unguessable by brute force (~72 bits), short enough to send in a
 *   message.
 */

export function genId(): string {
  return crypto.randomUUID();
}

export function genInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
