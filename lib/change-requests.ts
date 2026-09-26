import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { notifyCentreManager, notifyHq } from "@/lib/notify";
import { getOrgIdForCentre } from "@/lib/features-gate";
import { updateStockSchema } from "@/lib/schemas/equipment";
import { createHorseSchema, updateHorseSchema } from "@/lib/schemas/horse";
import { applyStockChange } from "@/lib/equipment-stock";
import { horseCreateData, horseUpdateData } from "@/lib/horse-writes";

// Changes a coach may ASK for but not make.
//
// The owner's rule: coaches do not change stock or horse records on their own
// say-so. Before this, a coach could set any equipment count directly (the
// stock route listed COACH by name) and a head coach could create, retire or
// re-stable any horse, with nothing between the edit and the record.
//
// Now the same edit, made by a coach, is stored as an ApprovalRequest carrying
// the exact change, and a manager approving it is what writes it — through the
// same code path a manager's own edit takes (applyStockChange, horse-writes).
// Rejecting it writes nothing.
//
// Deliberately NOT gated: records of things that happened — a health reading,
// a horse allocation for a lesson, a dose given, a vet visit, attendance. Those
// are observations, not changes to the club's records, and making a coach wait
// for sign-off to log a temperature would stop the yard, not control it.

export const CHANGE_KINDS = {
  STOCK: "equipment_stock_change",
  HORSE_UPDATE: "horse_update",
  HORSE_CREATE: "horse_create",
} as const;
export type ChangeKind = (typeof CHANGE_KINDS)[keyof typeof CHANGE_KINDS];

const KIND_SET = new Set<string>(Object.values(CHANGE_KINDS));

export function isChangeKind(entityType: string): entityType is ChangeKind {
  return KIND_SET.has(entityType);
}

const NEEDS_APPROVAL: readonly Role[] = ["COACH", "HEAD_COACH"];

export function requiresApproval(role: Role): boolean {
  return NEEDS_APPROVAL.includes(role);
}

// Who may approve a coach's change. Not a head coach: they hold leave.approve,
// which is how they could approve generic requests, but letting one coach sign
// off another's stock change is the control going round in a circle.
export const CHANGE_REVIEWER_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "CENTRE_MANAGER",
  "STABLE_MANAGER",
  "INVENTORY_MANAGER",
];

export function mayReviewChange(role: Role, requestedBy: string, userId: string): boolean {
  // Never your own request, whatever your role.
  return requestedBy !== userId && CHANGE_REVIEWER_ROLES.includes(role);
}

export async function raiseChangeRequest(args: {
  centreId: string;
  kind: ChangeKind;
  entityId: string;
  title: string;
  body: string;
  payload: Prisma.InputJsonValue;
  requestedBy: string;
  requesterName: string;
}) {
  const row = await prisma.approvalRequest.create({
    data: {
      centreId: args.centreId,
      entityType: args.kind,
      entityId: args.entityId,
      title: args.title,
      body: args.body,
      requestedBy: args.requestedBy,
      payloadJson: args.payload,
    },
  });

  await audit({
    userId: args.requestedBy,
    action: "approval.change_requested",
    tableName: "approvalRequest",
    rowId: row.id,
    after: { kind: args.kind, entityId: args.entityId, title: args.title, body: args.body },
  });

  const note = {
    type: "approval.requested",
    title: `Approval needed: ${args.title}`,
    body: `${args.requesterName}: ${args.body}`,
    link: "/approvals",
    payload: { approvalId: row.id, entityType: args.kind, entityId: args.entityId },
  };
  await notifyCentreManager(args.centreId, note);
  // HQ too: the owner asked to see coaches' changes, and a centre with no
  // manager assigned would otherwise tell nobody at all.
  const orgId = await getOrgIdForCentre(args.centreId);
  if (orgId) await notifyHq(orgId, { ...note, centreId: args.centreId });

  return row;
}

type ApplyResult = { ok: true } | { ok: false; error: string; message: string };

// Write the change an approved request carries. Re-validates the stored
// payload with the live schema: the request may have sat for days, and the
// schema, the horse or the catalog item may have changed since.
export async function applyChangeRequest(row: {
  id: string;
  centreId: string;
  entityType: string;
  entityId: string;
  requestedBy: string;
  payloadJson: Prisma.JsonValue | null;
}): Promise<ApplyResult> {
  const p = (row.payloadJson ?? {}) as Record<string, unknown>;

  if (row.entityType === CHANGE_KINDS.STOCK) {
    const data = updateStockSchema.safeParse(p.data);
    if (!data.success) return { ok: false, error: "STALE_PAYLOAD", message: "This change no longer validates." };
    const catalog = await prisma.equipmentCatalog.findUnique({ where: { id: row.entityId } });
    if (!catalog) return { ok: false, error: "GONE", message: "That catalog item no longer exists." };
    await applyStockChange({
      centreId: row.centreId,
      catalog,
      data: data.data,
      actorId: row.requestedBy,
      approvalId: row.id,
    });
    return { ok: true };
  }

  if (row.entityType === CHANGE_KINDS.HORSE_UPDATE) {
    const data = updateHorseSchema.safeParse(p.data);
    if (!data.success) return { ok: false, error: "STALE_PAYLOAD", message: "This change no longer validates." };
    const horse = await prisma.horse.findUnique({ where: { id: row.entityId } });
    // The request was raised against this centre; a horse since moved
    // elsewhere is not this approver's to change.
    if (!horse || horse.centreId !== row.centreId) {
      return { ok: false, error: "GONE", message: "That horse is no longer at this centre." };
    }
    const updated = await prisma.horse.update({ where: { id: horse.id }, data: horseUpdateData(data.data) });
    await audit({
      userId: row.requestedBy,
      action: "update",
      tableName: "horse",
      rowId: horse.id,
      before: horse,
      after: { ...updated, viaApproval: row.id },
    });
    return { ok: true };
  }

  if (row.entityType === CHANGE_KINDS.HORSE_CREATE) {
    const data = createHorseSchema.safeParse(p.data);
    if (!data.success) return { ok: false, error: "STALE_PAYLOAD", message: "This horse no longer validates." };
    const horse = await prisma.horse.create({ data: horseCreateData(data.data, row.centreId) });
    await audit({
      userId: row.requestedBy,
      action: "create",
      tableName: "horse",
      rowId: horse.id,
      after: { name: horse.name, ownership: horse.ownership, viaApproval: row.id },
    });
    return { ok: true };
  }

  return { ok: false, error: "NOT_A_CHANGE", message: "This request has nothing to apply." };
}
