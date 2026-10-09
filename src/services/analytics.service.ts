import { ACTIVE_RECALL_STATUS, OPEN_INCIDENT_STATUS } from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import { readableProductWhere } from "./product-access.js";

const FAILED_RESULTS = ["UNKNOWN", "COUNTERFEIT", "HISTORY_COMPROMISED", "SUSPICIOUS"];

function countBy<T extends Record<string, unknown>>(rows: Array<T & { _count: { _all: number } }>, key: keyof T) {
  return Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));
}

/** Organization dashboard metrics (tenant-scoped). */
export class AnalyticsService {
  async organizationDashboard(organizationId: string) {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const visible = readableProductWhere(organizationId);
    const [registered, inCustody, visibleTotal, byStatus, byTrust, incidentsByType, openIncidents, recalls, pendingIncoming, pendingOutgoing, verifications, proofs, partners, avgTrust] =
      await Promise.all([
        prisma.product.count({ where: { organizationId } }),
        prisma.product.count({ where: { currentOwnerOrganizationId: organizationId } }),
        prisma.product.count({ where: visible }),
        prisma.product.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
        prisma.product.groupBy({ by: ["trustLevel"], where: { organizationId }, _count: { _all: true } }),
        prisma.incident.groupBy({ by: ["type"], where: { organizationId, status: { in: OPEN_INCIDENT_STATUS } }, _count: { _all: true } }),
        prisma.incident.count({ where: { organizationId, status: { in: OPEN_INCIDENT_STATUS } } }),
        prisma.recall.count({ where: { organizationId, status: { in: ACTIVE_RECALL_STATUS } } }),
        prisma.custodyTransfer.count({ where: { toOrganizationId: organizationId, status: "TRANSFER_REQUESTED" } }),
        prisma.custodyTransfer.count({ where: { fromOrganizationId: organizationId, status: "TRANSFER_REQUESTED" } }),
        prisma.verificationLog.groupBy({ by: ["result"], where: { product: { organizationId }, timestamp: { gte: since30 } }, _count: { _all: true } }),
        prisma.blockchainProof.groupBy({ by: ["status"], where: { product: { organizationId } }, _count: { _all: true } }),
        prisma.organizationRelationship.count({
          where: { status: "ACCEPTED", OR: [{ sourceOrganizationId: organizationId }, { targetOrganizationId: organizationId }] },
        }),
        prisma.product.aggregate({ where: { organizationId, status: { not: "QUARANTINED" } }, _avg: { trustScore: true } }),
      ]);
    const verificationResults = countBy(verifications, "result");
    const totalVerifications = Object.values(verificationResults).reduce((a, b) => a + b, 0);
    const failed = FAILED_RESULTS.reduce((sum, r) => sum + (verificationResults[r] ?? 0), 0);
    return {
      products: { registered, inCustody, visible: visibleTotal, byStatus: countBy(byStatus, "status"), byTrustLevel: countBy(byTrust, "trustLevel"), averageTrustScore: Math.round(avgTrust._avg.trustScore ?? 0) },
      incidents: { open: openIncidents, openByType: countBy(incidentsByType, "type") },
      recalls: { active: recalls },
      custody: { pendingIncoming, pendingOutgoing },
      partners,
      verifications30d: { total: totalVerifications, failed, byResult: verificationResults },
      blockchain: { proofsByStatus: countBy(proofs, "status") },
    };
  }

  async mostVerifiedProducts(organizationId: string, limit = 10) {
    const rows = await prisma.verificationLog.groupBy({
      by: ["productId"],
      where: { product: { organizationId }, productId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { productId: "desc" } },
      take: limit,
    });
    const products = await prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId!) } },
      select: { id: true, productCode: true, productName: true, trustScore: true },
    });
    return rows.map((r) => ({ ...products.find((p) => p.id === r.productId), verifications: r._count._all }));
  }
}

export const analyticsService = new AnalyticsService();
