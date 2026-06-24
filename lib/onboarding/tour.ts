// Pure builder for the guided-tour steps. Kept free of driver.js / DOM so it's
// unit-testable; TourHost maps these descriptors onto driver.js at runtime.
//
// The tour is deliberately short and orientation-focused (4 steps) rather than
// an exhaustive per-screen walk — detailed how-tos live in the Help Center.
// It IS role-aware: the menu step names the role's most-used screens, and on
// mobile it points at the hamburger button instead of the (hidden) sidebar.

export type TourStep = {
  key: string;
  /** CSS selector to spotlight. Omitted → a centered modal step. */
  target?: string;
  title: string;
  body: string;
};

function joinLabels(labels: string[]): string {
  const top = labels.slice(0, 3);
  if (top.length === 0) return "the screens in your menu";
  if (top.length === 1) return top[0];
  if (top.length === 2) return `${top[0]} and ${top[1]}`;
  return `${top[0]}, ${top[1]}, and ${top[2]}`;
}

export function buildTourSteps(opts: {
  roleTitle: string;
  userName?: string | null;
  topLabels: string[];
  isMobile: boolean;
}): TourStep[] {
  const { roleTitle, userName, topLabels, isMobile } = opts;
  const hi = userName ? `Hi ${userName.split(" ")[0]} — ` : "";
  const menuStep: TourStep = isMobile
    ? {
        key: "menu",
        target: '[data-tour="menu-button"]',
        title: "Your menu",
        body: `Tap here to open your menu. As a ${roleTitle} you'll mostly use ${joinLabels(topLabels)}.`,
      }
    : {
        key: "menu",
        target: '[data-tour="sidebar"]',
        title: "Your menu",
        body: `Everything you can do lives here. As a ${roleTitle} you'll mostly use ${joinLabels(topLabels)}.`,
      };
  return [
    { key: "welcome", title: "Welcome to Equiwings 🐎", body: `${hi}here's a 30-second tour of your ${roleTitle} workspace.` },
    menuStep,
    { key: "help", target: '[data-tour="help"]', title: "Help is always here", body: "Tap the ? in the top bar anytime for a step-by-step guide to every screen you can see." },
    { key: "finish", title: "You're all set", body: "Head to your Dashboard to get started — and you can replay this tour from Help whenever you like." },
  ];
}
