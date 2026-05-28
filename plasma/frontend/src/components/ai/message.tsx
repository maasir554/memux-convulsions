import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Response } from "./response";
import { Reasoning, splitThinking } from "./reasoning";
import type { ChatRole } from "@/lib/store";

export type DisplayPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string };

export function Message({
  role,
  parts,
  streaming,
  onDelete,
}: {
  role: ChatRole;
  parts: DisplayPart[];
  streaming?: boolean;
  onDelete?: () => void;
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
        "flex gap-2 group",
        isUser ? "justify-end" : "justify-start",
      )}
    >
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
                <span className="inline-block w-2 h-4 bg-foreground/60 align-text-bottom ml-0.5 animate-pulse" />
              )}
            </div>
          )
        ) : null}
      </div>

      {onDelete && !streaming && (
        <button
          onClick={onDelete}
          className={cn(
            "self-start mt-1 p-1 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity",
            isUser ? "order-first" : "",
          )}
          aria-label="Delete message"
          title="Delete this message"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
