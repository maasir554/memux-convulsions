import {
  File,
  FileCode2,
  FileText,
  Folder,
  Image as ImageIcon,
  Table2,
} from "lucide-react";

import type { ItemType } from "@/lib/mock-notes";

export function ItemIcon({
  type,
  className,
}: {
  type: ItemType;
  className?: string;
}) {
  switch (type) {
    case "code":
      return <FileCode2 className={className} />;
    case "csv":
      return <Table2 className={className} />;
    case "pdf":
      return <File className={className} />;
    case "image":
      return <ImageIcon className={className} />;
    case "folder":
      return (
        <Folder
          className={className}
          style={{ color: "var(--graph-folder)" }}
        />
      );
    case "markdown":
    default:
      return <FileText className={className} />;
  }
}
