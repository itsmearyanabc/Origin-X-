import { prisma, type Db } from "../lib/prisma.js";

export type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: unknown;
  ipHash?: string | null;
};

/**
 * Appends an audit entry. Audit logs are append-only: the database rejects UPDATE/DELETE on the
 * table (see prisma/migrations/*_integrity_guards), and no API exposes mutation of them.
 */
export async function writeAudit(input: AuditInput, db: Db = prisma) {
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      ipHash: input.ipHash ?? null,
    },
  });
}
