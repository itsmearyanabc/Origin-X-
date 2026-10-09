import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

export const app = createApp();
export { prisma };

export const uid = () => randomUUID().slice(0, 8);
export const PASSWORD = "Sup3rSecret-Pass";

export type Session = { token: string; refreshToken: string; userId: string; email: string };

export function api() {
  return request(app);
}

export function as(s: Session, orgId?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}` };
  if (orgId) headers["X-Organization-Id"] = orgId;
  return headers;
}

export async function register(label = "user"): Promise<Session> {
  const email = `${label}-${uid()}@test.originx`;
  const res = await api().post("/api/v1/auth/register").set("X-Refresh-Transport", "body").send({ email, password: PASSWORD, fullName: `Test ${label}` });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken, refreshToken: res.body.data.refreshToken, userId: res.body.data.user.id, email };
}

export async function login(email: string): Promise<Session> {
  const res = await api().post("/api/v1/auth/login").set("X-Refresh-Transport", "body").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken, refreshToken: res.body.data.refreshToken, userId: res.body.data.user.id, email };
}

/** Creates an organization owned by `owner`. `verified` simulates platform-admin approval + verification. */
export async function createOrg(owner: Session, name: string, organizationType = "MANUFACTURER", verified = true) {
  const res = await api()
    .post("/api/v1/organizations")
    .set(as(owner))
    .send({ name: `${name} ${uid()}`, organizationType, country: "IN" });
  if (res.status !== 201) throw new Error(`createOrg failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (verified) {
    await prisma.organization.update({ where: { id: res.body.data.id }, data: { status: "ACTIVE", verificationStatus: "VERIFIED", verifiedAt: new Date() } });
  }
  return res.body.data.id as string;
}

export async function makePlatformAdmin(role = "SUPER_ADMIN"): Promise<Session> {
  const s = await register("admin");
  await prisma.user.update({ where: { id: s.userId }, data: { platformRole: role, sessionVersion: { increment: 1 } } });
  return login(s.email);
}

/** Org A requests, org B accepts a supply-chain relationship. */
export async function partner(a: Session, orgA: string, b: Session, orgB: string, relationshipType = "PARTNER") {
  const req = await api().post("/api/v1/organizations/current/relationships").set(as(a, orgA)).send({ targetOrganizationId: orgB, relationshipType });
  if (req.status !== 201) throw new Error(`relationship request failed: ${JSON.stringify(req.body)}`);
  const acc = await api().post(`/api/v1/organizations/current/relationships/${req.body.data.id}/accept`).set(as(b, orgB));
  if (acc.status !== 200) throw new Error(`relationship accept failed: ${JSON.stringify(acc.body)}`);
}

export async function createProduct(s: Session, orgId: string, overrides: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/v1/products")
    .set(as(s, orgId))
    .send({
      productCode: `RX-${uid()}`,
      productName: "Test Vaccine",
      batchCode: `B-${uid()}`,
      originCountry: "IN",
      originLocation: "Delhi, India",
      manufacturingDate: "2026-08-01T06:00:00.000Z",
      expiryDate: "2027-08-01T00:00:00.000Z",
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { product: { id: string; publicVerificationToken: string; productCode: string }; collision: unknown };
}

export async function addEvent(s: Session, orgId: string, productId: string, eventType: string, location = "Delhi") {
  const res = await api().post(`/api/v1/products/${productId}/events`).set(as(s, orgId)).send({ eventType, location });
  if (res.status !== 201) throw new Error(`addEvent ${eventType} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Full two-party custody handoff. */
export async function transfer(from: Session, fromOrg: string, to: Session, toOrg: string, productId: string, receiptEventType?: string) {
  const reqRes = await api().post("/api/v1/custody-transfers").set(as(from, fromOrg)).send({ productId, toOrganizationId: toOrg });
  if (reqRes.status !== 201) throw new Error(`transfer request failed: ${JSON.stringify(reqRes.body)}`);
  const accRes = await api()
    .post(`/api/v1/custody-transfers/${reqRes.body.data.id}/accept`)
    .set(as(to, toOrg))
    .send(receiptEventType ? { receiptEventType, location: "Receiving dock" } : { location: "Receiving dock" });
  if (accRes.status !== 200) throw new Error(`transfer accept failed: ${JSON.stringify(accRes.body)}`);
  return accRes.body.data;
}

export function publicVerify(token: string, ip = "203.0.113.10") {
  return api().get(`/api/v1/verify/${token}`).set("CF-Connecting-IP", ip);
}

/** Simulates a database-level attacker editing an event row directly (bypassing the API). */
export async function tamperEventInDatabase(eventId: string, data: { location?: string; metadataJson?: string; eventHash?: string; previousEventHash?: string }) {
  await prisma.$transaction(async (tx) => {
    const unlock = await tx.demoTamperUnlock.create({ data: {} });
    await tx.productEvent.update({ where: { id: eventId }, data });
    await tx.demoTamperUnlock.delete({ where: { id: unlock.id } });
  });
}
