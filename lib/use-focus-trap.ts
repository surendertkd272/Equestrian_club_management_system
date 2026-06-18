import { useEffect, type RefObject } from "react";

// Accessibility for modal dialogs (openConfirm / openPrompt and friends).
// When `active` flips true it: (1) remembers the element that had focus, (2)
// moves focus into the dialog (unless a field inside already grabbed it, e.g.
// autoFocus), (3) traps Tab / Shift+Tab inside the container so keyboard users
// can't tab onto the page behind the overlay, and (4) restores focus to the
// original element when the dialog closes. Without this, a keyboard user opens
// a modal and Tab silently walks into the obscured page underneath.

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus inside unless something within already owns it (autoFocus).
    if (!container.contains(document.activeElement)) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? container).focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const nodes = Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || activeEl === container) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || activeEl === container) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger so the user lands back where they were.
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
