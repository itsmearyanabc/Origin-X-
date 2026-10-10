import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import { publicIp } from "../../src/middleware/turnstile.js";
import { api, PASSWORD, register } from "../helpers.js";

// Only Cloudflare's Siteverify call is stubbed; routing, middleware and auth run for real.
const cloudflareSays = (result: Record<string, unknown>) => {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).startsWith("https://challenges.cloudflare.com/")) return new Response(JSON.stringify(result), { status: 200 });
    return real(input, init);
  });
};

describe("Cloudflare Turnstile human check", () => {
  beforeEach(() => {
    config.turnstile.siteKey = "0x4AAAAAAATESTSITEKEY";
    config.turnstile.secretKey = "0x4AAAAAAATESTSECRET";
  });
  afterEach(() => {
    config.turnstile.siteKey = "";
    config.turnstile.secretKey = "";
    vi.restoreAllMocks();
  });

  it("publishes the site key (never the secret) to the web app", async () => {
    const res = await api().get("/api/v1/site/config");
    expect(res.status).toBe(200);
    expect(res.body.data.turnstileSiteKey).toBe("0x4AAAAAAATESTSITEKEY");
    expect(JSON.stringify(res.body)).not.toContain("TESTSECRET");
  });

  it("requires a token on sign-in, sign-up, password reset and contact", async () => {
    for (const [path, body] of [
      ["/api/v1/auth/login", { email: "a@test.originx", password: PASSWORD }],
      ["/api/v1/auth/register", { email: `t-${Date.now()}@test.originx`, password: PASSWORD, fullName: "Bot" }],
      ["/api/v1/auth/forgot-password", { email: "a@test.originx" }],
      ["/api/v1/site/contact", { name: "Bot", email: "bot@test.originx", topic: "GENERAL", message: "Spam spam spam spam" }],
    ] as const) {
      const res = await api().post(path).send(body);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("HUMAN_CHECK_REQUIRED");
    }
  });

  it("refuses tokens Cloudflare rejects or that belong to another form", async () => {
    cloudflareSays({ success: false, "error-codes": ["invalid-input-response"] });
    const failed = await api().post("/api/v1/auth/login").send({ email: "a@test.originx", password: PASSWORD, turnstileToken: "bad" });
    expect(failed.status).toBe(403);
    expect(failed.body.error.code).toBe("HUMAN_CHECK_FAILED");

    vi.restoreAllMocks();
    cloudflareSays({ success: true, action: "contact", hostname: "localhost" });
    const wrongForm = await api().post("/api/v1/auth/login").send({ email: "a@test.originx", password: PASSWORD, turnstileToken: "contact-token" });
    expect(wrongForm.status).toBe(403);
  });

  it("reports a wrong secret key as our misconfiguration, not the visitor's failure", async () => {
    cloudflareSays({ success: false, "error-codes": ["invalid-input-secret"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await api().post("/api/v1/auth/register").send({ email: `t-${Date.now()}@test.originx`, password: PASSWORD, fullName: "Human", turnstileToken: "real-token" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("HUMAN_CHECK_UNAVAILABLE");
  });

  it("lets a verified human through and sends the secret and token to Cloudflare", async () => {
    config.turnstile.secretKey = ""; // create the account with the check off, then turn it back on
    const s = await register("turnstile-ok");
    config.turnstile.secretKey = "0x4AAAAAAATESTSECRET";
    const spy = cloudflareSays({ success: true, action: "login", hostname: "localhost" });
    const res = await api().post("/api/v1/auth/login").set("X-Refresh-Transport", "body").send({ email: s.email, password: PASSWORD, turnstileToken: "good-token" });
    expect(res.status).toBe(200);
    const call = spy.mock.calls.find(([u]) => String(u).startsWith("https://challenges.cloudflare.com/"))!;
    const sent = new URLSearchParams(String((call[1] as RequestInit).body));
    expect(sent.get("secret")).toBe("0x4AAAAAAATESTSECRET");
    expect(sent.get("response")).toBe("good-token");
  });

  it("never sends a private proxy address to Cloudflare as the visitor IP", () => {
    for (const ip of ["172.18.0.1", "::ffff:172.18.0.1", "10.0.0.5", "192.168.1.2", "127.0.0.1", "::1", "fd00::1", "100.64.0.1", "unknown", undefined]) expect(publicIp(ip), String(ip)).toBeUndefined();
    expect(publicIp("203.0.113.7")).toBe("203.0.113.7");
    expect(publicIp("::ffff:8.8.8.8")).toBe("8.8.8.8");
  });

  it("is a no-op when Turnstile is not configured", async () => {
    config.turnstile.siteKey = "";
    config.turnstile.secretKey = "";
    const res = await api().post("/api/v1/auth/login").send({ email: "nobody@test.originx", password: PASSWORD });
    expect(res.status).toBe(401); // reached the real login, which rejects unknown users
  });
});
