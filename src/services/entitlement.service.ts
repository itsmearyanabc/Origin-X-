import { config } from "../config.js";
import { PLANS, type PlanName } from "../lib/constants.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

type OrgPlan = {
  id: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
  productLimit: number;
  userLimit: number;
};

/**
 * Subscription entitlements. Limits come from the organization row (so ENTERPRISE can carry custom
 * values); plan defaults live in PLANS. Enforcement is off by default for the hackathon demo
 * (ENFORCE_ENTITLEMENTS=true turns it on) — the checks still run and are reported.
 */
export class EntitlementService {
  limitsFor(plan: string) {
    return PLANS[plan as PlanName] ?? PLANS.FREE;
  }

  private active(org: OrgPlan) {
    const expired = org.subscriptionExpiresAt ? org.subscriptionExpiresAt < new Date() : false;
    return ["ACTIVE", "TRIALING"].includes(org.subscriptionStatus) && !expired;
  }

  async usage(organizationId: string) {
    const [products, users] = await Promise.all([
      prisma.product.count({ where: { organizationId, status: { notIn: ["ARCHIVED", "QUARANTINED"] } } }),
      prisma.organizationMember.count({ where: { organizationId, status: "ACTIVE" } }),
    ]);
    return { products, users };
  }

  async snapshot(organizationId: string) {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const usage = await this.usage(organizationId);
    return {
      plan: org.subscriptionPlan,
      status: org.subscriptionStatus,
      subscriptionActive: this.active(org),
      startedAt: org.subscriptionStartedAt,
      expiresAt: org.subscriptionExpiresAt,
      limits: { products: org.productLimit, users: org.userLimit },
      usage,
      remaining: { products: Math.max(0, org.productLimit - usage.products), users: Math.max(0, org.userLimit - usage.users) },
      enforced: config.enforceEntitlements,
    };
  }

  private async check(organizationId: string, kind: "products" | "users") {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const usage = await this.usage(organizationId);
    const limit = kind === "products" ? org.productLimit : org.userLimit;
    const problem = !this.active(org)
      ? new AppError("SUBSCRIPTION_INACTIVE", "The organization's subscription is not active.", 402)
      : usage[kind] >= limit
        ? new AppError(
            kind === "products" ? "ENTITLEMENT_PRODUCT_LIMIT" : "ENTITLEMENT_USER_LIMIT",
            `The ${org.subscriptionPlan} plan allows ${limit} ${kind}. Upgrade to add more.`,
            402,
          )
        : null;
    if (problem && config.enforceEntitlements) throw problem;
    return { allowed: !problem, wouldBlock: problem?.code ?? null };
  }

  assertCanAddProduct(organizationId: string) {
    return this.check(organizationId, "products");
  }

  assertCanAddUser(organizationId: string) {
    return this.check(organizationId, "users");
  }

  /** Plan change (platform admin). ENTERPRISE requires explicit custom limits. */
  planData(plan: PlanName, custom?: { productLimit?: number; userLimit?: number }) {
    const defaults = PLANS[plan];
    const productLimit = custom?.productLimit ?? defaults.productLimit;
    const userLimit = custom?.userLimit ?? defaults.userLimit;
    if (productLimit === null || userLimit === null) {
      throw new AppError("CUSTOM_LIMITS_REQUIRED", "ENTERPRISE plans need explicit productLimit and userLimit.", 422);
    }
    return { subscriptionPlan: plan, productLimit, userLimit };
  }
}

export const entitlementService = new EntitlementService();
