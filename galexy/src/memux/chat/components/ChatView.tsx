"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Sparkles, Wand2 } from "lucide-react";
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
import { Button } from "@/memux/chat/components/ui/button";
import { Separator } from "@/memux/chat/components/ui/separator";
import { ContextMeter } from "@/memux/chat/components/ContextMeter";
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
import { countMessagesTokens } from "@/memux/chat/lib/tokens";
import { compactConversation, COMPACT_MIN_MESSAGES } from "@/memux/chat/lib/compact";
import { readAsDataUrl, filterImages } from "@/memux/chat/lib/files";

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
  const addMessage = useStore((s) => s.addMessage);
  const appendText = useStore((s) => s.appendText);
  const finishMessage = useStore((s) => s.finishMessage);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const replaceMessages = useStore((s) => s.replaceMessages);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const setActiveThink = useStore((s) => s.setActiveThink);
  const clear = useStore((s) => s.clearActiveMessages);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [health, setHealth] = useState<{ ok: boolean; provider: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Re-load models + health whenever the transport mode changes — switching
  // direct→backend (or vice-versa) hits a different endpoint, so the cached
  // list from the previous mode is stale.
  const transportMode = useClient((s) => s.mode);
  const directBaseUrl = useClient((s) => s.directBaseUrl);
  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ ok: false, provider: "?" }));
    listModels().then(setModels).catch(() => setModels([]));
  }, [transportMode, directBaseUrl]);

  // default the model if we have a chat with no model yet
  useEffect(() => {
    if (!active) return;
    if (active.model || models.length === 0) return;
    const first = models[0];
    if (first) setActiveModel(first.id, first.context_size);
  }, [active, models, setActiveModel]);

  // pull dropped files into the composer
  useEffect(() => {
    if (pendingFiles.length === 0) return;
    void attachFiles(pendingFiles);
    consumePendingFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFiles]);

  const tokensUsed = useMemo(
    () => (active ? countMessagesTokens(active.messages) : 0),
    [active],
  );

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

  async function send() {
    if (!active || !active.model) {
      onOpenSettings();
      return;
    }
    const parts = buildUserParts();
    if (parts.length === 0) return;

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

    // auto-title first turn
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

  async function compact() {
    if (!active || !active.model) return;
    setCompacting(true);
    setCompactError(null);
    try {
      const next = await compactConversation(active.messages, active.model);
      if (next === active.messages) {
        setCompactError("Not enough messages to compact yet.");
        return;
      }
      replaceMessages(next);
    } catch (err) {
      setCompactError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompacting(false);
    }
  }

  const modelInfo = models.find((m) => m.id === active?.model);

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
    <div className="flex-1 flex flex-col min-w-0">
      <header className="flex h-12 items-center gap-3 border-b px-4">
        <div className="text-sm font-medium truncate">{active.title}</div>
        <div className="flex items-center gap-1.5">
          <span
            className={
              "size-2 rounded-full " +
              (health?.ok ? "bg-emerald-500" : "bg-zinc-500")
            }
            title={health?.provider ?? "unknown"}
          />
          <span className="text-xs text-muted-foreground">
            {health?.provider ?? "—"}
          </span>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[18ch]">
          {active.model || "no model"}
        </span>
        <ContextMeter used={tokensUsed} total={active.contextSize} />
        <Separator orientation="vertical" className="h-5" />
        <Button
          size="sm"
          variant="ghost"
          onClick={compact}
          disabled={compacting || active.messages.length < COMPACT_MIN_MESSAGES}
          title="Summarise older messages to free context"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {compacting ? "compacting…" : "compact"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={clear}
          disabled={active.messages.length === 0}
        >
          clear
        </Button>
      </header>

      {compactError && (
        <div
          className="mx-auto mt-2 max-w-3xl w-full px-4"
          role="alert"
        >
          <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-xs">
            <span className="font-mono leading-relaxed">compact failed: {compactError}</span>
            <button
              onClick={() => setCompactError(null)}
              className="opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

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
            {active.messages.map((m) => (
              <Message
                key={m.id}
                role={m.role}
                streaming={m.streaming}
                onDelete={() => deleteMessage(m.id)}
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
          </ConversationContent>
        )}
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {attachments.length > 0 && modelInfo && modelInfo.vision === false && (
          <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 px-3 py-2 text-xs">
            <span className="font-medium">{modelInfo.id}</span> isn't tagged as a
            vision model — it will likely reject the image. Pick a vision model
            (e.g. one with <span className="font-mono">VL</span> /{" "}
            <span className="font-mono">llava</span> in the id) in settings.
          </div>
        )}
        <PromptInput
          value={draft}
          onChange={setDraft}
          onSubmit={send}
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
  );
}
