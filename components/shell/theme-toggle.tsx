"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Light/Dark toggle for the tenant app. Flips the `dark` class on <html>
// (Tailwind darkMode: "class") and persists the choice. The pre-paint script
// in the root layout applies the saved choice before React hydrates, so there's
// no flash; we sync this button's icon from the DOM on mount.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* private mode / disabled storage — toggle still applies for the session */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="grid h-9 w-9 place-items-center rounded-full border text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
