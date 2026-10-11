import { describe, expect, it } from "vitest";
import { hashSecret } from "../../src/lib/crypto.js";
import { humanDuration, stagePolicy } from "../../src/services/login-throttle.service.js";
import { api, PASSWORD, prisma, register } from "../helpers.js";

const wrong = (email: string) => api().post("/api/v1/auth/login").send({ email, password: "Wrong-pass-123" });
const right = (email: string, password = PASSWORD) => api().post("/api/v1/auth/login").send({ email, password });
// Fast-forward past the current pause instead of waiting for it.
const endPause = (email: string) =>
  prisma.loginThrottle.update({ where: { keyHash: hashSecret(`login-throttle:${email}`) }, data: { lockedUntil: new Date(Date.now() - 1000) } });

describe("sign-in brute-force lockout", () => {
  it("pauses after 5, 3, 1 and 1 wrong passwords for 30 s, 1, 5 and 10 min, then doubles", async () => {
    const s = await register("lockout");
    for (const left of [4, 3, 2, 1]) {
      const res = await wrong(s.email);
      expect(res.status).toBe(401);
      expect(res.body.error.details.attemptsLeft).toBe(left);
    }
    const fifth = await wrong(s.email);
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe("LOGIN_LOCKED");
    expect(fifth.body.error.details.retryAfterSeconds).toBe(30);
    expect(fifth.headers["retry-after"]).toBe("30");
    expect((await right(s.email)).status).toBe(429); // while paused, even the right password waits

    for (const [allowed, pause] of [[3, 60], [1, 300], [1, 600], [1, 1200], [1, 2400]]) {
      await endPause(s.email);
      for (let i = 1; i < allowed; i++) expect((await wrong(s.email)).status).toBe(401);
      const locked = await wrong(s.email);
      expect(locked.status, `pause of ${pause}s`).toBe(429);
      expect(locked.body.error.details.retryAfterSeconds).toBe(pause);
    }

    await endPause(s.email);
    expect((await right(s.email)).status).toBe(200); // the right password starts over
    expect((await wrong(s.email)).body.error.details.attemptsLeft).toBe(4);
  });

  it("treats emails without an account identically, so lockouts reveal nothing", async () => {
    const s = await register("lockout-real");
    const ghost = `ghost-${Date.now()}@test.originx`;
    for (let i = 0; i < 5; i++) {
      const [real, fake] = [await wrong(s.email), await wrong(ghost)];
      expect(real.status).toBe(fake.status);
      expect(real.body.error.code).toBe(fake.body.error.code);
      expect(real.body.error.details).toEqual(fake.body.error.details);
    }
    expect((await wrong(ghost)).status).toBe(429);
  });

  it("counts simultaneous guesses before checking them", async () => {
    const s = await register("lockout-race");
    const results = await Promise.all(Array.from({ length: 12 }, () => wrong(s.email)));
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    // Only the 5 allowed attempts ever reached the password check.
    expect(await prisma.auditLog.count({ where: { action: "LOGIN_FAILED", resourceId: s.userId } })).toBe(5);
  });

  it("lifts the lockout when the owner resets their password", async () => {
    const s = await register("lockout-reset");
    for (let i = 0; i < 5; i++) await wrong(s.email);
    expect((await right(s.email)).status).toBe(429);
    const token = (await api().post("/api/v1/auth/forgot-password").send({ email: s.email })).body.data.demoResetToken;
    expect((await api().post("/api/v1/auth/reset-password").send({ token, password: "Brand-new-pass-42" })).status).toBe(200);
    expect((await right(s.email, "Brand-new-pass-42")).status).toBe(200);
  });

  it("caps the pause at 24 hours and words durations plainly", () => {
    expect(stagePolicy(40)).toEqual({ attempts: 1, lockSeconds: 86_400 });
    expect([30, 60, 300, 4800].map(humanDuration)).toEqual(["30 seconds", "1 minute", "5 minutes", "1 hour 20 minutes"]);
  });
});
