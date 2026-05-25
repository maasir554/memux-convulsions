"use client";

import { useState } from "react";
import {
  ChevronRight,
  CornerUpRight,
  Hash,
  Info,
  Link2,
  ListTree,
  PanelRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { extractHeadings, type Note } from "@/lib/mock-notes";

type RightSidebarProps = {
  activeNote: Note | null;
  backlinks: Note[];
  outgoing: Note[];
  onOpen: (id: string) => void;
  onToggleRight: () => void;
};

export function RightSidebar({
  activeNote,
  backlinks,
  outgoing,
  onOpen,
  onToggleRight,
}: RightSidebarProps) {
  const headings =
    activeNote?.type === "markdown" ? extractHeadings(activeNote.content) : [];

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b pr-1 pl-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="truncate">{activeNote ? activeNote.title : "No note"}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleRight}
              aria-label="Hide right sidebar"
              aria-pressed
            >
              <PanelRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Hide right sidebar</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-3">
          <Section icon={<Link2 className="size-3.5" />} title="Backlinks" count={backlinks.length}>
            {backlinks.length === 0 ? (
              <Empty>No backlinks yet.</Empty>
            ) : (
              backlinks.map((note) => (
                <LinkRow key={note.id} note={note} onOpen={onOpen} />
              ))
            )}
          </Section>

          <Separator />

          <Section
            icon={<CornerUpRight className="size-3.5" />}
            title="Outgoing links"
            count={outgoing.length}
          >
            {outgoing.length === 0 ? (
              <Empty>No outgoing links.</Empty>
            ) : (
              outgoing.map((note) => (
                <LinkRow key={note.id} note={note} onOpen={onOpen} />
              ))
            )}
          </Section>

          {activeNote?.type === "markdown" && (
            <>
              <Separator />
              <Section
                icon={<ListTree className="size-3.5" />}
                title="Outline"
                count={headings.length}
              >
                {headings.length === 0 ? (
                  <Empty>No headings.</Empty>
                ) : (
                  headings.map((h, i) => (
                    <div
                      key={`${h.text}-${i}`}
                      className="truncate py-0.5 text-sm text-muted-foreground"
                      style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                    >
                      {h.text}
                    </div>
                  ))
                )}
              </Section>
            </>
          )}

          {activeNote && activeNote.tags.length > 0 && (
            <>
              <Separator />
              <Section icon={<Hash className="size-3.5" />} title="Tags" count={activeNote.tags.length}>
                <div className="flex flex-wrap gap-1.5">
                  {activeNote.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </Section>
            </>
          )}

          {activeNote && (
            <>
              <Separator />
              <MoreSection item={activeNote} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function MoreSection({ item }: { item: Note }) {
  const [open, setOpen] = useState(false);
  const rows: { label: string; value: string }[] = [
    { label: "Type", value: item.type },
    ...(item.summary ? [{ label: "Summary", value: item.summary }] : []),
    ...(item.folder ? [{ label: "Folder", value: item.folder }] : []),
    ...(item.language ? [{ label: "Language", value: item.language }] : []),
    ...(item.src ? [{ label: "Source", value: item.src }] : []),
    ...(item.updatedAt ? [{ label: "Updated", value: item.updatedAt }] : []),
  ];

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        <Info className="size-3.5" />
        <span>More</span>
      </button>
      {open && (
        <dl className="mt-1 flex flex-col gap-2 px-1">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col">
              <dt className="text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                {row.label}
              </dt>
              <dd className="text-sm break-words text-muted-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        <span>{title}</span>
        <span className="ml-auto rounded bg-muted px-1.5 text-[10px]">{count}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function LinkRow({ note, onOpen }: { note: Note; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(note.id)}
      className="rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      {note.title}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground/70">{children}</p>;
}
