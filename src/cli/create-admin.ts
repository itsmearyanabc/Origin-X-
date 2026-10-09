/**
 * Production bootstrap: creates (or promotes) the first ORIGINX super administrator.
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='long-random-pass' ADMIN_NAME='Your Name' node dist/cli/create-admin.js   (dev: npx tsx src/cli/create-admin.ts)
 *
 * The password is read from the environment so it never appears in shell history arguments.
 */
import { hashPassword } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
const fullName = process.env.ADMIN_NAME ?? "ORIGINX Administrator";

if (!email || password.length < 14) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 14 characters).");
  process.exit(1);
}

const existing = await prisma.user.findUnique({ where: { email } });
const user = existing
  ? await prisma.user.update({ where: { email }, data: { platformRole: "SUPER_ADMIN", status: "ACTIVE", sessionVersion: { increment: 1 } } })
  : await prisma.user.create({ data: { email, fullName, passwordHash: await hashPassword(password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date() } });
await prisma.auditLog.create({
  data: { actorUserId: user.id, action: existing ? "ADMIN_PROMOTED_BY_BOOTSTRAP" : "ADMIN_CREATED_BY_BOOTSTRAP", resourceType: "User", resourceId: user.id },
});
console.log(`${existing ? "Promoted" : "Created"} SUPER_ADMIN ${email}${existing ? " (existing password kept)" : ""}.`);
await prisma.$disconnect();
