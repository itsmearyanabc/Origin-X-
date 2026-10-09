import type { Request } from "express";
import { config } from "../config.js";
import { AppError } from "./errors.js";
import { privacyHash } from "./crypto.js";

/** Route parameter as a plain string (Express 5 types allow string | string[]). */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  const s = Array.isArray(value) ? value[0] : value;
  if (!s) throw new AppError("INVALID_PARAMETER", `Missing route parameter ${name}.`, 400);
  return s;
}

export function query(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

/**
 * Real client IP. Behind Cloudflare the TCP peer is a Cloudflare edge, so the visitor IP comes from
 * CF-Connecting-IP (trusted only when BEHIND_CLOUDFLARE=true and the origin only accepts Cloudflare).
 */
export function clientIp(req: Request): string {
  if (config.behindCloudflare) {
    const cf = req.header("cf-connecting-ip");
    if (cf) return cf.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function clientIpHash(req: Request): string {
  return privacyHash(clientIp(req));
}
