import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Camera, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemuxMark } from "@/lib/memux-mark";

type Status = "idle" | "snap" | "full" | "saved";

interface SpeechRecognitionResultLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

export function Popup() {
  const [context, setContext] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);

  // The detached popup window is itself focused, so we can't use
  // `lastFocusedWindow` to find the inspected tab. The background passes the
  // parent windowId via the URL hash when it opens us.
  const parentWindowId = useMemo<number | null>(() => {
    const match = window.location.hash.match(/parent=(\d+)/);
    return match ? Number(match[1]) : null;
  }, []);

  useEffect(() => {
    const query: chrome.tabs.QueryInfo =
      parentWindowId != null
        ? { active: true, windowId: parentWindowId }
        : { active: true, lastFocusedWindow: true };
    chrome.tabs
      .query(query)
      .then(([tab]) => setActiveTab(tab ?? null))
      .catch(() => undefined);
  }, [parentWindowId]);

  const inspectable = /^(https?|file):/.test(activeTab?.url || "");
  const busy = status === "snap" || status === "full";

  const triggerCapture = async (mode: "snap" | "full") => {
    if (busy) return;
    setError(null);
    setStatus(mode);
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "user-capture",
        mode,
        context: context.trim() || undefined,
        windowId: parentWindowId,
        tabId: activeTab?.id,
      });
      if (!resp?.ok) throw new Error(resp?.error || "Capture failed");
      setStatus("saved");
      setContext("");
      setTimeout(() => window.close(), 650);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
    }
  };

  const toggleMic = () => {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .webkitSpeechRecognition;
    if (!SR) {
      setError("Voice dictation isn't available in this browser");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setContext((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setError(e?.error || "Voice error");
      setListening(false);
    };
    recogRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openConsole = () => {
    void chrome.runtime.sendMessage({ type: "open-console" });
    window.close();
  };

  const statusText =
    status === "snap"
      ? "Capturing snap…"
      : status === "full"
        ? "Full capture in progress…"
        : status === "saved"
          ? "Saved."
          : inspectable
            ? "Ready"
            : "This tab isn't inspectable";

  return (
    <div
      className="flex w-[360px] flex-col overflow-hidden bg-background text-foreground"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      {/* header */}
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card/40 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <MemuxMark size={22} />
          <span className="text-[13px] font-semibold tracking-tight">
            MEMUX Capture
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Open console"
            aria-label="Open console"
            onClick={openConsole}
            className="grid size-7 place-items-center rounded-full bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3" />
          </button>
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={() => window.close()}
            className="grid size-7 place-items-center rounded-full bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-3.5">
        {/* context input — borderless, lighter elevated surface, mic anchored
            to the bottom-right inside the same surface */}
        <div className="relative rounded-xl bg-muted/75 transition-colors focus-within:bg-muted/90">
          <textarea
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Add context (optional)…"
            rows={3}
            className="w-full resize-none rounded-xl bg-transparent px-3.5 pb-12 pt-3 text-[12px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            title={listening ? "Stop dictation" : "Dictate context"}
            aria-label={listening ? "Stop dictation" : "Dictate context"}
            onClick={toggleMic}
            className={cn(
              "absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-white text-black shadow-sm transition hover:brightness-95 active:scale-[0.96]",
              listening && "ring-2 ring-primary/60 ring-offset-2 ring-offset-[oklch(0.205_0_0)] animate-pulse",
            )}
          >
            <AudioLines className="size-3.5" />
          </button>
        </div>

        {/* active tab indicator — same lighter elevation as the input above */}
        {activeTab && (
          <div className="flex items-center gap-2 rounded-md bg-muted/75 px-2.5 py-1.5 text-[11px]">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                inspectable
                  ? "bg-primary shadow-[0_0_6px] shadow-primary/60"
                  : "bg-muted-foreground/60",
              )}
              title={inspectable ? "Inspectable" : "Not inspectable"}
            />
            <span className="truncate font-medium">
              {activeTab.title || "Untitled"}
            </span>
          </div>
        )}

        {/* actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || !inspectable}
            onClick={() => triggerCapture("full")}
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f472b6] via-[#fb923c] to-[#fde047] px-5 text-[13px] font-semibold text-black shadow-[0_8px_20px_-10px_rgba(244,114,182,0.45)] transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            <Camera className="size-4" />
            Full capture
          </button>
          <button
            type="button"
            disabled={busy || !inspectable}
            onClick={() => triggerCapture("snap")}
            className="flex h-9 items-center justify-center gap-2 rounded-full bg-white px-5 text-[13px] font-medium text-black transition hover:brightness-95 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            Capture snap
          </button>
        </div>

        {/* status / error footer */}
        <div className="flex items-center justify-between text-[10.5px]">
          <span
            className={cn(
              "truncate",
              error
                ? "text-destructive"
                : status === "saved"
                  ? "text-primary"
                  : "text-muted-foreground",
            )}
          >
            {error ?? statusText}
          </span>
        </div>
      </div>
    </div>
  );
}
