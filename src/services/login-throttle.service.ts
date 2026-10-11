import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { hashSecret } from "../lib/crypto.js";

/**
 * Progressive sign-in lockout (brute-force protection), per email address:
 *   5 wrong passwords → 30 s pause, then 3 → 1 min, then 1 → 5 min, then 1 → 10 min, and after that
 *   every wrong password doubles the pause (20 min, 40 min, …) up to 24 h.
 * A correct password or a password reset clears it; 24 h without a wrong password starts over.
 *
 * - Emails with no account are throttled exactly like real ones, so a lockout reveals nothing about
 *   which accounts exist. Rows hold a hash of the email, never the address.
 * - Each attempt is counted *before* its password is checked, under a row lock, so simultaneous
 *   guesses cannot exceed the allowance.
 * - Locking someone out needs a Cloudflare check per guess (Turnstile), and the real owner can
 *   always unlock immediately with "Forgot password".
 */
const STAGES = [
  { attempts: 5, lockSeconds: 30 },
  { attempts: 3, lockSeconds: 60 },
  { attempts: 1, lockSeconds: 5 * 60 },
  { attempts: 1, lockSeconds: 10 * 60 },
];
const MAX_LOCK_SECONDS = 24 * 3600;
const STREAK_RESET_MS = 24 * 3600_000;

export function stagePolicy(stage: number): { attempts: number; lockSeconds: number } {
  if (stage < STAGES.length) return STAGES[stage];
  const last = STAGES[STAGES.length - 1];
  return { attempts: 1, lockSeconds: Math.min(MAX_LOCK_SECONDS, last.lockSeconds * 2 ** (stage - STAGES.length + 1)) };
}

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minute${m === 1 ? "" : "s"}` : ""}`;
}

type Row = { stage: number; failures: number; lockedUntil: Date | null; lastFailedAt: Date };
const keyFor = (email: string) => hashSecret(`login-throttle:${email.trim().toLowerCase()}`);

function lockedError(until: Date, now: Date) {
  const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
  return new AppError("LOGIN_LOCKED", `Too many failed sign-in attempts. Try again in ${humanDuration(retryAfterSeconds)}.`, 429, { retryAfterSeconds });
}

/** Runs `fn` with this email's row locked (created if missing), inside one transaction. */
function withRow<T>(keyHash: string, fn: (row: Row, tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "LoginThrottle" ("keyHash") VALUES (${keyHash}) ON CONFLICT ("keyHash") DO NOTHING`;
    const [row] = await tx.$queryRaw<Row[]>`SELECT "stage", "failures", "lockedUntil", "lastFailedAt" FROM "LoginThrottle" WHERE "keyHash" = ${keyHash} FOR UPDATE`;
    return fn(row, tx);
  });
}

let lastSweep = 0;

export const loginThrottle = {
  /** Call before checking the password. Throws LOGIN_LOCKED (429) while paused. */
  async reserve(email: string): Promise<void> {
    const keyHash = keyFor(email);
    const now = new Date();
    if (now.getTime() - lastSweep > 3600_000) {
      lastSweep = now.getTime();
      void prisma.loginThrottle
        .deleteMany({ where: { lastFailedAt: { lt: new Date(now.getTime() - STREAK_RESET_MS) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } })
        .catch(() => undefined);
    }
    await withRow(keyHash, async (row, tx) => {
      let { stage, failures } = row;
      if (row.lockedUntil && row.lockedUntil > now) throw lockedError(row.lockedUntil, now);
      if (now.getTime() - row.lastFailedAt.getTime() > STREAK_RESET_MS) {
        stage = 0;
        failures = 0;
      }
      const policy = stagePolicy(stage);
      if (failures >= policy.attempts) {
        // The allowance is already taken by attempts still being checked: pause now.
        const until = new Date(now.getTime() + policy.lockSeconds * 1000);
        await tx.loginThrottle.update({ where: { keyHash }, data: { stage: stage + 1, failures: 0, lockedUntil: until, lastFailedAt: now } });
        throw lockedError(until, now);
      }
      await tx.loginThrottle.update({ where: { keyHash }, data: { stage, failures: failures + 1, lockedUntil: null, lastFailedAt: now } });
    });
  },

  /** Call after a wrong password: pauses sign-in once the allowance is used up. */
  async failed(email: string): Promise<{ attemptsLeft: number; pauseSeconds: number; locked?: AppError }> {
    const keyHash = keyFor(email);
    return withRow(keyHash, async (row, tx) => {
      const now = new Date();
      if (row.lockedUntil && row.lockedUntil > now) return { attemptsLeft: 0, pauseSeconds: 0, locked: lockedError(row.lockedUntil, now) };
      const policy = stagePolicy(row.stage);
      if (row.failures < policy.attempts) return { attemptsLeft: policy.attempts - row.failures, pauseSeconds: policy.lockSeconds };
      const until = new Date(now.getTime() + policy.lockSeconds * 1000);
      await tx.loginThrottle.update({ where: { keyHash }, data: { stage: row.stage + 1, failures: 0, lockedUntil: until, lastFailedAt: now } });
      return { attemptsLeft: 0, pauseSeconds: policy.lockSeconds, locked: lockedError(until, now) };
    });
  },

  /** Correct password or password reset: start over. */
  async clear(email: string): Promise<void> {
    await prisma.loginThrottle.deleteMany({ where: { keyHash: keyFor(email) } });
  },
};
