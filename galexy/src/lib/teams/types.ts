/**
 * Shared types between the frontend and memux-backend's Teams API.
 *
 * Kept loose on purpose — the backend types live in TS too but in a
 * separate package; duplicating the shapes is cheaper than wiring up
 * a shared workspace right now. Worth revisiting if either side drifts.
 */

export type TeamRole = "owner" | "admin" | "member";

export interface TeamSummary {
  id: string;
  name: string;
  createdAt: string;
  role: TeamRole;
  memberCount: number;
}

export interface TeamMember {
  userId: string;
  name: string;
  image: string | null;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamDetail {
  id: string;
  name: string;
  createdAt: string;
  myRole: TeamRole;
  members: TeamMember[];
}

export interface ChatAttachment {
  /** R2 key — shape: teams/<teamId>/<uuid>/<filename> */
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderImage: string | null;
  body: string;
  mentions: string[];
  attachments?: ChatAttachment[];
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  code: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
