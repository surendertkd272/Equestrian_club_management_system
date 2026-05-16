// Top-of-page banner shown when the tenant org is in a read-only state.
// "past_due" and "suspended" are the only states that warrant a banner;
// "active" and "trial" stay quiet.

export function ReadOnlyBanner({ status }: { status: string | null | undefined }) {
  if (status !== "past_due" && status !== "suspended") return null;

  const tone =
    status === "past_due"
      ? {
          border: "border-amber-400",
          bg: "bg-amber-50",
          text: "text-amber-900",
          subText: "text-amber-800",
          title: "Payment past due — your tenant is now read-only.",
          body:
            "Reads still work. New entries, edits, and deletes are blocked until the outstanding balance is settled. Contact your account manager to clear it.",
        }
      : {
          border: "border-rose-400",
          bg: "bg-rose-50",
          text: "text-rose-900",
          subText: "text-rose-800",
          title: "This tenant is suspended.",
          body:
            "You can still sign in and browse your data, but every write is refused. Reach out to your account manager to reactivate.",
        };

  return (
    <div className={`border-b ${tone.border} ${tone.bg} px-6 py-2 text-sm ${tone.text}`}>
      <span className="font-semibold">{tone.title}</span>
      <span className={`ml-2 ${tone.subText}`}>{tone.body}</span>
    </div>
  );
}
