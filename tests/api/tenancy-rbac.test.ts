import { beforeAll, describe, expect, it } from "vitest";
import { addEvent, api, as, createOrg, createProduct, makePlatformAdmin, prisma, register, type Session } from "../helpers.js";

let ownerA: Session, ownerB: Session, viewerA: Session, operatorA: Session, adminA: Session;
let orgA: string, orgB: string, productA: string;

async function inviteAndJoin(owner: Session, orgId: string, role: string, invitee: Session) {
  const invite = await api().post("/api/v1/organizations/current/invitations").set(as(owner, orgId)).send({ email: invitee.email, role });
  expect(invite.status).toBe(201);
  const accept = await api().post("/api/v1/organizations/invitations/accept").set(as(invitee)).send({ token: invite.body.data.acceptToken });
  expect(accept.status).toBe(200);
}

beforeAll(async () => {
  ownerA = await register("ownerA");
  ownerB = await register("ownerB");
  viewerA = await register("viewerA");
  operatorA = await register("operatorA");
  adminA = await register("adminA");
  orgA = await createOrg(ownerA, "ABC Pharma");
  orgB = await createOrg(ownerB, "XYZ Electronics", "BRAND");
  await inviteAndJoin(ownerA, orgA, "ORG_VIEWER", viewerA);
  await inviteAndJoin(ownerA, orgA, "ORG_OPERATOR", operatorA);
  await inviteAndJoin(ownerA, orgA, "ORG_ADMIN", adminA);
  productA = (await createProduct(ownerA, orgA)).product.id;
});

describe("tenant isolation", () => {
  it("CRITICAL: a user of Organization B cannot access Organization A's product", async () => {
    const asB = as(ownerB, orgB);
    for (const path of ["", "/events", "/passport", "/trust-score", "/blockchain/proofs", "/qr", "/verifications"]) {
      const res = await api().get(`/api/v1/products/${productA}${path}`).set(asB);
      expect(res.status, `GET ${path}`).toBe(404);
    }
    expect((await api().post(`/api/v1/products/${productA}/events`).set(asB).send({ eventType: "DOCUMENT_ADDED" })).status).toBe(404);
    expect((await api().patch(`/api/v1/products/${productA}`).set(asB).send({ productName: "hijacked" })).status).toBe(404);
    const list = await api().get("/api/v1/products").set(asB);
    expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(productA);
  });

  it("cannot select another organization as tenant context", async () => {
    const res = await api().get("/api/v1/products").set(as(ownerB, orgA));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_ORGANIZATION_MEMBER");
    const missing = await api().get("/api/v1/products").set(as(ownerB));
    expect(missing.status).toBe(400);
  });

  it("ignores client-supplied tenant/ownership fields", async () => {
    const res = await api()
      .post("/api/v1/products")
      .set(as(ownerB, orgB))
      .send({ productCode: `SPOOF-${Date.now()}`, productName: "Spoof", organizationId: orgA, currentOwnerOrganizationId: orgA, trustScore: 100 });
    expect(res.status).toBe(201);
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: res.body.data.product.id } });
    expect(stored.organizationId).toBe(orgB);
    expect(stored.currentOwnerOrganizationId).toBe(orgB);
  });

  it("does not leak another tenant's incidents or audit logs", async () => {
    await api().post("/api/v1/incidents").set(as(ownerA, orgA)).send({ productId: productA, type: "OTHER", severity: "LOW", title: "Internal note", description: "Private to A" });
    const incidentsB = await api().get("/api/v1/incidents").set(as(ownerB, orgB));
    expect(JSON.stringify(incidentsB.body)).not.toContain("Private to A");
    const auditB = await api().get("/api/v1/audit-logs").set(as(ownerB, orgB));
    expect(auditB.body.data.every((l: { organizationId: string }) => l.organizationId === orgB)).toBe(true);
  });
});

describe("RBAC", () => {
  it("viewer can read but not modify", async () => {
    expect((await api().get(`/api/v1/products/${productA}`).set(as(viewerA, orgA))).status).toBe(200);
    expect((await api().post(`/api/v1/products/${productA}/events`).set(as(viewerA, orgA)).send({ eventType: "DOCUMENT_ADDED" })).status).toBe(403);
    expect((await api().post("/api/v1/products").set(as(viewerA, orgA)).send({ productCode: "V-1", productName: "Nope" })).status).toBe(403);
  });

  it("operator can record operational events but not change settings or members", async () => {
    await addEvent(operatorA, orgA, productA, "SHIPMENT_CREATED");
    expect((await api().patch("/api/v1/organizations/current").set(as(operatorA, orgA)).send({ industry: "Hacked" })).status).toBe(403);
    expect((await api().post("/api/v1/organizations/current/invitations").set(as(operatorA, orgA)).send({ email: "x@test.originx", role: "ORG_VIEWER" })).status).toBe(403);
    expect((await api().get("/api/v1/audit-logs").set(as(operatorA, orgA))).status).toBe(403);
  });

  it("admins cannot escalate to owner or remove owners", async () => {
    const escalate = await api().post("/api/v1/organizations/current/invitations").set(as(adminA, orgA)).send({ email: "boss@test.originx", role: "ORG_OWNER" });
    expect(escalate.status).toBe(403);
    expect(escalate.body.error.code).toBe("ROLE_ESCALATION_DENIED");
    const members = await api().get("/api/v1/organizations/current/members").set(as(adminA, orgA));
    const owner = members.body.data.find((m: { role: string }) => m.role === "ORG_OWNER");
    expect((await api().delete(`/api/v1/organizations/current/members/${owner.id}`).set(as(adminA, orgA))).status).toBe(403);
    expect((await api().patch(`/api/v1/organizations/current/members/${owner.id}`).set(as(adminA, orgA)).send({ role: "ORG_VIEWER" })).status).toBe(403);
  });

  it("the last owner cannot be removed or demoted", async () => {
    const members = await api().get("/api/v1/organizations/current/members").set(as(ownerA, orgA));
    const owner = members.body.data.find((m: { role: string }) => m.role === "ORG_OWNER");
    const demote = await api().patch(`/api/v1/organizations/current/members/${owner.id}`).set(as(ownerA, orgA)).send({ role: "ORG_VIEWER" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("LAST_OWNER");
  });

  it("owner can manage settings", async () => {
    const res = await api().patch("/api/v1/organizations/current").set(as(ownerA, orgA)).send({ industry: "Pharmaceuticals" });
    expect(res.status).toBe(200);
    expect(res.body.data.industry).toBe("Pharmaceuticals");
  });

  it("platform admins get no implicit tenant access; org users get no admin access", async () => {
    const admin = await makePlatformAdmin("SUPPORT_ADMIN");
    expect((await api().get(`/api/v1/products/${productA}`).set(as(admin, orgA))).status).toBe(403);
    expect((await api().get("/api/v1/admin/dashboard").set(as(ownerA))).status).toBe(403);
    expect((await api().get("/api/v1/admin/dashboard").set(as(admin))).status).toBe(200);
    // Support admins are read-only on the platform.
    expect((await api().post(`/api/v1/admin/organizations/${orgB}/suspend`).set(as(admin))).status).toBe(403);
  });

  it("suspended organizations become read-only", async () => {
    const owner = await register("suspendedOrg");
    const org = await createOrg(owner, "Suspended Co");
    await prisma.organization.update({ where: { id: org }, data: { status: "SUSPENDED" } });
    expect((await api().get("/api/v1/products").set(as(owner, org))).status).toBe(200);
    const write = await api().post("/api/v1/products").set(as(owner, org)).send({ productCode: "S-1", productName: "Blocked" });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("ORGANIZATION_SUSPENDED");
  });
});
