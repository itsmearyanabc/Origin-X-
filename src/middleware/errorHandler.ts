import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, fail } from "../lib/errors.js";
import { isProduction, isTest } from "../config.js";

/**
 * Converts every error into the standard envelope. Stack traces and raw database errors are never
 * returned to clients.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const retryAfter = (err.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (typeof retryAfter === "number") res.setHeader("Retry-After", String(retryAfter));
    return res.status(err.status).json(fail(err.code, err.message, err.details));
  }
  if (err instanceof ZodError) {
    return res.status(422).json(
      fail(
        "VALIDATION_ERROR",
        "Request validation failed.",
        err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      ),
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return res.status(409).json(fail("CONFLICT", "A record with these values already exists."));
    if (err.code === "P2025") return res.status(404).json(fail("NOT_FOUND", "The requested record could not be found."));
    if (err.code === "P2003") return res.status(400).json(fail("INVALID_REFERENCE", "A referenced record does not exist."));
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("ORIGINX_APPEND_ONLY") || message.includes("ORIGINX_IMMUTABLE")) {
    return res.status(409).json(fail("IMMUTABLE_RECORD", "Historical records are immutable."));
  }
  const body = err as { type?: string; status?: number };
  if (body?.type === "entity.parse.failed") {
    return res.status(400).json(fail("INVALID_JSON", "Request body is not valid JSON."));
  }
  if (body?.type === "entity.too.large") {
    return res.status(413).json(fail("PAYLOAD_TOO_LARGE", "Request body is too large."));
  }
  if (!isTest) console.error(err);
  return res.status(500).json(fail("INTERNAL_ERROR", isProduction ? "An unexpected error occurred." : "An unexpected error occurred. Check server logs."));
}
