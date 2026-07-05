"use client";

import { Trash2, AlertTriangle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * State for a single pending confirmation. Stored on the host (app-shell)
 * and rendered via <ConfirmDialog>. `onConfirm` is invoked iff the user
 * clicks the destructive action.
 */
export type ConfirmRequest = {
  title: string;
  description?: string;
  /** Bullet-style highlights shown above the description. */
  highlights?: string[];
  /** Label on the destructive action button. Defaults to "Delete". */
  confirmLabel?: string;
  /** What to do when the user confirms. */
  onConfirm: () => void;
};

type Props = {
  request: ConfirmRequest | null;
  onClose: () => void;
};

/**
 * Single shadcn AlertDialog driven by a `ConfirmRequest`. Replaces
 * window.confirm() so destructive prompts use the app's own theming +
 * focus model + scrim instead of the browser's default chrome.
 */
export function ConfirmDialog({ request, onClose }: Props) {
  const open = request !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-4" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <AlertDialogTitle>
                {request?.title ?? "Confirm"}
              </AlertDialogTitle>
              {request?.description && (
                <AlertDialogDescription>
                  {request.description}
                </AlertDialogDescription>
              )}
            </div>
          </div>
        </AlertDialogHeader>

        {request?.highlights && request.highlights.length > 0 && (
          <ul className="ml-12 flex flex-col gap-1 text-sm text-muted-foreground">
            {request.highlights.map((line, i) => (
              <li
                key={i}
                className="before:mr-2 before:text-muted-foreground/60 before:content-['·']"
              >
                {line}
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              buttonVariants({ variant: "destructive" }),
              "gap-1.5",
            )}
            onClick={() => {
              request?.onConfirm();
              onClose();
            }}
          >
            <Trash2 className="size-3.5" />
            {request?.confirmLabel ?? "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
