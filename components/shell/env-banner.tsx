// Persistent banner across non-production deploys. Helps the team avoid
// "wait, was I testing on prod?" mistakes — visible on every page.
//
// Renders nothing in production (NODE_ENV=production). For staging/preview
// builds, set NEXT_PUBLIC_ENV_LABEL="staging" (or similar) and the banner
// shows that label with an amber stripe at the top.

export function EnvBanner() {
  if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_ENV_LABEL) {
    return null;
  }
  const label = process.env.NEXT_PUBLIC_ENV_LABEL ?? (process.env.NODE_ENV === "development" ? "DEV" : process.env.NODE_ENV);
  return (
    <div className="bg-amber-500 px-3 py-0.5 text-center text-[10px] font-bold uppercase tracking-widest text-amber-950">
      {label} build · do not enter real data
    </div>
  );
}
