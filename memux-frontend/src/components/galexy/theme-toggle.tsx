"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Minimal dark/light toggle that flips the `dark` class on <html>. */
export function ThemeToggle() {
  // Start from the root layout's server-rendered dark theme so the icon and
  // DOM hydrate identically, then restore the user's preference after mount.
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const restored = (localStorage.getItem("galexy-theme") ?? "dark") === "dark";
    document.documentElement.classList.toggle("dark", restored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(restored);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("galexy-theme", next ? "dark" : "light");
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
