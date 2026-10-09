/**
 * Safety guard for demo/seed/reset tooling: refuses to run unless DATABASE_URL points at a local
 * development database. Demo data must never reach Supabase or any production database.
 *
 * Imported first by prisma/seed.ts and prisma/seed-inventory.ts, and run before `db:reset`.
 */
import "dotenv/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const url = process.env.DATABASE_URL ?? "";
const h = host(url);
const problems: string[] = [];
if (process.env.NODE_ENV === "production") problems.push("NODE_ENV is production");
if (!url) problems.push("DATABASE_URL is not set");
else if (!LOCAL_HOSTS.has(h)) problems.push(`DATABASE_URL host "${h}" is not a local development database`);

if (problems.length) {
  console.error(`Refusing to run demo/seed/reset tooling: ${problems.join("; ")}.\nThese scripts create demo data and may wipe the database — they only run against local development databases.`);
  process.exit(1);
}
