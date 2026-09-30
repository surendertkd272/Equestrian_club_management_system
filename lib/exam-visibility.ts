import type { Prisma } from "@prisma/client";

// What families and schools may see of exam results. A sitting can hold its
// results until a manager publishes them (so a result corrected on the day
// never reaches a parent first as the wrong one). While held, a marked exam
// and its certificate stay off the parent, student and school views.
const heldSitting = { holdResults: true, resultsPublishedAt: null } satisfies Prisma.ExamSittingWhereInput;

export const familyExamWhere: Prisma.ExamWhereInput = { NOT: { status: "completed", sitting: heldSitting } };
export const familyCertWhere: Prisma.CertificateWhereInput = { NOT: { exam: { sitting: heldSitting } } };
