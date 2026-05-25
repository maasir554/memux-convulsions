"use client";

import {
  FileText,
  Search,
  Network,
  PanelLeft,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/galexy/theme-toggle";

export type LeftView = "files" | "search";

const VIEWS: { id: LeftView; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Files", icon: FileText },
  { id: "search", label: "Search", icon: Search },
];

type RibbonProps = {
  leftView: LeftView;
  onSelectLeftView: (view: LeftView) => void;
  onToggleLeft: () => void;
  leftCollapsed: boolean;
  onToggleGraph: () => void;
  graphActive: boolean;
};

function RibbonButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            active && "bg-sidebar-accent text-foreground",
          )}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Ribbon({
  leftView,
  onSelectLeftView,
  onToggleLeft,
  leftCollapsed,
  onToggleGraph,
  graphActive,
}: RibbonProps) {
  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2">
      {VIEWS.map((view) => (
        <RibbonButton
          key={view.id}
          label={view.label}
          icon={view.icon}
          active={!leftCollapsed && leftView === view.id}
          onClick={() => onSelectLeftView(view.id)}
        />
      ))}

      <RibbonButton
        label="Graph view"
        icon={Network}
        active={graphActive}
        onClick={onToggleGraph}
      />

      <Separator className="my-1 w-6" />

      <RibbonButton
        label={leftCollapsed ? "Show left sidebar" : "Hide left sidebar"}
        icon={PanelLeft}
        active={!leftCollapsed}
        onClick={onToggleLeft}
      />

      <div className="mt-auto flex flex-col items-center gap-1">
        <ThemeToggle />
        <RibbonButton label="Settings" icon={Settings} onClick={() => {}} />
      </div>
    </div>
  );
}
