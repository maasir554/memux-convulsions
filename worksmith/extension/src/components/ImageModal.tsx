import type { SavedCapture } from "../lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ImageModalProps {
  capture: SavedCapture | null;
  onClose: () => void;
}

export function ImageModal({ capture, onClose }: ImageModalProps) {
  const shots = capture
    ? capture.screenshots && capture.screenshots.length > 0
      ? capture.screenshots
      : capture.screenshotDataUrl
        ? [capture.screenshotDataUrl]
        : []
    : [];
  const multi = shots.length > 1;

  return (
    <Dialog open={Boolean(capture)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid h-[92vh] w-[94vw] max-w-[94vw] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-border bg-card p-0 sm:max-w-[94vw]"
      >
        <DialogHeader className="space-y-0 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="truncate pr-8 text-sm font-medium">
            {capture?.title || capture?.url || "Capture preview"}
            {multi && (
              <span className="ml-2 rounded bg-primary/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-primary">
                {shots.length} shots
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {multi ? (
          <div className="flex min-h-0 min-w-0 flex-col items-center gap-3 overflow-auto bg-black/60 p-4">
            {shots.map((src, index) => (
              <figure key={index} className="flex w-full flex-col items-center gap-1.5">
                <figcaption className="text-[10px] uppercase tracking-wider text-zinc-400">
                  Shot {index + 1} of {shots.length}
                </figcaption>
                <img
                  src={src}
                  alt={`Capture shot ${index + 1}`}
                  className="max-w-full rounded-sm shadow-lg ring-1 ring-white/5"
                />
              </figure>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 items-center justify-center overflow-auto bg-black/60 p-3">
            {shots[0] && (
              <img
                src={shots[0]}
                alt="Saved page screenshot"
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
