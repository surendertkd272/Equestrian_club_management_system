// Horse icon for the CMS sidebar. Renders the client-provided artwork at
// public/icons/horse_icon.png — clients flagged the lucide-react `Rabbit`
// placeholder previously, and freehand SVG silhouettes I attempted didn't
// look horse-shaped enough. An <img> tag is the cleanest way to honour the
// supplied asset exactly.
//
// One trade-off: <img> doesn't inherit currentColor, so the icon stays
// fully-coloured even when the sidebar row is "active" (white-on-primary).
// That's acceptable because the row background change is the dominant
// active-state cue.

import * as React from "react";

export function Horse({ className }: { className?: string }) {
  return (
    <img
      src="/icons/horse_icon.png"
      alt=""
      aria-hidden="true"
      width={24}
      height={24}
      className={className}
    />
  );
}
