import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { filterImages } from "@/lib/files";

/**
 * App-level drop target. Catches a drag anywhere over the window and, on drop,
 * routes image files to the active prompt input via the supplied callback.
 */
export function DragDropOverlay({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) {
  const [active, setActive] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      counter.current += 1;
      setActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      counter.current -= 1;
      if (counter.current <= 0) {
        counter.current = 0;
        setActive(false);
      }
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter.current = 0;
      setActive(false);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      const images = filterImages(files);
      if (images.length) onFiles(images);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-foreground/30 px-10 py-8 text-center">
        <ImagePlus className="mx-auto h-8 w-8 text-foreground/70" />
        <div className="mt-2 text-sm font-medium">Drop images to attach</div>
        <div className="text-xs text-muted-foreground">
          They'll be added to the message you're composing.
        </div>
      </div>
    </div>
  );
}
