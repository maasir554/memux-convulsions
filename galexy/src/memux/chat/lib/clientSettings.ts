import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Client-side transport configuration. Lives entirely in the browser
 * (localStorage), so the frontend can be shipped as a static SPA that talks
 * directly to a user's local AI server without needing our backend deployed.
 *
 * - "direct": frontend fetches `${directBaseUrl}/...` itself. The backend is
 *   not used. Think-mode translation and model-metadata derivation happen
 *   in `lib/api.ts`.
 * - "backend": frontend calls our backend at /v1, /api. Use this when the
 *   frontend is hosted somewhere remote and the backend sits next to the
 *   actual upstream, or when you want to keep an API key off the client.
 */
export type TransportMode = "direct" | "backend";

type State = {
  mode: TransportMode;
  directBaseUrl: string;
  directApiKey?: string;

  setMode: (m: TransportMode) => void;
  setDirectBaseUrl: (u: string) => void;
  setDirectApiKey: (k: string | undefined) => void;
};

export const useClient = create<State>()(
  persist(
    (set) => ({
      mode: "direct",
      directBaseUrl: "http://localhost:13305/v1",
      directApiKey: undefined,

      setMode: (mode) => set({ mode }),
      setDirectBaseUrl: (directBaseUrl) => set({ directBaseUrl }),
      setDirectApiKey: (directApiKey) => set({ directApiKey }),
    }),
    { name: "plasma:client", version: 1 },
  ),
);
