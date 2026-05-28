import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatRole = "system" | "user" | "assistant";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mime?: string };

export type ChatMessage = {
  id: string;
  role: ChatRole;
  parts: ContentPart[];
  streaming?: boolean;
  createdAt: number;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  contextSize: number;
  think: boolean;
  temperature: number;
  messages: ChatMessage[];
  /**
   * Per-chat override of the global Vault (knowledge-base) toggle.
   * undefined = inherit clientSettings.kbModeDefault; true / false =
   * explicit per-chat decision (set when the user clicks the chip × or
   * the +-menu toggle).
   */
  kbMode?: boolean;
};

type State = {
  chats: ChatSession[];
  activeId: string | null;

  newChat: (defaults?: Partial<ChatSession>) => string;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  selectChat: (id: string) => void;

  /** Mutate the active session. */
  patchActive: (patch: Partial<ChatSession>) => void;
  setActiveModel: (model: string, contextSize?: number) => void;
  setActiveThink: (v: boolean) => void;
  setActiveTemperature: (t: number) => void;
  setActiveContextSize: (n: number) => void;

  /** Messages on the active session. */
  addMessage: (m: ChatMessage) => void;
  appendText: (messageId: string, delta: string) => void;
  finishMessage: (messageId: string) => void;
  deleteMessage: (messageId: string) => void;
  replaceMessages: (msgs: ChatMessage[]) => void;
  clearActiveMessages: () => void;
  /**
   * Remove every message from `messageId` (inclusive) to the end of the
   * active session. Used by Regenerate (drop the assistant message + any
   * subsequent turns) and Edit-user (drop the user message + everything
   * after it before putting the text back into the composer).
   */
  removeMessagesFrom: (messageId: string) => void;
};

export function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Default model + context for newly-created chats. Locked to gemma-4-31b-it
 * (262 144 tokens) because that's our chosen cloud default. If the user is
 * on Lemonade and the local server doesn't have this model, ChatView's
 * defaulter heals by swapping to whatever the local /models endpoint
 * actually serves first.
 */
const DEFAULT_MODEL_ID = "gemma-4-31b-it";
const DEFAULT_CONTEXT_SIZE = 262_144;

function makeChat(defaults: Partial<ChatSession> = {}): ChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    model: defaults.model ?? DEFAULT_MODEL_ID,
    contextSize: defaults.contextSize ?? DEFAULT_CONTEXT_SIZE,
    think: defaults.think ?? false,
    temperature: defaults.temperature ?? 0.7,
    messages: [],
    ...defaults,
  };
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      chats: [],
      activeId: null,

      newChat: (defaults) => {
        // Prevent two empty chats from coexisting: if an empty chat is
        // already in the list, just select it instead of creating another.
        // "Empty" = zero messages. Title may be "New chat" (default) or
        // anything else — we still reuse it, since the user clearly
        // hasn't started using it yet.
        const existingEmpty = get().chats.find((c) => c.messages.length === 0);
        if (existingEmpty) {
          set({ activeId: existingEmpty.id });
          return existingEmpty.id;
        }
        const c = makeChat(defaults);
        set((s) => ({ chats: [c, ...s.chats], activeId: c.id }));
        return c.id;
      },

      deleteChat: (id) => {
        set((s) => {
          const chats = s.chats.filter((c) => c.id !== id);
          const activeId = s.activeId === id ? (chats[0]?.id ?? null) : s.activeId;
          return { chats, activeId };
        });
      },

      renameChat: (id, title) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
          ),
        }));
      },

      selectChat: (id) => set({ activeId: id }),

      patchActive: (patch) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
          ),
        }));
      },

      setActiveModel: (model, contextSize) =>
        get().patchActive({ model, ...(contextSize ? { contextSize } : {}) }),
      setActiveThink: (think) => get().patchActive({ think }),
      setActiveTemperature: (temperature) => get().patchActive({ temperature }),
      setActiveContextSize: (contextSize) => get().patchActive({ contextSize }),

      addMessage: (m) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id
              ? { ...c, messages: [...c.messages, m], updatedAt: Date.now() }
              : c,
          ),
        }));
      },

      appendText: (messageId, delta) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) => {
            if (c.id !== id) return c;
            const messages = c.messages.map((m) => {
              if (m.id !== messageId) return m;
              const last = m.parts[m.parts.length - 1];
              if (last && last.type === "text") {
                const updated: ContentPart = {
                  type: "text",
                  text: last.text + delta,
                };
                return {
                  ...m,
                  parts: [...m.parts.slice(0, -1), updated],
                };
              }
              return {
                ...m,
                parts: [...m.parts, { type: "text", text: delta } as ContentPart],
              };
            });
            return { ...c, messages, updatedAt: Date.now() };
          }),
        }));
      },

      finishMessage: (messageId) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, streaming: false } : m,
                  ),
                }
              : c,
          ),
        }));
      },

      deleteMessage: (messageId) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id
              ? {
                  ...c,
                  messages: c.messages.filter((m) => m.id !== messageId),
                  updatedAt: Date.now(),
                }
              : c,
          ),
        }));
      },

      replaceMessages: (messages) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === id ? { ...c, messages, updatedAt: Date.now() } : c,
          ),
        }));
      },

      clearActiveMessages: () => get().replaceMessages([]),

      removeMessagesFrom: (messageId) => {
        const id = get().activeId;
        if (!id) return;
        set((s) => ({
          chats: s.chats.map((c) => {
            if (c.id !== id) return c;
            const idx = c.messages.findIndex((m) => m.id === messageId);
            if (idx < 0) return c;
            return {
              ...c,
              messages: c.messages.slice(0, idx),
              updatedAt: Date.now(),
            };
          }),
        }));
      },
    }),
    {
      name: "plasma:chats",
      version: 2,
    },
  ),
);

export function useActiveChat(): ChatSession | null {
  return useStore((s) => s.chats.find((c) => c.id === s.activeId) ?? null);
}

export function messageText(m: ChatMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");
}
