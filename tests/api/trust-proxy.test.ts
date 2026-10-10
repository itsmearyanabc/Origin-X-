import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { trustProxySetting } from "../../src/config.js";

describe("TRUST_PROXY", () => {
  it("turns a numeric value into a hop count (Express reads the string \"2\" as an IP address)", async () => {
    expect(trustProxySetting("2")).toBe(2);
    expect(trustProxySetting("loopback")).toBe("loopback");
    const app = express();
    app.set("trust proxy", trustProxySetting("2"));
    app.get("/", (req, res) => {
      res.send(req.ip);
    });
    // Forged entry from the visitor, then host nginx appends the visitor, then web nginx appends the host.
    const res = await request(app).get("/").set("X-Forwarded-For", "198.51.100.9, 203.0.113.7, 172.18.0.1");
    expect(res.text).toBe("203.0.113.7");
  });
});
