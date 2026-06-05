"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Owner-portal light/dark toggle. The owner shell is scoped with its own
// `dark`/`light` class (independent of the tenant's <html> theme) so it can
// default to dark while the tenant defaults to light. Persisted under a
// separate key.
function apply(theme: "dark" | "light") {
  const el = document.getElementById("owner-shell");
  if (!el) return;
  el.classList.toggle("dark", theme === "dark");
  el.classList.toggle("light", theme === "light");
}

export function OwnerThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    let t: "dark" | "light" = "dark";
    try {
      const s = localStorage.getItem("owner-theme");
      if (s === "light" || s === "dark") t = s;
    } catch {
      /* storage unavailable */
    }
    setTheme(t);
    apply(t);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
    try {
      localStorage.setItem("owner-theme", next);
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
