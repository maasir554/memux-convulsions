"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ChevronRight,
  CornerUpRight,
  Hash,
  Info,
  Link2,
  ListTree,
  PanelRight,
  Plus,
  X,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ItemIcon } from "@/components/galexy/item-icon";
import { extractHeadings, type Note } from "@/lib/mock-notes";

type RightSidebarProps = {
  activeNote: Note | null;
  /** Resolved outgoing-link items (wikilink-derived + manual, deduped). */
  outgoing: Note[];
  backlinks: Note[];
  /** Full vault — needed by the link picker to list every link target. */
  allNotes: Note[];
  onOpen: (id: string) => void;
  onToggleRight: () => void;
  /** Replace the manually-added outgoing-links array on the active note. */
  onUpdateLinks: (id: string, links: string[]) => void;
};

export function RightSidebar({
  activeNote,
  backlinks,
  outgoing,
  allNotes,
  onOpen,
  onToggleRight,
  onUpdateLinks,
}: RightSidebarProps) {
  const headings =
    activeNote?.type === "markdown" ? extractHeadings(activeNote.content) : [];

  // Which of the outgoing links were added manually via the picker?
  // Anything in note.links is manual; wikilink-derived links are NOT in
  // note.links. The set lets LinkRow decide whether to show the × button.
  const manualLinkIds = useMemo(
    () => new Set(activeNote?.links ?? []),
    [activeNote?.links],
  );

  function addLink(targetId: string) {
    if (!activeNote) return;
    const existing = activeNote.links ?? [];
    if (existing.includes(targetId)) return;
    onUpdateLinks(activeNote.id, [...existing, targetId]);
  }

  function removeLink(targetId: string) {
    if (!activeNote) return;
    const existing = activeNote.links ?? [];
    if (!existing.includes(targetId)) return;
    onUpdateLinks(
      activeNote.id,
      existing.filter((id) => id !== targetId),
    );
  }

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

          <OutgoingSection
            activeNote={activeNote}
            outgoing={outgoing}
            allNotes={allNotes}
            manualLinkIds={manualLinkIds}
            onOpen={onOpen}
            onAddLink={addLink}
            onRemoveLink={removeLink}
          />

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

function OutgoingSection({
  activeNote,
  outgoing,
  allNotes,
  manualLinkIds,
  onOpen,
  onAddLink,
  onRemoveLink,
}: {
  activeNote: Note | null;
  outgoing: Note[];
  allNotes: Note[];
  manualLinkIds: Set<string>;
  onOpen: (id: string) => void;
  onAddLink: (targetId: string) => void;
  onRemoveLink: (targetId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Candidates: every note in the vault EXCEPT the active one and folders
  // (you can't link "to" a synthetic folder node), and except ones already
  // in note.links. Wikilink-derived targets stay pickable because they're
  // an independent axis from manual links.
  const candidates = useMemo(() => {
    if (!activeNote) return [];
    return allNotes.filter(
      (n) =>
        n.id !== activeNote.id &&
        n.type !== "folder" &&
        !manualLinkIds.has(n.id),
    );
  }, [activeNote, allNotes, manualLinkIds]);

  return (
    <Section
      icon={<CornerUpRight className="size-3.5" />}
      title="Outgoing links"
      count={outgoing.length}
      action={
        activeNote ? (
          <AddLinkPopover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            candidates={candidates}
            onPick={onAddLink}
          />
        ) : null
      }
    >
      {outgoing.length === 0 ? (
        <Empty>No outgoing links.</Empty>
      ) : (
        outgoing.map((note) => (
          <LinkRow
            key={note.id}
            note={note}
            onOpen={onOpen}
            removable={manualLinkIds.has(note.id)}
            onRemove={() => onRemoveLink(note.id)}
          />
        ))
      )}
    </Section>
  );
}

function Section({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        <span>{title}</span>
        <span className="ml-auto rounded bg-muted px-1.5 text-[10px]">{count}</span>
        {action}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function LinkRow({
  note,
  onOpen,
  removable,
  onRemove,
}: {
  note: Note;
  onOpen: (id: string) => void;
  removable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="group/linkrow flex items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm"
      >
        <span className="min-w-0 flex-1 truncate">{note.title}</span>
      </button>
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove link to ${note.title}`}
          className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover/linkrow:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Popover with a filter input + scrollable list of notes to link to. */
function AddLinkPopover({
  open,
  onOpenChange,
  candidates,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: Note[];
  onPick: (id: string) => void;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 size-5 text-muted-foreground hover:text-foreground"
          aria-label="Add link"
        >
          <Plus className="size-3.5" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        {open && (
          // Re-key the content on every open so the search input and query
          // state start fresh — equivalent to a useEffect reset, but
          // satisfies react-hooks/set-state-in-effect.
          <AddLinkPopoverContent
            key="open"
            candidates={candidates}
            onPick={(id) => {
              onPick(id);
              onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
          />
        )}
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function AddLinkPopoverContent({
  candidates,
  onPick,
  onClose,
}: {
  candidates: Note[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates.slice(0, 50);
    return candidates
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 50);
  }, [candidates, query]);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[0]) onPick(filtered[0].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <PopoverPrimitive.Content
      side="left"
      align="start"
      sideOffset={6}
      className="z-50 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <div className="px-1.5 pt-1 pb-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        Link to a note
      </div>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Search notes…"
        className="mx-1 my-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
      <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto pb-1">
        {filtered.length === 0 ? (
          <p className="px-2 py-2 text-center text-xs text-muted-foreground">
            No matches.
          </p>
        ) : (
          filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onPick(n.id)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent"
            >
              <ItemIcon
                type={n.type}
                language={n.language}
                className="size-4 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              {n.folder && (
                <span className="text-[10px] text-muted-foreground/70">
                  {n.folder}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
    </PopoverPrimitive.Content>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground/70">{children}</p>;
}
