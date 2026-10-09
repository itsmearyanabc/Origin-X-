import type { Prisma } from "@prisma/client";
import { notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Tenant read scope for products. An organization can see a product when it:
 *  - registered it (brand owner),
 *  - currently holds custody,
 *  - previously held custody (accepted transfer to or from it), or
 *  - has a pending custody offer for it.
 * Everything else is invisible (404, not 403, so product ids cannot be probed).
 */
export function readableProductWhere(organizationId: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { organizationId },
      { currentOwnerOrganizationId: organizationId },
      {
        transfers: {
          some: {
            OR: [
              { fromOrganizationId: organizationId, status: "TRANSFER_ACCEPTED" },
              { toOrganizationId: organizationId, status: { in: ["TRANSFER_ACCEPTED", "TRANSFER_REQUESTED"] } },
            ],
          },
        },
      },
    ],
  };
}

export async function getReadableProduct(organizationId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { AND: [{ id: productId }, readableProductWhere(organizationId)] },
    include: { identity: true },
  });
  if (!product) throw notFound("Product");
  return product;
}

export function productRelation(product: { organizationId: string; currentOwnerOrganizationId: string | null }, organizationId: string) {
  return {
    isBrandOwner: product.organizationId === organizationId,
    isCurrentCustodian: product.currentOwnerOrganizationId === organizationId,
  };
}

/** Safe projection of another organization (name and trust status only). */
export const orgSummarySelect = { id: true, name: true, slug: true, organizationType: true, verificationStatus: true, status: true } as const;
