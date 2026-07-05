import { FileQuestion } from "lucide-react";

export function ViewerFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
      <FileQuestion className="size-8" />
      <p className="max-w-xs text-sm">{label}</p>
    </div>
  );
}
