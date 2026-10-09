import { z } from "zod";
import { notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { paginate, str, type Query } from "../lib/pagination.js";
import { writeAudit } from "./audit.service.js";
import { mailService } from "./mail.service.js";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  company: z.string().trim().max(160).optional(),
  topic: z.enum(["GENERAL", "SALES", "SUPPORT", "SECURITY", "PRIVACY"]).default("GENERAL"),
  message: z.string().trim().min(10).max(5_000),
  // Honeypot: real users never fill this hidden field.
  website: z.string().max(0).optional(),
});

export class ContactService {
  async submit(input: unknown, ipHash: string) {
    const { website: _honeypot, ...data } = contactSchema.parse(input);
    const message = await prisma.contactMessage.create({ data: { ...data, ipHash } });
    mailService.notifyAdmins(`New ${data.topic.toLowerCase()} message from ${data.name}`, `${data.name} <${data.email}>${data.company ? ` (${data.company})` : ""} sent a message via the website.`, "/admin/messages");
    return { received: true, reference: message.id.slice(-8).toUpperCase() };
  }

  async list(q: Query) {
    const where = { ...(str(q, "status") ? { status: str(q, "status") } : {}), ...(str(q, "topic") ? { topic: str(q, "topic") } : {}) };
    return paginate(
      q,
      () => prisma.contactMessage.count({ where }),
      (page) => prisma.contactMessage.findMany({ where, ...page, orderBy: { createdAt: "desc" }, omit: { ipHash: true } }),
    );
  }

  async setStatus(adminUserId: string, id: string, input: unknown) {
    const { status } = z.object({ status: z.enum(["NEW", "IN_PROGRESS", "CLOSED"]) }).parse(input);
    if (!(await prisma.contactMessage.findUnique({ where: { id } }))) throw notFound("ContactMessage");
    const updated = await prisma.contactMessage.update({ where: { id }, data: { status }, omit: { ipHash: true } });
    await writeAudit({ actorUserId: adminUserId, action: "ADMIN_CONTACT_MESSAGE_STATUS", resourceType: "ContactMessage", resourceId: id, metadata: { status } });
    return updated;
  }
}

export const contactService = new ContactService();
