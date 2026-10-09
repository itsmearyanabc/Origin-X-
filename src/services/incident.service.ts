import { z } from "zod";
import { INCIDENT_SEVERITY, INCIDENT_STATUS, INCIDENT_TYPES, OPEN_INCIDENT_STATUS } from "../lib/constants.js";
import { AppError, notFound } from "../lib/errors.js";
import { json, prisma } from "../lib/prisma.js";
import { paginate, str, type Query } from "../lib/pagination.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { eventService } from "./event.service.js";
import { getReadableProduct, productRelation } from "./product-access.js";
import { trustScoreService } from "./trust.service.js";

export type IncidentInput = {
  organizationId: string;
  actorUserId?: string | null;
  productId?: string | null;
  type: (typeof INCIDENT_TYPES)[number];
  severity: (typeof INCIDENT_SEVERITY)[number];
  title: string;
  description: string;
  evidence?: Record<string, unknown>;
  affectedUnits?: number | null;
  source?: "MANUAL" | "SYSTEM";
  /** Record INCIDENT_CREATED in the product's hash chain (manual incidents by owner/custodian). */
  appendEvent?: boolean;
  recalculateTrust?: boolean;
  ipHash?: string | null;
};

function present<T extends { evidenceJson: string }>(incident: T) {
  const { evidenceJson, ...rest } = incident;
  return { ...rest, evidence: json(evidenceJson) };
}

export class IncidentService {
  async create(input: IncidentInput) {
    const incident = await prisma.incident.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId ?? null,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        evidenceJson: JSON.stringify(input.evidence ?? {}),
        affectedUnits: input.affectedUnits ?? null,
        createdById: input.actorUserId ?? null,
        source: input.source ?? "MANUAL",
      },
    });
    if (input.productId && input.appendEvent) {
      await eventService.append({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        productId: input.productId,
        eventType: "INCIDENT_CREATED",
        metadata: { incidentId: incident.id, type: input.type, severity: input.severity },
        ipHash: input.ipHash,
      });
    }
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      action: input.source === "SYSTEM" ? "INCIDENT_DETECTED" : "INCIDENT_CREATED",
      resourceType: "Incident",
      resourceId: incident.id,
      metadata: { type: input.type, severity: input.severity, productId: input.productId ?? null },
      ipHash: input.ipHash,
    });
    if (input.productId && input.recalculateTrust !== false) await trustScoreService.calculate(input.productId);
    return present(incident);
  }

  /** System detection: creates the incident only if an open one of the same type does not already exist. */
  async ensureSystemIncident(input: Omit<IncidentInput, "source" | "appendEvent">) {
    const existing = await prisma.incident.findFirst({
      where: { productId: input.productId ?? undefined, organizationId: input.organizationId, type: input.type, status: { in: OPEN_INCIDENT_STATUS } },
    });
    if (existing) return { incident: present(existing), created: false };
    return { incident: await this.create({ ...input, source: "SYSTEM", appendEvent: false }), created: true };
  }

  async createFromRequest(a: Actor, input: unknown) {
    const data = z
      .object({
        productId: z.string().optional(),
        type: z.enum(INCIDENT_TYPES),
        severity: z.enum(INCIDENT_SEVERITY),
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().min(3).max(5_000),
        evidence: z.record(z.unknown()).optional(),
        affectedUnits: z.number().int().min(0).optional(),
      })
      .parse(input);
    let appendEvent = false;
    if (data.productId) {
      const product = await getReadableProduct(a.organizationId, data.productId);
      const rel = productRelation(product, a.organizationId);
      appendEvent = (rel.isBrandOwner || rel.isCurrentCustodian) && product.status !== "QUARANTINED";
    }
    return this.create({ ...data, organizationId: a.organizationId, actorUserId: a.userId, source: "MANUAL", appendEvent, ipHash: a.ipHash });
  }

  async list(organizationId: string, q: Query) {
    const where = {
      organizationId,
      ...(str(q, "type") ? { type: str(q, "type") } : {}),
      ...(str(q, "status") ? { status: str(q, "status") } : {}),
      ...(str(q, "severity") ? { severity: str(q, "severity") } : {}),
      ...(str(q, "productId") ? { productId: str(q, "productId") } : {}),
    };
    const result = await paginate(
      q,
      () => prisma.incident.count({ where }),
      (page) =>
        prisma.incident.findMany({
          where,
          ...page,
          orderBy: { createdAt: "desc" },
          include: { product: { select: { id: true, productCode: true, productName: true, status: true } } },
        }),
    );
    return { ...result, items: result.items.map(present) };
  }

  async get(organizationId: string, id: string) {
    const incident = await prisma.incident.findFirst({
      where: { id, organizationId },
      include: { product: { select: { id: true, productCode: true, productName: true, status: true } }, recalls: true },
    });
    if (!incident) throw notFound("Incident");
    return present(incident);
  }

  async updateStatus(a: Actor | { userId: string; organizationId: string | null; ipHash?: string | null }, id: string, input: unknown) {
    const data = z
      .object({ status: z.enum(INCIDENT_STATUS).exclude(["RECALLED"]), note: z.string().trim().max(2_000).optional() })
      .parse(input);
    const incident = await prisma.incident.findFirst({ where: { id, ...(a.organizationId ? { organizationId: a.organizationId } : {}) } });
    if (!incident) throw notFound("Incident");
    if (["RESOLVED", "DISMISSED", "RECALLED"].includes(incident.status) && data.status !== "OPEN") {
      throw new AppError("INCIDENT_CLOSED", "This incident is already closed. Re-open it first.", 409);
    }
    const closing = ["RESOLVED", "DISMISSED"].includes(data.status);
    const updated = await prisma.incident.update({
      where: { id },
      data: {
        status: data.status,
        resolutionNote: data.note ?? incident.resolutionNote,
        resolvedById: closing ? a.userId : null,
        resolvedAt: closing ? new Date() : null,
      },
    });
    await writeAudit({
      organizationId: incident.organizationId,
      actorUserId: a.userId,
      action: "INCIDENT_STATUS_CHANGED",
      resourceType: "Incident",
      resourceId: id,
      metadata: { from: incident.status, to: data.status, note: data.note },
      ipHash: a.ipHash,
    });
    if (incident.productId) await trustScoreService.calculate(incident.productId);
    return present(updated);
  }
}

export const incidentService = new IncidentService();
