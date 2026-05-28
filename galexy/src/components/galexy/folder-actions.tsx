"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ContextMenu as ContextMenuPrimitive, Popover as PopoverPrimitive } from "radix-ui";
import {
  ChevronRight,
  FilePlus,
  FileUp,
  ImageUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Sheet,
  SquareCode,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { CreateKind } from "@/components/galexy/file-explorer";
import type { UploadCategory } from "@/components/galexy/use-vault";

// ---------- Action catalogue (single source of truth) -----------------------

type CreateAction = {
  id: string;
  label: string;
  Icon: typeof FilePlus;
  kind: "create";
  createKind: Exclude<CreateKind, "folder">;
};
type UploadAction = {
  id: string;
  label: string;
  Icon: typeof FileUp;
  kind: "upload";
  category: UploadCategory;
  accept: string;
};
type FolderAction = CreateAction | UploadAction;

const CREATE_ACTIONS: CreateAction[] = [
  {
    id: "create-md",
    label: "New markdown note",
    Icon: FilePlus,
    kind: "create",
    createKind: "markdown",
  },
  {
    id: "create-code",
    label: "New code file",
    Icon: SquareCode,
    kind: "create",
    createKind: "code",
  },
  {
    id: "create-csv",
    label: "New sheet",
    Icon: Sheet,
    kind: "create",
    createKind: "csv",
  },
];

const UPLOAD_ACTIONS: UploadAction[] = [
  {
    id: "upload-md",
    label: "Upload markdown",
    Icon: FileUp,
    kind: "upload",
    category: "markdown",
    accept: ".md,text/markdown,text/plain",
  },
  {
    id: "upload-csv",
    label: "Upload sheet",
    Icon: FileUp,
    kind: "upload",
    category: "csv",
    accept: ".csv,text/csv",
  },
  {
    id: "upload-pdf",
    label: "Upload PDF",
    Icon: FileUp,
    kind: "upload",
    category: "pdf",
    accept: ".pdf,application/pdf",
  },
  {
    id: "upload-image",
    label: "Upload image",
    Icon: ImageUp,
    kind: "upload",
    category: "image",
    accept: "image/*",
  },
];

const ALL_ACTIONS: FolderAction[] = [...CREATE_ACTIONS, ...UPLOAD_ACTIONS];

// ---------- File picker -----------------------------------------------------

function triggerFilePicker(accept: string, onPick: (files: File[]) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = true;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (files.length > 0) onPick(files);
  };
  document.body.appendChild(input);
  input.click();
}

// ---------- Shared dispatch -------------------------------------------------

type Handlers = {
  folder: string;
  onStartCreate: (kind: CreateKind, folder: string) => void;
  onUpload: (category: UploadCategory, folder: string, files: File[]) => void;
  /** Optional — when present, a Delete entry is appended to the folder menus. */
  onDeleteFolder?: (folder: string) => void;
  /** Optional — when present, a Rename entry is shown. */
  onRenameFolder?: (folder: string) => void;
};

function runAction(action: FolderAction, h: Handlers) {
  if (action.kind === "create") {
    h.onStartCreate(action.createKind, h.folder);
  } else {
    triggerFilePicker(action.accept, (files) =>
      h.onUpload(action.category, h.folder, files),
    );
  }
}

// ---------- Hover plus button + searchable popover --------------------------

type PopoverProps = Handlers;

export function FolderActionsPopover({
  folder,
  onStartCreate,
  onUpload,
  onDeleteFolder,
  onRenameFolder,
}: PopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          // Stop the parent (the folder row) from toggling collapsed state when
          // the plus is clicked.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            // Hidden until the row is hovered, sticky once the menu is open.
            "opacity-0 group-hover/folder:opacity-100",
            open && "opacity-100",
          )}
          aria-label={`Create or upload in ${folder}`}
        >
          <Plus className="size-3.5" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={6}
          className="z-50 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <SearchableActions
            handlers={{ folder, onStartCreate, onUpload, onDeleteFolder, onRenameFolder }}
            onClose={() => setOpen(false)}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function SearchableActions({
  handlers,
  onClose,
}: {
  handlers: Handlers;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Defer so Radix's own focus management finishes first.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_ACTIONS;
    return ALL_ACTIONS.filter((a) => a.label.toLowerCase().includes(q));
  }, [query]);

  // Rename + Delete sit in a separate trailing group, never on the Enter
  // path (which would risk accidental destructive or surprising actions).
  const renameVisible =
    !!handlers.onRenameFolder &&
    (!query.trim() || "rename folder".includes(query.trim().toLowerCase()));
  const deleteVisible =
    !!handlers.onDeleteFolder &&
    (!query.trim() || "delete folder".includes(query.trim().toLowerCase()));

  function activate(action: FolderAction) {
    runAction(action, handlers);
    onClose();
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[0]) activate(filtered[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const folderLabel = handlers.folder || "vault root";

  return (
    <div className="flex flex-col gap-1">
      <div className="px-1.5 pt-1 pb-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
        in {folderLabel}
      </div>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Search actions…"
        className="mx-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
      <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto pt-1">
        {filtered.length === 0 && !renameVisible && !deleteVisible ? (
          <p className="px-2 py-2 text-center text-xs text-muted-foreground">
            No matching actions.
          </p>
        ) : (
          filtered.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => activate(action)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent"
            >
              <action.Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{action.label}</span>
            </button>
          ))
        )}
        {(renameVisible || deleteVisible) && (
          <div className="my-1 border-t" />
        )}
        {renameVisible && (
          <button
            type="button"
            onClick={() => {
              handlers.onRenameFolder?.(handlers.folder);
              onClose();
            }}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent"
          >
            <Pencil className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Rename folder</span>
          </button>
        )}
        {deleteVisible && (
          <button
            type="button"
            onClick={() => {
              handlers.onDeleteFolder?.(handlers.folder);
              onClose();
            }}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4 shrink-0" />
            <span className="truncate">Delete folder</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Right-click context menu (no search) ----------------------------

const subContentClass =
  "z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none";
const itemClass =
  "flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-sidebar-accent";

export function FolderContextMenu({
  folder,
  onStartCreate,
  onUpload,
  onDeleteFolder,
  onRenameFolder,
  children,
}: Handlers & { children: ReactNode }) {
  const handlers: Handlers = {
    folder,
    onStartCreate,
    onUpload,
    onDeleteFolder,
    onRenameFolder,
  };

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className={subContentClass}>
          <ContextMenuPrimitive.Sub>
            <ContextMenuPrimitive.SubTrigger
              className={cn(
                itemClass,
                "data-[state=open]:bg-sidebar-accent justify-between",
              )}
            >
              <span className="flex items-center gap-2">
                <FilePlus className="size-4 text-muted-foreground" />
                New
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </ContextMenuPrimitive.SubTrigger>
            <ContextMenuPrimitive.Portal>
              <ContextMenuPrimitive.SubContent
                className={subContentClass}
                sideOffset={4}
              >
                {CREATE_ACTIONS.map((action) => (
                  <ContextMenuPrimitive.Item
                    key={action.id}
                    className={itemClass}
                    onSelect={() => runAction(action, handlers)}
                  >
                    <action.Icon className="size-4 text-muted-foreground" />
                    {action.label}
                  </ContextMenuPrimitive.Item>
                ))}
              </ContextMenuPrimitive.SubContent>
            </ContextMenuPrimitive.Portal>
          </ContextMenuPrimitive.Sub>

          <ContextMenuPrimitive.Sub>
            <ContextMenuPrimitive.SubTrigger
              className={cn(
                itemClass,
                "data-[state=open]:bg-sidebar-accent justify-between",
              )}
            >
              <span className="flex items-center gap-2">
                <FileUp className="size-4 text-muted-foreground" />
                Upload
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </ContextMenuPrimitive.SubTrigger>
            <ContextMenuPrimitive.Portal>
              <ContextMenuPrimitive.SubContent
                className={subContentClass}
                sideOffset={4}
              >
                {UPLOAD_ACTIONS.map((action) => (
                  <ContextMenuPrimitive.Item
                    key={action.id}
                    className={itemClass}
                    onSelect={() => runAction(action, handlers)}
                  >
                    <action.Icon className="size-4 text-muted-foreground" />
                    {action.label}
                  </ContextMenuPrimitive.Item>
                ))}
              </ContextMenuPrimitive.SubContent>
            </ContextMenuPrimitive.Portal>
          </ContextMenuPrimitive.Sub>

          {(onRenameFolder || onDeleteFolder) && (
            <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />
          )}
          {onRenameFolder && (
            <ContextMenuPrimitive.Item
              className={itemClass}
              onSelect={() => onRenameFolder(folder)}
            >
              <Pencil className="size-4 text-muted-foreground" />
              Rename folder
            </ContextMenuPrimitive.Item>
          )}
          {onDeleteFolder && (
            <ContextMenuPrimitive.Item
              className={cn(itemClass, "text-destructive")}
              onSelect={() => onDeleteFolder(folder)}
            >
              <Trash2 className="size-4" />
              Delete folder
            </ContextMenuPrimitive.Item>
          )}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

// ---------- Per-item three-dots popover + right-click ----------------------

type ItemHandlers = {
  itemId: string;
  itemTitle: string;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
};

/** Three-dots button revealed on row hover; opens a small action popover. */
export function ItemActionsPopover({
  itemId,
  itemTitle,
  onRename,
  onDelete,
}: ItemHandlers) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            "opacity-0 group-hover/item:opacity-100",
            open && "opacity-100",
          )}
          aria-label={`Actions for ${itemTitle}`}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={6}
          className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              onRename(itemId);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent"
          >
            <Pencil className="size-4 text-muted-foreground" />
            Rename
          </button>
          <div className="my-1 border-t" />
          <button
            type="button"
            onClick={() => {
              onDelete(itemId);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" />
            Delete
          </button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Right-click context menu for non-folder items (mirrors the popover). */
export function ItemContextMenu({
  itemId,
  onRename,
  onDelete,
  children,
}: Omit<ItemHandlers, "itemTitle"> & { children: ReactNode }) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className={subContentClass}>
          <ContextMenuPrimitive.Item
            className={itemClass}
            onSelect={() => onRename(itemId)}
          >
            <Pencil className="size-4 text-muted-foreground" />
            Rename
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Separator className="my-1 h-px bg-border" />
          <ContextMenuPrimitive.Item
            className={cn(itemClass, "text-destructive")}
            onSelect={() => onDelete(itemId)}
          >
            <Trash2 className="size-4" />
            Delete
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
