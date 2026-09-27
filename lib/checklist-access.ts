import { centreFence } from "@/lib/authz-centre";

// Who may open a filed checklist in full (/checklists/submissions/[id]): a
// reviewer at that centre — the same set the sign-off route accepts — or this
// organisation's HQ, or the person who filed it. Not other yard staff, and no
// one at another club.
export const CHECKLIST_REVIEWERS = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "STABLE_MANAGER",
  "HEAD_COACH",
]);

type Viewer = { userId: string; role: string; centreId: string | null };

export async function checklistSubmissionAccess(
  viewer: Viewer,
  sub: { centreId: string; submittedByUserId: string },
): Promise<{ view: boolean; review: boolean }> {
  const review =
    CHECKLIST_REVIEWERS.has(viewer.role) &&
    !(await centreFence(viewer, sub.centreId));
  return { view: review || sub.submittedByUserId === viewer.userId, review };
}
