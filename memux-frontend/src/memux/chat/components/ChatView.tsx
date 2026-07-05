"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Brain } from "lucide-react";

import { runChatTurn, type NativeContent } from "@/lib/chat/harness/orchestrator";
import { useAgentStore } from "@/memux/chat/lib/agent-store";
import { AgentPanel } from "@/memux/chat/components/AgentPanel";
import { ChatThinkingBanner } from "@/memux/chat/components/ChatThinkingBanner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/memux/chat/components/ai/conversation";
import { Message } from "@/memux/chat/components/ai/message";
import {
  PromptInput,
  type Attachment,
} from "@/memux/chat/components/ai/prompt-input";
import {
  useStore,
  useActiveChat,
  newId,
  messageText,
  type ChatMessage,
  type ContentPart,
} from "@/memux/chat/lib/store";
import { streamChat, listModels, getHealth, type ModelInfo } from "@/memux/chat/lib/api";
import { useClient } from "@/memux/chat/lib/clientSettings";
import { readAsDataUrl, filterImages } from "@/memux/chat/lib/files";
import { cn } from "@/memux/chat/lib/utils";

export function ChatView({
  pendingFiles,
  consumePendingFiles,
  onOpenSettings,
}: {
  pendingFiles: File[];
  consumePendingFiles: () => void;
  onOpenSettings: () => void;
}) {
  const active = useActiveChat();
  const renameChat = useStore((s) => s.renameChat);
  const appendText = useStore((s) => s.appendText);
  const finishMessage = useStore((s) => s.finishMessage);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const replaceMessages = useStore((s) => s.replaceMessages);
  const removeMessagesFrom = useStore((s) => s.removeMessagesFrom);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const setActiveThink = useStore((s) => s.setActiveThink);
  const patchActive = useStore((s) => s.patchActive);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [, setHealth] = useState<{ ok: boolean; provider: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Persisted UI bits — right-pane visibility, token meter, KB default.
  // Sidebar collapse is owned by Sidebar.tsx end-to-end now.
  const agentPanelOpen = useClient((s) => s.agentPanelOpen);
  const setAgentPanelOpen = useClient((s) => s.setAgentPanelOpen);
  const kbModeDefault = useClient((s) => s.kbModeDefault);

  // Per-chat KB (Vault) toggle. undefined → inherit the global default.
  const kbMode = active?.kbMode ?? kbModeDefault;
  const setKbMode = (v: boolean) => patchActive({ kbMode: v });

  const applyAgentEvent = useAgentStore((s) => s.apply);
  const resetAgent = useAgentStore((s) => s.reset);
  const captureAgentSnapshot = useAgentStore((s) => s.captureSnapshot);
  const enterViewMode = useAgentStore((s) => s.enterViewMode);
  const exitViewMode = useAgentStore((s) => s.exitViewMode);
  const attachAgentHistory = useStore((s) => s.attachAgentHistory);

  // Re-load models whenever the transport mode changes.
  const transportMode = useClient((s) => s.mode);
  const directBaseUrl = useClient((s) => s.directBaseUrl);
  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ ok: false, provider: "?" }));
    listModels().then(setModels).catch(() => setModels([]));
  }, [transportMode, directBaseUrl]);

  // Self-healing model picker.
  //   - waits for the catalogue to load
  //   - if the active chat's model is empty OR isn't in the catalogue,
  //     swaps to gemma-4-31b-it (preferred) or falls back to the first
  //     model the backend reports
  // Handles both the fresh-chat case (model: "" from a pre-default
  // persisted chat) and the wrong-server case (model id baked in by
  // makeChat but the local Lemonade server doesn't serve it).
  useEffect(() => {
    if (!active || models.length === 0) return;
    const stillValid =
      active.model && models.some((m) => m.id === active.model);
    if (stillValid) return;
    const preferred =
      models.find((m) => m.id === "gemma-4-31b-it") ?? models[0];
    if (preferred) setActiveModel(preferred.id, preferred.context_size);
  }, [active, models, setActiveModel]);

  // Pull dropped files into the composer.
  useEffect(() => {
    if (pendingFiles.length === 0) return;
    void attachFiles(pendingFiles);
    consumePendingFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFiles]);

  // Generic compose-append channel: any widget (or other surface) can
  // dispatch a `memux:compose-append` CustomEvent with { text } and the
  // composer will fold the text into the current draft. The original
  // caller was the concept-cloud widget; the listener stays because
  // other surfaces may grow into it.
  useEffect(() => {
    function onAppend(e: Event) {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      const text = (detail?.text ?? "").trim();
      if (!text) return;
      setDraft((cur) => (cur.trim() ? `${cur.trim()} ${text}` : text));
    }
    window.addEventListener("memux:compose-append", onAppend);
    return () => window.removeEventListener("memux:compose-append", onAppend);
  }, []);

  async function attachFiles(files: File[]) {
    const imgs = filterImages(files);
    const next: Attachment[] = [];
    for (const f of imgs) {
      const url = await readAsDataUrl(f);
      next.push({ id: newId(), url, mime: f.type, name: f.name });
    }
    if (next.length) setAttachments((cur) => [...cur, ...next]);
  }

  function buildUserParts(): ContentPart[] {
    const parts: ContentPart[] = [];
    if (draft.trim()) parts.push({ type: "text", text: draft.trim() });
    for (const a of attachments) {
      parts.push({ type: "image", url: a.url, mime: a.mime });
    }
    return parts;
  }

  /**
   * Build a token-cheap recent-history view for KB-mode chats. We send
   * only completed text turns (skip streaming / system / image-only),
   * keep the most recent N, and truncate each one — assistant answers
   * can be very long once charts/tables/outlines are inlined and the
   * model doesn't need the full prose to maintain conversational
   * grounding. Tool calls and function responses are deliberately
   * dropped: re-running a stale tool wave from N turns ago would be
   * wasteful and risk fetching different data than the prior answer
   * cited.
   */
  function buildRecentHistory(prior: ChatMessage[]): NativeContent[] {
    const MAX_MESSAGES = 8; // 4 user+assistant pairs of grounding
    const MAX_CHARS_PER_MSG = 2000;
    const recent = prior.filter((m) => !m.streaming && m.role !== "system").slice(-MAX_MESSAGES);
    const out: NativeContent[] = [];
    for (const m of recent) {
      const text = m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (!text) continue;
      const trimmed =
        text.length > MAX_CHARS_PER_MSG
          ? `${text.slice(0, MAX_CHARS_PER_MSG)}\n…[trimmed]`
          : text;
      out.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: trimmed }],
      });
    }
    return out;
  }

  async function send(overrideParts?: ContentPart[]) {
    if (!active || !active.model) {
      onOpenSettings();
      return;
    }
    const parts = overrideParts ?? buildUserParts();
    if (parts.length === 0) return;

    // Snapshot the prior conversation BEFORE we append the new user/assistant
    // pair, so the agent's recent-history pass sees the past turns only.
    // (The about-to-be-sent question is delivered separately via args.question.)
    const priorMessages = active.messages;

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      parts,
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: "assistant",
      parts: [],
      streaming: true,
      createdAt: Date.now(),
    };
    const nextMessages = [...active.messages, userMsg, assistantMsg];
    replaceMessages(nextMessages);

    // Auto-title first turn.
    if (active.title === "New chat" && active.messages.length === 0) {
      const firstText = parts.find((p) => p.type === "text");
      if (firstText && firstText.type === "text") {
        const t = firstText.text.slice(0, 40).trim();
        if (t) renameChat(active.id, t);
      }
    }

    setDraft("");
    setAttachments([]);
    setIsStreaming(true);

    const ctl = new AbortController();
    abortRef.current = ctl;

    if (kbMode) {
      resetAgent();
      // Sending a new prompt always returns the panel to live mode —
      // any past-turn snapshot the user might be viewing steps aside.
      exitViewMode();
      // Reveal the agent panel automatically on the first KB turn so
      // the user sees the live activity stream the instant their query
      // fires. No-op when already open — the setter is idempotent.
      if (!agentPanelOpen) setAgentPanelOpen(true);
      const userText = parts.find((p) => p.type === "text");
      const question = userText?.type === "text" ? userText.text : "";
      await runChatTurn({
        sessionId: active.id,
        question,
        model: active.model,
        recentHistory: buildRecentHistory(priorMessages),
        signal: ctl.signal,
        onEvent: (event) => {
          applyAgentEvent(event);
          if (event.kind === "synth-token") {
            appendText(assistantMsg.id, event.token);
          } else if (event.kind === "synth-done") {
            // Capture the live agent state into the assistant message so
            // the eye button can replay it later.
            attachAgentHistory(assistantMsg.id, captureAgentSnapshot());
            finishMessage(assistantMsg.id);
            setIsStreaming(false);
          } else if (event.kind === "turn-error") {
            appendText(assistantMsg.id, `\n\n[error: ${event.error}]`);
            // Even on error, snapshot what we have — partial activity
            // is useful for the user to inspect what went wrong.
            attachAgentHistory(assistantMsg.id, captureAgentSnapshot());
            finishMessage(assistantMsg.id);
            setIsStreaming(false);
          }
        },
      });
      return;
    }

    await streamChat({
      model: active.model,
      messages: [...active.messages, userMsg],
      think: active.think,
      temperature: active.temperature,
      signal: ctl.signal,
      onDelta: (d) => appendText(assistantMsg.id, d),
      onDone: () => {
        finishMessage(assistantMsg.id);
        setIsStreaming(false);
      },
      onError: (err) => {
        appendText(assistantMsg.id, `\n\n[error: ${String(err)}]`);
        finishMessage(assistantMsg.id);
        setIsStreaming(false);
      },
    });
  }

  function stop() {
    abortRef.current?.abort();
    setIsStreaming(false);
  }

  /**
   * Replay an assistant message: find the user turn that triggered it,
   * drop everything from that user turn forward, and resend it. Acts as
   * "regenerate" on the assistant message hover row.
   */
  function regenerateAssistant(assistantId: string) {
    if (!active || isStreaming) return;
    const idx = active.messages.findIndex((m) => m.id === assistantId);
    if (idx <= 0) return;
    // Walk backward to the most recent user message before the target.
    let userIdx = idx - 1;
    while (userIdx >= 0 && active.messages[userIdx].role !== "user") userIdx--;
    if (userIdx < 0) return;
    const userMsg = active.messages[userIdx];
    const parts = userMsg.parts as ContentPart[];
    removeMessagesFrom(userMsg.id);
    void send(parts);
  }

  /**
   * Edit a user message: lift its text back into the composer, drop the
   * message itself and everything after it. The user re-sends manually.
   */
  function editUserMessage(userId: string) {
    if (!active || isStreaming) return;
    const msg = active.messages.find((m) => m.id === userId);
    if (!msg) return;
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n");
    removeMessagesFrom(userId);
    setDraft(text);
  }

  function copyAssistant(assistantId: string) {
    if (!active) return;
    const msg = active.messages.find((m) => m.id === assistantId);
    if (!msg) return;
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n");
    void navigator.clipboard.writeText(text);
  }

  const modelInfo = models.find((m) => m.id === active?.model);

  // Index of the last user message so the hover-edit-3-dot only shows
  // on the most recent user bubble (per requirement #10).
  const lastUserIdx = useMemo(() => {
    if (!active) return -1;
    for (let i = active.messages.length - 1; i >= 0; i--) {
      if (active.messages[i].role === "user") return i;
    }
    return -1;
  }, [active]);

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <ConversationEmptyState
          title="No chat selected"
          description="Create a new chat from the sidebar."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Conversation>
          {active.messages.length === 0 ? (
            <ConversationEmptyState
              title="Start a conversation"
              description={
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Drop an image anywhere, or use the + menu to attach.
                </span>
              }
            />
          ) : (
            <ConversationContent>
              {active.messages.map((m, i) => (
                <Message
                  key={m.id}
                  role={m.role}
                  streaming={m.streaming}
                  isLatestUser={m.role === "user" && i === lastUserIdx}
                  hasAgentHistory={!!m.agentHistory}
                  onDelete={() => deleteMessage(m.id)}
                  onRegenerate={
                    m.role === "assistant"
                      ? () => regenerateAssistant(m.id)
                      : undefined
                  }
                  onCopy={
                    m.role === "assistant" ? () => copyAssistant(m.id) : undefined
                  }
                  onEdit={
                    m.role === "user" && i === lastUserIdx
                      ? () => editUserMessage(m.id)
                      : undefined
                  }
                  onViewAgent={
                    m.role === "assistant" && m.agentHistory
                      ? () => {
                          enterViewMode(m.agentHistory!);
                          if (!agentPanelOpen) setAgentPanelOpen(true);
                        }
                      : undefined
                  }
                  parts={m.parts.map((p) =>
                    p.type === "text"
                      ? { type: "text", text: p.text }
                      : { type: "image", url: p.url },
                  )}
                />
              ))}
              {active.think && isStreaming && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2">
                  <Brain className="h-3 w-3" />
                  think mode is on for this turn
                </div>
              )}
              {kbMode && <ChatThinkingBanner />}
            </ConversationContent>
          )}
        </Conversation>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          {attachments.length > 0 && modelInfo && modelInfo.vision === false && (
            <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 px-3 py-2 text-xs">
              <span className="font-medium">{modelInfo.id}</span> isn&apos;t tagged as a
              vision model — it will likely reject the image. Pick a vision model
              in settings.
            </div>
          )}
          <PromptInput
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            onStop={stop}
            isStreaming={isStreaming}
            attachments={attachments}
            onAttach={attachFiles}
            onRemoveAttachment={(id) =>
              setAttachments((cur) => cur.filter((a) => a.id !== id))
            }
            think={active.think}
            onThinkChange={setActiveThink}
            thinkSupported={modelInfo?.reasoning}
            kbMode={kbMode}
            onKbToggle={() => setKbMode(!kbMode)}
            placeholder={
              active.model ? "Message…" : "Pick a model in settings to start"
            }
          />
          <div className="mt-2 text-[11px] text-muted-foreground text-center">
            Enter to send · Shift+Enter for newline · drop or paste images anywhere
          </div>
        </div>

        {/* keep messageText referenced so future tooltip uses survive tree-shaking */}
        <span hidden>{messageText({ id: "", role: "system", parts: [], createdAt: 0 })}</span>
      </div>

      {/* Right-side agent panel — animates open/closed without unmounting.
          `min-h-0` is critical: without it the wrapper's flex layout lets
          children grow past the parent's bounded height, which is what
          made the panel "break" the page when many activity cards landed. */}
      <div
        className={cn(
          "hidden min-h-0 md:flex shrink-0 overflow-hidden",
          "transition-[width,min-width,max-width,border-left-width,opacity] duration-250 ease-out",
          agentPanelOpen
            ? "w-[40%] min-w-[360px] max-w-[640px] opacity-100"
            : "w-0 min-w-0 max-w-0 opacity-0",
        )}
        aria-hidden={!agentPanelOpen}
      >
        <AgentPanel />
      </div>
    </div>
  );
}
