"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, X } from "lucide-react";

// Captures the browser's `beforeinstallprompt` event (Chrome/Edge) and shows
// a polite, dismissable banner so coaches can save the app to their home
// screen with one tap. iOS Safari doesn't fire the event — for that we
// detect the platform and show a tap-Share-then-Add-to-Home-Screen hint
// instead. Both variants honour the same localStorage dismissal so users
// only see the banner once.

type BIP = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "ew_pwa_install_dismissed";

function isIosSafariStandaloneCapable(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  // Already installed if running in standalone display mode.
  const standalone =
    (navigator as any).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  return isIos && !standalone;
}

export function PwaInstallPrompt() {
  const [event, setEvent] = useState<BIP | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    function onBip(e: Event) {
      e.preventDefault();
      setEvent(e as BIP);
      setHidden(false);
    }
    window.addEventListener("beforeinstallprompt", onBip);

    if (isIosSafariStandaloneCapable()) {
      // iOS doesn't fire beforeinstallprompt — show the manual hint after a
      // short delay so it doesn't fight with first-paint.
      const t = setTimeout(() => {
        setShowIosHint(true);
        setHidden(false);
      }, 1500);
      return () => {
        window.removeEventListener("beforeinstallprompt", onBip);
        clearTimeout(t);
      };
    }
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (hidden || (!event && !showIosHint)) return null;

  async function install() {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    setHidden(true);
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setHidden(true);
  }

  return (
    <div className="fixed bottom-20 right-4 z-30 flex max-w-xs items-start gap-2 rounded-lg border bg-card p-3 shadow-lg md:bottom-4">
      <div className="flex-1 text-sm">
        <div className="font-semibold">Install Equiwings</div>
        {showIosHint ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tap <Share className="inline h-3 w-3" /> Share, then choose <strong>Add to Home Screen</strong> for
            a full-screen, app-like experience.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add to home screen for a faster, full-screen, offline-tolerant experience during outdoor lessons.
          </p>
        )}
        <div className="mt-2 flex gap-2">
          {!showIosHint && (
            <Button size="sm" onClick={install}>
              <Download className="h-3.5 w-3.5" /> Install
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={dismiss}>
            {showIosHint ? "Got it" : "Not now"}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
