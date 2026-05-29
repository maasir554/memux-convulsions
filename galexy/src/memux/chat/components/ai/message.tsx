"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/memux/chat/components/ui/dropdown-menu";
import { cn } from "@/memux/chat/lib/utils";
import { Response } from "./response";
import { Reasoning, splitThinking } from "./reasoning";
import type { ChatRole } from "@/memux/chat/lib/store";

export type DisplayPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string };

export function Message({
  role,
  parts,
  streaming,
  isLatestUser,
  hasAgentHistory,
  onDelete,
  onRegenerate,
  onCopy,
  onEdit,
  onViewAgent,
}: {
  role: ChatRole;
  parts: DisplayPart[];
  streaming?: boolean;
  /** Only the most recent user bubble gets the edit-3-dot UI. */
  isLatestUser?: boolean;
  /** True if this assistant message has a captured agent snapshot. */
  hasAgentHistory?: boolean;
  onDelete?: () => void;
  onRegenerate?: () => void;
  onCopy?: () => void;
  onEdit?: () => void;
  /** Open this message's agent history in the right panel. */
  onViewAgent?: () => void;
}) {
  const isUser = role === "user";

  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");

  const images = parts.filter(
    (p): p is { type: "image"; url: string } => p.type === "image",
  );

  const { reasoning, body, thinking } = isUser
    ? { reasoning: "", body: text, thinking: false }
    : splitThinking(text);

  return (
    <div
      className={cn(
        "group flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn("flex w-full gap-2", isUser ? "justify-end" : "justify-start")}
      >
        {/* Left-side 3-dot for the latest user bubble. */}
        {isUser && isLatestUser && (onEdit || onDelete) && !streaming && (
          <UserActionMenu onEdit={onEdit} onDelete={onDelete} />
        )}

        <div
          className={cn(
            "min-w-0",
            isUser
              ? "max-w-[85%] rounded-2xl rounded-br-md bg-secondary text-secondary-foreground px-4 py-2"
              : "flex-1",
          )}
        >
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={img.url}
                  alt=""
                  className="max-h-48 rounded-md border"
                />
              ))}
            </div>
          )}

          {reasoning || (thinking && streaming) ? (
            <Reasoning
              content={reasoning}
              streaming={thinking && streaming}
              className="mb-2"
            />
          ) : null}

          {body || streaming ? (
            isUser ? (
              <div className="whitespace-pre-wrap leading-[1.5] font-[300]">
                {body}
              </div>
            ) : (
              <div className="relative">
                <Response content={body} />
                {streaming && !thinking && (
                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/60 align-text-bottom" />
                )}
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Assistant: inline icon row below the message. */}
      {!isUser && !streaming && (onRegenerate || onCopy || onDelete || (hasAgentHistory && onViewAgent)) && (
        <AssistantActionRow
          onRegenerate={onRegenerate}
          onCopy={onCopy}
          onDelete={onDelete}
          onViewAgent={hasAgentHistory ? onViewAgent : undefined}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------- assistant row */

function AssistantActionRow({
  onRegenerate,
  onCopy,
  onDelete,
  onViewAgent,
}: {
  onRegenerate?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  onViewAgent?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1300);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 text-muted-foreground/70",
        "opacity-0 transition-opacity duration-150 group-hover:opacity-100",
      )}
    >
      {onRegenerate && (
        <ActionIconButton
          label="Regenerate"
          onClick={onRegenerate}
          icon={<RefreshCw className="size-3.5" />}
        />
      )}
      {onCopy && (
        <ActionIconButton
          label={copied ? "Copied" : "Copy"}
          onClick={copy}
          icon={
            copied ? (
              <Check className="size-3.5 text-emerald-400" />
            ) : (
              <Copy className="size-3.5" />
            )
          }
        />
      )}
      {onViewAgent && (
        <ActionIconButton
          label="View agent history"
          onClick={onViewAgent}
          icon={<Eye className="size-3.5" />}
        />
      )}
      {onDelete && (
        <ActionIconButton
          label="Delete"
          onClick={onDelete}
          icon={<Trash2 className="size-3.5" />}
          destructive
        />
      )}
    </div>
  );
}

function ActionIconButton({
  label,
  onClick,
  icon,
  destructive,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 transition-colors",
        destructive
          ? "hover:bg-destructive/15 hover:text-destructive"
          : "hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------ user 3-dot */

function UserActionMenu({
  onEdit,
  onDelete,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Message options"
          className={cn(
            "mt-1 self-start rounded-md p-1 text-muted-foreground/70 transition-opacity hover:bg-muted/40 hover:text-foreground",
            open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-32">
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-3.5" />
            Edit
          </DropdownMenuItem>
        )}
        {onDelete && (
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
