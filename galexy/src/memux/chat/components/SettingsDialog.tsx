"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/memux/chat/components/ui/dialog";
import { Input } from "@/memux/chat/components/ui/input";
import { Button } from "@/memux/chat/components/ui/button";
import { Separator } from "@/memux/chat/components/ui/separator";
import {
  getBackendInfo,
  listModels,
  type BackendInfo,
  type ModelInfo,
} from "@/memux/chat/lib/api";
import { useClient } from "@/memux/chat/lib/clientSettings";
import { useStore } from "@/memux/chat/lib/store";
import { cn } from "@/memux/chat/lib/utils";
import { LemonadeLogo } from "@/memux/chat/components/LemonadeLogo";
import { Cloud, CheckCircle2, AlertCircle } from "lucide-react";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const mode = useClient((s) => s.mode);
  const setMode = useClient((s) => s.setMode);
  const directBaseUrl = useClient((s) => s.directBaseUrl);
  const directApiKey = useClient((s) => s.directApiKey);
  const setDirectBaseUrl = useClient((s) => s.setDirectBaseUrl);
  const setDirectApiKey = useClient((s) => s.setDirectApiKey);

  const [draftDirectBaseUrl, setDraftDirectBaseUrl] = useState(directBaseUrl);
  const [draftDirectApiKey, setDraftDirectApiKey] = useState(
    directApiKey ?? "",
  );
  useEffect(() => setDraftDirectBaseUrl(directBaseUrl), [directBaseUrl]);
  useEffect(() => setDraftDirectApiKey(directApiKey ?? ""), [directApiKey]);

  const [backend, setBackend] = useState<BackendInfo | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const active = useStore((s) => s.chats.find((c) => c.id === s.activeId));
  const setActiveModel = useStore((s) => s.setActiveModel);
  const setActiveContextSize = useStore((s) => s.setActiveContextSize);
  const setActiveTemperature = useStore((s) => s.setActiveTemperature);

  useEffect(() => {
    if (!open) return;
    setBackendError(null);
    if (mode === "backend") {
      getBackendInfo()
        .then((b) => {
          setBackend(b);
          setBackendError(null);
        })
        .catch((e) => {
          setBackend(null);
          setBackendError(String(e?.message ?? e));
        });
    } else {
      setBackend(null);
    }
    void refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  async function refreshModels() {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const m = await listModels();
      setModels(m);
    } catch (e) {
      setModelsError(String(e));
    } finally {
      setLoadingModels(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <section className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Connection
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ModeOption
              active={mode === "direct"}
              onClick={() => setMode("direct")}
              icon={<LemonadeLogo className="h-6 w-6" />}
              title="Lemonade (Local)"
              hint="Frontend talks to your local Lemonade server directly. No backend needed."
            />
            <ModeOption
              active={mode === "backend"}
              onClick={() => setMode("backend")}
              icon={
                <Cloud
                  className="h-5 w-5 text-muted-foreground"
                  strokeWidth={1.5}
                />
              }
              title="Cloud"
              hint="Routes through the memux chat backend (Google AI Studio)."
            />
          </div>

          {mode === "direct" ? (
            <div className="space-y-3 pt-1">
              <Field label="Base URL">
                <Input
                  value={draftDirectBaseUrl}
                  onChange={(e) => setDraftDirectBaseUrl(e.target.value)}
                  onBlur={() => setDirectBaseUrl(draftDirectBaseUrl)}
                  className="font-mono text-xs"
                  placeholder="http://localhost:13305/v1"
                />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Default: Lemonade at{" "}
                  <span className="font-mono">localhost:13305/v1</span>.
                </div>
              </Field>
              <Field label="API key (optional)">
                <Input
                  type="password"
                  value={draftDirectApiKey}
                  onChange={(e) => setDraftDirectApiKey(e.target.value)}
                  onBlur={() =>
                    setDirectApiKey(draftDirectApiKey || undefined)
                  }
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          ) : (
            <CloudStatus backend={backend} error={backendError} />
          )}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Active chat
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={refreshModels}
              disabled={loadingModels}
            >
              {loadingModels ? "Loading…" : "Refresh models"}
            </Button>
          </div>

          {!active ? (
            <div className="text-sm text-muted-foreground">
              Start or select a chat to configure its model.
            </div>
          ) : (
            <>
              <Field label="Model">
                <select
                  className="bg-background border rounded-md h-9 px-2 w-full text-sm"
                  value={active.model}
                  onChange={(e) => {
                    const id = e.target.value;
                    const m = models.find((x) => x.id === id);
                    setActiveModel(id, m?.context_size);
                  }}
                >
                  <option value="">— select —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                      {m.vision ? " · vision" : ""}
                      {m.reasoning ? " · reasoning" : ""}
                      {m.context_size ? ` · ${m.context_size}` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              {mode === "direct" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Context size (tokens)">
                    <Input
                      type="number"
                      value={active.contextSize}
                      onChange={(e) =>
                        setActiveContextSize(Number(e.target.value) || 0)
                      }
                    />
                  </Field>
                  <Field label="Temperature">
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={active.temperature}
                      onChange={(e) =>
                        setActiveTemperature(Number(e.target.value))
                      }
                    />
                  </Field>
                </div>
              )}
            </>
          )}

          {modelsError && (
            <div className="text-destructive text-xs font-mono">
              {modelsError}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function CloudStatus({
  backend,
  error,
}: {
  backend: BackendInfo | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-xs flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Backend unreachable</div>
          <div className="font-mono mt-1 opacity-90">{error}</div>
        </div>
      </div>
    );
  }
  if (!backend) {
    return (
      <div className="text-sm text-muted-foreground pt-1">
        Connecting to backend…
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5 flex items-center gap-3",
        backend.ready
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      {backend.ready ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
      ) : (
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {prettyProvider(backend.provider)}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {backend.ready
            ? "Ready"
            : "Backend not configured — contact the administrator."}
        </div>
      </div>
    </div>
  );
}

function prettyProvider(id: string): string {
  if (id === "google-ai-studio") return "Google AI Studio";
  return id;
}

function ModeOption({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-md border px-3 py-2.5 transition-colors flex gap-2.5 items-start",
        active
          ? "border-foreground/50 bg-accent"
          : "border-border hover:border-foreground/30",
      )}
    >
      {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
      <div className="min-w-0">
        <div className="text-sm font-medium leading-tight">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
          {hint}
        </div>
      </div>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
