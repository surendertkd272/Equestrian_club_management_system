import { useEffect } from "react";

// Warn before the browser unloads (tab close, reload, address-bar nav, back
// button to a different origin) while a form holds unsaved edits. Pass a
// `dirty` flag the form already tracks (e.g. JSON.stringify(form) !== initial).
//
// Note: Next.js client-side <Link> navigations do NOT fire `beforeunload`; for
// those, gate the risky nav behind openConfirm() where data-loss matters. This
// hook covers the common hard-navigation data-loss path.
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = ""; // Chrome requires returnValue to be set to prompt.
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
