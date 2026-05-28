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

  /** Show the context-window token meter in the chat header. Off by default. */
  showTokenCounter: boolean;
  /** Sidebar collapsed → icon-rail. Persists per browser. */
  sidebarCollapsed: boolean;
  /** Right-side AgentPanel visible. Default true so KB activity is on screen. */
  agentPanelOpen: boolean;
  /**
   * Whether the Vault (knowledge-base) chip is on by default for newly-created
   * chats. Existing chats remember their own kbMode separately. Default true.
   */
  kbModeDefault: boolean;

  setMode: (m: TransportMode) => void;
  setDirectBaseUrl: (u: string) => void;
  setDirectApiKey: (k: string | undefined) => void;
  setShowTokenCounter: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setAgentPanelOpen: (v: boolean) => void;
  setKbModeDefault: (v: boolean) => void;
};

export const useClient = create<State>()(
  persist(
    (set) => ({
      // Cloud (backend) is the friendliest default — the user doesn't need
      // a local model server running to start chatting. They can opt into
      // Lemonade from settings whenever they want.
      mode: "backend",
      directBaseUrl: "http://localhost:13305/v1",
      directApiKey: undefined,
      showTokenCounter: false,
      sidebarCollapsed: false,
      agentPanelOpen: true,
      kbModeDefault: true,

      setMode: (mode) => set({ mode }),
      setDirectBaseUrl: (directBaseUrl) => set({ directBaseUrl }),
      setDirectApiKey: (directApiKey) => set({ directApiKey }),
      setShowTokenCounter: (showTokenCounter) => set({ showTokenCounter }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setAgentPanelOpen: (agentPanelOpen) => set({ agentPanelOpen }),
      setKbModeDefault: (kbModeDefault) => set({ kbModeDefault }),
    }),
    {
      name: "plasma:client",
      // v3 bumps the default `mode` from "direct" to "backend". Wipe-on-
      // bump rather than migrate: anyone with a persisted `mode: direct`
      // from before chose it; we shouldn't silently flip them. Anyone who
      // never opened settings has effectively no preference — they fall
      // back to the new defaults.
      version: 3,
    },
  ),
);
