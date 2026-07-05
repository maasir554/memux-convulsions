"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Minimal dark/light toggle that flips the `dark` class on <html>. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return true; // matches <html class="dark">
    return (localStorage.getItem("galexy-theme") ?? "dark") === "dark";
  });

  // Sync the external systems (DOM class + storage) when the choice changes.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("galexy-theme", dark ? "dark" : "light");
  }, [dark]);

  function toggle() {
    setDark((value) => !value);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label="Toggle theme"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Toggle theme</TooltipContent>
    </Tooltip>
  );
}
