import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Transaction client type for services that accept either the root client or a transaction. */
export type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export function json<T = Record<string, unknown>>(value: string | null | undefined, fallback: T = {} as T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
