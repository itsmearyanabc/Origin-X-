import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config.js";
import { EVENT_HASH_VERSION, GENESIS_HASH } from "./constants.js";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash for opaque secrets (refresh/reset/invite tokens) — only the hash is ever stored. */
export function hashSecret(value: string): string {
  return sha256(`originx:secret:${value}`);
}

/** Privacy-preserving identifier (IPs, user agents). Salted, one-way, not reversible to the raw value. */
export function privacyHash(value: string): string {
  return createHmac("sha256", config.privacySalt).update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 192-bit unguessable token embedded in QR codes. */
export function publicVerificationToken(): string {
  return randomBytes(24).toString("base64url");
}

export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type AccessTokenPayload = { sub: string; sv: number; jti: string };

export function signAccessToken(userId: string, sessionVersion: number): string {
  return jwt.sign({ sub: userId, sv: sessionVersion, jti: randomUUID() }, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessTtl,
    algorithm: "HS256",
    issuer: "originx",
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtAccessSecret, { algorithms: ["HS256"], issuer: "originx" }) as AccessTokenPayload;
}

/**
 * Deterministic canonical JSON: object keys sorted recursively, no whitespace, undefined object
 * members omitted (matching JSON.stringify), Dates as ISO-8601. Two semantically equal payloads
 * always produce byte-identical output, which makes the resulting hashes reproducible.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("Cannot canonicalize non-finite number");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(value.toString());
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`Cannot canonicalize value of type ${typeof value}`);
  }
}

/** eventHash = SHA-256( canonical(payload) || "|" || previousEventHash ) */
export function hashEventPayload(payload: unknown, previousEventHash: string): string {
  return sha256(`${canonicalize(payload)}|${previousEventHash || GENESIS_HASH}`);
}

export type EventHashFields = {
  productId: string;
  sequence: number;
  eventType: string;
  actorUserId: string | null;
  actorOrganizationId: string | null;
  timestamp: string;
  location: string | null;
  metadata: unknown;
};

/** The exact set of fields covered by an event hash. Changing this is a breaking change (bump EVENT_HASH_VERSION). */
export function eventCanonicalPayload(fields: EventHashFields) {
  return {
    v: EVENT_HASH_VERSION,
    productId: fields.productId,
    sequence: fields.sequence,
    eventType: fields.eventType,
    actorUserId: fields.actorUserId,
    actorOrganizationId: fields.actorOrganizationId,
    timestamp: fields.timestamp,
    location: fields.location,
    metadata: fields.metadata ?? {},
  };
}

export function computeEventHash(fields: EventHashFields, previousEventHash: string): string {
  return hashEventPayload(eventCanonicalPayload(fields), previousEventHash);
}

function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Canonical, organization-independent identity of a physical product: the same product code
 * and serial always map to the same hash, regardless of who registers it. That property is what
 * makes identity collisions (cloned / counterfeit registrations) detectable.
 */
export function canonicalIdentityHash(productCode: string, serialNumber?: string | null): string {
  return sha256(`originx:identity:v1|${normalizeIdentityPart(productCode)}|${normalizeIdentityPart(serialNumber)}`);
}

/** Identity hash given to a quarantined claim that collided with an existing identity. */
export function collisionClaimHash(canonical: string, claimNonce: string): string {
  return sha256(`originx:identity-claim:v1|${canonical}|${claimNonce}`);
}

/** Digest anchored on-chain for an identity status change (unique per change). */
export function statusChangeDigest(identityHash: string, status: string, nonce: string): string {
  return sha256(`originx:status:v1|${identityHash}|${status}|${nonce}`);
}

export function toBytes32(hexHash: string): string {
  const clean = hexHash.startsWith("0x") ? hexHash.slice(2) : hexHash;
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error("Expected a 32-byte hex hash");
  return `0x${clean.toLowerCase()}`;
}

export function fromBytes32(value: string): string {
  return value.toLowerCase().replace(/^0x/, "");
}
