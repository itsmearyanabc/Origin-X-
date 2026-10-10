import { OAuth2Client } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, as, login, PASSWORD, prisma, register } from "../helpers.js";

describe("authentication", () => {
  it("registers, logs in and returns the profile without secrets", async () => {
    const s = await register("auth");
    const me = await api().get("/api/v1/auth/me").set(as(s));
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(s.email);
    expect(me.body.data.accountType).toBe("ORGANIZATION_USER");
    expect(JSON.stringify(me.body)).not.toContain("passwordHash");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
  });

  it("rejects weak passwords, duplicate emails and bad credentials uniformly", async () => {
    const weak = await api().post("/api/v1/auth/register").send({ email: "weak@test.originx", password: "short", fullName: "Weak" });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");

    const s = await register("dupe");
    const dupe = await api().post("/api/v1/auth/register").send({ email: s.email, password: PASSWORD, fullName: "Dupe" });
    expect(dupe.status).toBe(409);

    const wrongPassword = await api().post("/api/v1/auth/login").send({ email: s.email, password: "Wrong-pass-123" });
    const unknownUser = await api().post("/api/v1/auth/login").send({ email: "nobody@test.originx", password: "Wrong-pass-123" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error).toEqual(unknownUser.body.error);
  });

  it("rejects missing or forged tokens", async () => {
    expect((await api().get("/api/v1/auth/me")).status).toBe(401);
    expect((await api().get("/api/v1/auth/me").set("Authorization", "Bearer not-a-jwt")).status).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const s = await register("refresh");
    const first = await api().post("/api/v1/auth/refresh").set("X-Refresh-Transport", "body").send({ refreshToken: s.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(s.refreshToken);

    const reuse = await api().post("/api/v1/auth/refresh").set("X-Refresh-Transport", "body").send({ refreshToken: s.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("TOKEN_REUSED");
    // The legitimately rotated token is now revoked too.
    const after = await api().post("/api/v1/auth/refresh").set("X-Refresh-Transport", "body").send({ refreshToken: first.body.data.refreshToken });
    expect(after.status).toBe(401);
  });

  it("logout of all sessions invalidates existing access tokens", async () => {
    const s = await register("logout");
    const out = await api().post("/api/v1/auth/logout-all").set(as(s)).send({ refreshToken: s.refreshToken });
    expect(out.status).toBe(200);
    expect((await api().get("/api/v1/auth/me").set(as(s))).status).toBe(401);
    expect((await api().post("/api/v1/auth/refresh").set("X-Refresh-Transport", "body").send({ refreshToken: s.refreshToken })).status).toBe(401);
  });

  it("resets a password with a single-use token and kills old sessions", async () => {
    const s = await register("reset");
    const forgot = await api().post("/api/v1/auth/forgot-password").send({ email: s.email });
    expect(forgot.body.data.accepted).toBe(true);
    const token = forgot.body.data.demoResetToken;
    expect(token).toBeTruthy();
    const unknown = await api().post("/api/v1/auth/forgot-password").send({ email: "ghost@test.originx" });
    expect(unknown.body.data).toEqual({ accepted: true });

    const reset = await api().post("/api/v1/auth/reset-password").send({ token, password: "Brand-new-pass-42" });
    expect(reset.status).toBe(200);
    expect((await api().post("/api/v1/auth/reset-password").send({ token, password: "Another-pass-42" })).status).toBe(400);
    expect((await api().get("/api/v1/auth/me").set(as(s))).status).toBe(401);
    const relogin = await api().post("/api/v1/auth/login").send({ email: s.email, password: "Brand-new-pass-42" });
    expect(relogin.status).toBe(200);
  });

  it("verifies email addresses", async () => {
    const res = await api().post("/api/v1/auth/register").send({ email: `verify-${Date.now()}@test.originx`, password: PASSWORD, fullName: "Verify Me" });
    const verify = await api().post("/api/v1/auth/verify-email").send({ token: res.body.data.demoEmailVerificationToken });
    expect(verify.status).toBe(200);
    const me = await api().get("/api/v1/auth/me").set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.body.data.emailVerified).toBe(true);
  });

  it("browser sessions keep the refresh token in an httpOnly cookie and require the CSRF header", async () => {
    const email = `cookie-${Date.now()}@test.originx`;
    const reg = await api().post("/api/v1/auth/register").send({ email, password: PASSWORD, fullName: "Cookie User" });
    expect(reg.status).toBe(201);
    expect(reg.body.data.refreshToken).toBeUndefined();
    const setCookie = String(reg.headers["set-cookie"]);
    expect(setCookie).toMatch(/ox_rt=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/);
    const cookie = setCookie.split(";")[0];

    const noCsrf = await api().post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe("CSRF_HEADER_REQUIRED");

    const refreshed = await api().post("/api/v1/auth/refresh").set("Cookie", cookie).set("X-Requested-With", "originx-web");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    const rotated = String(refreshed.headers["set-cookie"]).split(";")[0];
    expect(rotated).not.toBe(cookie);

    const out = await api().post("/api/v1/auth/logout").set("Cookie", rotated).set("X-Requested-With", "originx-web");
    expect(out.status).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/ox_rt=;/);
    expect((await api().post("/api/v1/auth/refresh").set("Cookie", rotated).set("X-Requested-With", "originx-web")).status).toBe(401);
  });

  it("accepts website contact messages with validation and a honeypot", async () => {
    const ok = await api().post("/api/v1/site/contact").set("CF-Connecting-IP", "198.51.100.200").send({ name: "Dana", email: "dana@example.com", topic: "SALES", message: "We would like a demo for 40 SKUs." });
    expect(ok.status).toBe(201);
    expect(ok.body.data.reference).toMatch(/^[A-Z0-9]{8}$/);
    const bot = await api().post("/api/v1/site/contact").set("CF-Connecting-IP", "198.51.100.201").send({ name: "Bot", email: "bot@example.com", message: "Buy cheap watches now!!!", website: "spam.example" });
    expect(bot.status).toBe(422);
  });

  it("blocks suspended users immediately", async () => {
    const s = await register("suspended");
    await prisma.user.update({ where: { id: s.userId }, data: { status: "SUSPENDED", sessionVersion: { increment: 1 } } });
    expect((await api().get("/api/v1/auth/me").set(as(s))).status).toBe(401);
    await expect(login(s.email)).rejects.toThrow();
  });

  describe("Google sign-in", () => {
    // Google cannot mint ID tokens in a test, so only the signature check is stubbed; everything
    // after it (account matching, sessions, audit) runs for real.
    const googleSays = (payload: Record<string, unknown>) =>
      vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({ getPayload: () => payload } as never);
    afterEach(() => vi.restoreAllMocks());

    it("refuses Google accounts whose email Google has not verified — no takeover of an existing user", async () => {
      const victim = await register("google-victim");
      googleSays({ email: victim.email, email_verified: false, name: "Attacker" });
      const res = await api().post("/api/v1/auth/google").set("X-Refresh-Transport", "body").send({ credential: "stub" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("GOOGLE_EMAIL_UNVERIFIED");
      expect(res.body.data).toBeUndefined();
    });

    it("signs in an existing user with a Google-verified email and creates new users", async () => {
      const existing = await register("google-existing");
      googleSays({ email: existing.email, email_verified: true, name: "Existing" });
      const res = await api().post("/api/v1/auth/google").set("X-Refresh-Transport", "body").send({ credential: "stub" });
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(existing.userId);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } })).emailVerifiedAt).not.toBeNull();

      const email = `google-new-${Date.now()}@test.originx`;
      googleSays({ email, email_verified: true, name: "New Googler" });
      const created = await api().post("/api/v1/auth/google").set("X-Refresh-Transport", "body").send({ credential: "stub" });
      expect(created.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).fullName).toBe("New Googler");
    });

    it("rejects tokens Google does not accept", async () => {
      vi.spyOn(OAuth2Client.prototype, "verifyIdToken").mockRejectedValue(new Error("Wrong recipient, payload audience != requiredAudience"));
      const res = await api().post("/api/v1/auth/google").send({ credential: "forged" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });
  });
});
